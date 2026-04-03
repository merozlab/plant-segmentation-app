# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import contextlib
import json
import logging
import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Generator, List, Optional

import numpy as np
import torch
from app_conf import APP_ROOT, MODEL_SIZE, UPLOADS_PATH
from resolution_config import (
    get_config_path,
    get_checkpoint_path,
    get_default_resolution,
    get_resolution_from_env,
    validate_resolution,
    get_model_info,
    get_max_frames,
    get_memory_per_frame,
    CHUNK_THRESHOLD,
    get_chunk_size,
)
from inference.data_types import (
    AddMaskRequest,
    AddPointsRequest,
    CancelPorpagateResponse,
    CancelPropagateInVideoRequest,
    ClearPointsInFrameRequest,
    ClearPointsInVideoRequest,
    ClearPointsInVideoResponse,
    CloseSessionRequest,
    CloseSessionResponse,
    Mask,
    PropagateDataResponse,
    PropagateDataValue,
    PropagateInVideoRequest,
    RemoveObjectRequest,
    RemoveObjectResponse,
    StartSessionRequest,
    StartSessionResponse,
)
from pycocotools.mask import decode as decode_masks, encode as encode_masks
from sam2.build_sam import build_sam2_video_predictor


logger = logging.getLogger(__name__)


@dataclass
class ChunkedSessionState:
    """Metadata for a chunked video session (long videos processed in pieces)."""
    session_dir: Path
    all_frames_dir: Path          # {session_dir}/all_frames/ with 00000.jpg, 00001.jpg, ...
    video_path: str               # Original video path (for reference)
    num_frames: int
    video_height: int
    video_width: int
    chunk_size: int
    # {obj_id: {frame_idx: {points, labels, clear_old_points}}}
    point_inputs: Dict[int, Dict[int, Dict]] = field(default_factory=dict)
    # {obj_id: {frame_idx: rle_mask_dict}} for add_mask corrections
    mask_inputs: Dict[int, Dict[int, Any]] = field(default_factory=dict)


class InferenceAPI:

    def __init__(self) -> None:
        super(InferenceAPI, self).__init__()

        self.session_states: Dict[str, Any] = {}
        self.score_thresh = 0

        # Get resolution from environment or use default
        resolution = get_resolution_from_env()
        if resolution is None:
            resolution = get_default_resolution(MODEL_SIZE)
        
        # Validate resolution for model size
        if not validate_resolution(MODEL_SIZE, resolution):
            logger.warning(f"Resolution {resolution} not supported for model {MODEL_SIZE}, using default")
            resolution = get_default_resolution(MODEL_SIZE)

        # Get config and checkpoint paths
        checkpoint = Path(APP_ROOT) / "checkpoints" / get_checkpoint_path(MODEL_SIZE)
        model_cfg = get_config_path(MODEL_SIZE, resolution)
        
        # Store configuration for later use
        self.model_size = MODEL_SIZE
        self.resolution = resolution
        self.model_info = get_model_info(MODEL_SIZE)
        
        logger.info(f"Initializing SAM2 with model_size={MODEL_SIZE}, resolution={resolution}")
        logger.info(f"Using config: {model_cfg}")
        logger.info(f"Using checkpoint: {checkpoint}")
        logger.info(f"Model info: {self.model_info}")

        # select the device for computation
        force_cpu_device = os.environ.get("SAM2_DEMO_FORCE_CPU_DEVICE", "0") == "1"
        if force_cpu_device:
            logger.info("forcing CPU device for SAM 2 demo")
        if torch.cuda.is_available() and not force_cpu_device:
            device = torch.device("cuda")
        elif torch.backends.mps.is_available() and not force_cpu_device:
            device = torch.device("mps")
        else:
            device = torch.device("cpu")
        logger.info(f"using device: {device}")

        if device.type == "cuda":
            # turn on tfloat32 for Ampere GPUs (https://pytorch.org/docs/stable/notes/cuda.html#tensorfloat-32-tf32-on-ampere-devices)
            if torch.cuda.get_device_properties(0).major >= 8:
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
        elif device.type == "mps":
            logging.warning(
                "\nSupport for MPS devices is preliminary. SAM 2 is trained with CUDA and might "
                "give numerically different outputs and sometimes degraded performance on MPS. "
                "See e.g. https://github.com/pytorch/pytorch/issues/84936 for a discussion."
            )

        self.device = device
        self.predictor = build_sam2_video_predictor(
            model_cfg,
            checkpoint,
            device=device,
            hydra_overrides_extra=[
                # Treat all frames with correction clicks as conditioning frames
                # This ensures that when users add points after propagation, those points
                # are properly used as conditioning frames for re-propagation
                "++model.add_all_frames_to_correct_as_cond=true",
            ],
        )
        self.inference_lock = Lock()
        
        # Enable memory optimization for better frame capacity
        if device.type == "cuda":
            torch.cuda.empty_cache()  # Clear any existing cache
            # Enable memory efficient attention if available
            try:
                torch.backends.cuda.enable_flash_sdp(True)
            except:
                pass

    def reload_model(self, model_size: str = None, resolution: int = None):
        """Reload the SAM2 model with new configuration"""
        logger.info(f"Reloading model with model_size={model_size}, resolution={resolution}")

        # Use provided values or fall back to current configuration
        if model_size is None:
            model_size = self.model_size
        if resolution is None:
            resolution = self.resolution

        # Validate resolution for model size
        if not validate_resolution(model_size, resolution):
            logger.warning(f"Resolution {resolution} not supported for model {model_size}, using default")
            resolution = get_default_resolution(model_size)

        # Get config and checkpoint paths
        checkpoint = Path(APP_ROOT) / "checkpoints" / get_checkpoint_path(model_size)
        model_cfg = get_config_path(model_size, resolution)

        logger.info(f"Using config: {model_cfg}")
        logger.info(f"Using checkpoint: {checkpoint}")

        # Clear all existing sessions
        self.session_states.clear()

        # Clear GPU cache if using CUDA
        if self.device.type == "cuda":
            torch.cuda.empty_cache()

        # Build new predictor
        self.predictor = build_sam2_video_predictor(
            model_cfg,
            checkpoint,
            device=self.device,
            hydra_overrides_extra=[
                "++model.add_all_frames_to_correct_as_cond=true",
            ],
        )

        # Update stored configuration
        self.model_size = model_size
        self.resolution = resolution
        self.model_info = get_model_info(model_size)

        logger.info(f"Model reloaded successfully with model_size={model_size}, resolution={resolution}")
        logger.info(f"Model info: {self.model_info}")

        return True

    def autocast_context(self):
        if self.device.type == "cuda":
            return torch.autocast("cuda", dtype=torch.bfloat16)
        else:
            return contextlib.nullcontext()

    def start_session(self, request: StartSessionRequest) -> StartSessionResponse:
        with self.autocast_context(), self.inference_lock:
            session_id = str(uuid.uuid4())

            # Clean up old sessions if we have more than 2 active sessions
            if len(self.session_states) > 2:
                logger.warning(f"[MEMORY DEBUG] Cleaning up old sessions (have {len(self.session_states)} active)")
                sessions_to_close = sorted(self.session_states.keys())[:-2]
                for old_sid in sessions_to_close:
                    logger.warning(f"[MEMORY DEBUG] Auto-closing old session: {old_sid}")
                    self.__clear_session_state(old_sid)

            # Probe video for frame count and dimensions
            import av
            num_frames = 0
            width = 0
            height = 0
            try:
                with av.open(request.path) as container:
                    video_stream = container.streams.video[0]
                    num_frames = video_stream.frames
                    if num_frames == 0:
                        duration = float(video_stream.duration * video_stream.time_base) if video_stream.duration else 0
                        fps = float(video_stream.average_rate) if video_stream.average_rate else 24
                        num_frames = int(duration * fps)
                    width = video_stream.width
                    height = video_stream.height
                    logger.warning(f"[MEMORY CHECK] Video stats: {num_frames} frames, {width}x{height}")
            except Exception as e:
                logger.warning(f"Could not probe video: {e}. Proceeding with normal session...")

            # Decide: chunked mode for long videos, normal mode otherwise
            if num_frames > CHUNK_THRESHOLD:
                logger.warning(f"[CHUNKED] Video has {num_frames} frames (> {CHUNK_THRESHOLD}), using chunked mode")
                return self._start_chunked_session(session_id, request, num_frames, width, height)
            else:
                return self._start_normal_session(session_id, request, num_frames, width, height)

    def _start_normal_session(
        self, session_id: str, request: StartSessionRequest,
        num_frames: int, width: int, height: int,
    ) -> StartSessionResponse:
        """Original session start: loads all frames into SAM2 at once."""
        import psutil

        process_memory_mb = 0
        stop_monitoring = None

        # Memory estimation and checks for normal mode
        try:
            from resolution_config import RESOLUTION_CONFIGS

            model_config = RESOLUTION_CONFIGS.get(self.model_size, RESOLUTION_CONFIGS["base_plus"])
            memory_multiplier = model_config.get("memory_multiplier", 2.5)

            bytes_per_frame = width * height * 3 * memory_multiplier
            estimated_memory_mb = (num_frames * bytes_per_frame) / (1024 ** 2)

            available_memory_mb = psutil.virtual_memory().available / (1024 ** 2)
            total_memory_mb = psutil.virtual_memory().total / (1024 ** 2)
            process = psutil.Process(os.getpid())
            process_memory_mb = process.memory_info().rss / (1024 ** 2)

            max_allowed_mb = available_memory_mb * 0.85

            logger.warning(f"[MEMORY CHECK] Model: {self.model_size}, multiplier: {memory_multiplier}x")
            logger.warning(f"[MEMORY CHECK] Total RAM: {total_memory_mb:.1f} MB, Available: {available_memory_mb:.1f} MB")
            logger.warning(f"[MEMORY CHECK] Process: {process_memory_mb:.1f} MB, Video needs: {estimated_memory_mb:.1f} MB")

            total_needed_mb = process_memory_mb + estimated_memory_mb
            if total_needed_mb > max_allowed_mb:
                active_sessions = len(self.session_states)
                session_hint = ""
                if active_sessions > 0:
                    session_hint = f" You have {active_sessions} session(s) still loaded. Try closing old sessions."
                raise RuntimeError(
                    f"Not enough memory: {num_frames} frames at {width}x{height} "
                    f"needs ~{total_needed_mb:.0f}MB but only {max_allowed_mb:.0f}MB available.{session_hint}"
                )
        except RuntimeError:
            raise
        except Exception as e:
            logger.warning(f"Could not estimate memory: {e}. Proceeding anyway...")

        offload_video_to_cpu = self.device.type in ["mps", "cuda"]

        logger.warning(f"[MEMORY DEBUG] Before init_state:")
        self._log_memory_stats()

        if self.device.type == "cuda":
            torch.cuda.empty_cache()

        import threading
        import time
        peak_memory = [process_memory_mb]
        stop_monitoring = threading.Event()

        try:
            def monitor_memory():
                proc = psutil.Process(os.getpid())
                while not stop_monitoring.is_set():
                    current = proc.memory_info().rss / (1024 ** 2)
                    if current > peak_memory[0]:
                        peak_memory[0] = current
                    time.sleep(0.5)

            monitor_thread = threading.Thread(target=monitor_memory, daemon=True)
            monitor_thread.start()

            inference_state = self.predictor.init_state(
                request.path,
                offload_video_to_cpu=offload_video_to_cpu,
                async_loading_frames=True,
            )

            stop_monitoring.set()
            monitor_thread.join(timeout=1.0)

            logger.warning(f"[MEMORY DEBUG] init_state completed. Peak: {peak_memory[0]:.1f} MB")

        except torch.cuda.OutOfMemoryError as e:
            if stop_monitoring is not None:
                stop_monitoring.set()
            raise RuntimeError(f"GPU out of memory while loading video: {e}")
        except MemoryError as e:
            if stop_monitoring is not None:
                stop_monitoring.set()
            raise RuntimeError(f"System out of memory while loading video: {e}")
        except Exception as e:
            if stop_monitoring is not None:
                stop_monitoring.set()
            raise

        logger.warning(f"[MEMORY DEBUG] After init_state:")
        self._log_memory_stats()

        self.session_states[session_id] = {
            "canceled": False,
            "state": inference_state,
        }
        return StartSessionResponse(session_id=session_id)

    def _start_chunked_session(
        self, session_id: str, request: StartSessionRequest,
        num_frames: int, width: int, height: int,
    ) -> StartSessionResponse:
        """Start a chunked session: extract all frames as JPEG, defer SAM2 init to propagation time."""
        session_dir = UPLOADS_PATH / session_id
        all_frames_dir = session_dir / "all_frames"
        all_frames_dir.mkdir(parents=True, exist_ok=True)

        chunk_size = get_chunk_size(width, height, self.model_size)
        logger.warning(f"[CHUNKED] Extracting {num_frames} frames to {all_frames_dir} (chunk_size={chunk_size})")

        # Extract all frames as JPEG using ffmpeg
        cmd = [
            "ffmpeg", "-i", request.path,
            "-q:v", "2",
            "-start_number", "0",
            str(all_frames_dir / "%05d.jpg"),
            "-y",
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {result.stderr[:500]}")
        except subprocess.TimeoutExpired:
            raise RuntimeError("Frame extraction timed out (>5min)")

        # Count actual extracted frames
        actual_frames = len(list(all_frames_dir.glob("*.jpg")))
        if actual_frames == 0:
            raise RuntimeError("No frames were extracted from the video")
        logger.warning(f"[CHUNKED] Extracted {actual_frames} frames (expected {num_frames})")

        cs = ChunkedSessionState(
            session_dir=session_dir,
            all_frames_dir=all_frames_dir,
            video_path=request.path,
            num_frames=actual_frames,
            video_height=height,
            video_width=width,
            chunk_size=chunk_size,
        )

        self.session_states[session_id] = {
            "canceled": False,
            "chunked": True,
            "chunked_state": cs,
            # Minimal stub so __get_session_stats doesn't break
            "state": {"num_frames": actual_frames, "obj_ids": []},
        }

        logger.warning(f"[CHUNKED] Session {session_id} ready: {actual_frames} frames, chunk_size={chunk_size}")
        return StartSessionResponse(session_id=session_id)

    def close_session(self, request: CloseSessionRequest) -> CloseSessionResponse:
        is_successful = self.__clear_session_state(request.session_id)
        return CloseSessionResponse(success=is_successful)

    def _is_chunked(self, session: Dict) -> bool:
        return session.get("chunked", False)

    def _save_frame_json(self, session_id: str, response: PropagateDataResponse):
        """Save a frame response as JSON for the maskify endpoint."""
        try:
            output_dir = UPLOADS_PATH / session_id
            output_dir.mkdir(parents=True, exist_ok=True)
            frame_filename = output_dir / f"frame_{response.frame_index:05d}.json"
            frame_data = {
                "frame_index": response.frame_index,
                "results": [
                    {
                        "object_id": r.object_id,
                        "mask": {"size": r.mask.size, "counts": r.mask.counts},
                    }
                    for r in response.results
                ],
            }
            with open(frame_filename, "w") as f:
                json.dump(frame_data, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving frame JSON: {e}")

    def add_points(
        self, request: AddPointsRequest, test: str = ""
    ) -> PropagateDataResponse:
        with self.autocast_context(), self.inference_lock:
            session = self.__get_session(request.session_id)

            frame_idx = request.frame_index
            obj_id = request.object_id
            points = request.points
            labels = request.labels
            clear_old_points = request.clear_old_points

            if self._is_chunked(session):
                return self._add_points_chunked(
                    session, request.session_id, frame_idx, obj_id, points, labels, clear_old_points
                )

            inference_state = session["state"]

            frame_idx, object_ids, masks = self.predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=frame_idx,
                obj_id=obj_id,
                points=points,
                labels=labels,
                clear_old_points=clear_old_points,
                normalize_coords=False,
            )

            masks_binary = (masks > self.score_thresh)[:, 0].cpu().numpy()

            rle_mask_list = self.__get_rle_mask_list(
                object_ids=object_ids, masks=masks_binary
            )

            response = PropagateDataResponse(
                frame_index=frame_idx,
                results=rle_mask_list,
            )

            self._save_frame_json(request.session_id, response)
            return response

    def _add_points_chunked(
        self, session: Dict, session_id: str,
        frame_idx: int, obj_id: int, points, labels, clear_old_points: bool,
    ) -> PropagateDataResponse:
        """Handle add_points for chunked sessions: store inputs + preview via tiny chunk."""
        cs: ChunkedSessionState = session["chunked_state"]

        # Store the point input for later replay during propagation
        if obj_id not in cs.point_inputs:
            cs.point_inputs[obj_id] = {}
        cs.point_inputs[obj_id][frame_idx] = {
            "points": points,
            "labels": labels,
            "clear_old_points": clear_old_points,
        }

        # Track obj_id in the stub state
        if obj_id not in session["state"]["obj_ids"]:
            session["state"]["obj_ids"].append(obj_id)

        # Create a tiny preview chunk (~10 frames) around the clicked frame
        preview_radius = 5
        preview_start = max(0, frame_idx - preview_radius)
        preview_end = min(cs.num_frames, frame_idx + preview_radius)

        chunk_dir = self._create_chunk_dir(cs, preview_start, preview_end, "preview")
        offload_video_to_cpu = self.device.type in ["mps", "cuda"]

        try:
            inference_state = self.predictor.init_state(
                str(chunk_dir),
                offload_video_to_cpu=offload_video_to_cpu,
                async_loading_frames=False,
            )

            local_idx = frame_idx - preview_start
            local_idx, object_ids, masks = self.predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=local_idx,
                obj_id=obj_id,
                points=points,
                labels=labels,
                clear_old_points=clear_old_points,
                normalize_coords=False,
            )

            masks_binary = (masks > self.score_thresh)[:, 0].cpu().numpy()
            rle_mask_list = self.__get_rle_mask_list(object_ids=object_ids, masks=masks_binary)

            response = PropagateDataResponse(
                frame_index=frame_idx,  # Return global frame index
                results=rle_mask_list,
            )

            self._save_frame_json(session_id, response)

            self.predictor.reset_state(inference_state)
            del inference_state
            return response
        finally:
            self._cleanup_chunk_dir(chunk_dir)
            if self.device.type == "cuda":
                torch.cuda.empty_cache()

    def add_mask(self, request: AddMaskRequest) -> PropagateDataResponse:
        """Add a mask on a specific video frame."""
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            frame_idx = request.frame_index
            obj_id = request.object_id
            rle_mask = {
                "counts": request.mask.counts,
                "size": request.mask.size,
            }

            session = self.__get_session(session_id)

            if self._is_chunked(session):
                cs: ChunkedSessionState = session["chunked_state"]
                # Store mask input for replay during propagation
                if obj_id not in cs.mask_inputs:
                    cs.mask_inputs[obj_id] = {}
                cs.mask_inputs[obj_id][frame_idx] = rle_mask
                if obj_id not in session["state"]["obj_ids"]:
                    session["state"]["obj_ids"].append(obj_id)

                # Return the mask as-is (it was provided by the user)
                mask = decode_masks(rle_mask)
                masks_binary = np.array(mask > 0, dtype=np.uint8)
                rle_result = encode_masks(np.asfortranarray(masks_binary))
                rle_result["counts"] = rle_result["counts"].decode()
                return PropagateDataResponse(
                    frame_index=frame_idx,
                    results=[PropagateDataValue(
                        object_id=obj_id,
                        mask=Mask(size=rle_result["size"], counts=rle_result["counts"]),
                    )],
                )

            mask = decode_masks(rle_mask)

            logger.info(
                f"add mask on frame {frame_idx} in session {session_id}: {obj_id=}, {mask.shape=}"
            )
            inference_state = session["state"]

            frame_idx, obj_ids, video_res_masks = self.predictor.add_new_mask(
                inference_state=inference_state,
                frame_idx=frame_idx,
                obj_id=obj_id,
                mask=torch.tensor(mask > 0),
            )
            masks_binary = (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()

            rle_mask_list = self.__get_rle_mask_list(
                object_ids=obj_ids, masks=masks_binary
            )

            return PropagateDataResponse(
                frame_index=frame_idx,
                results=rle_mask_list,
            )

    def clear_points_in_frame(
        self, request: ClearPointsInFrameRequest
    ) -> PropagateDataResponse:
        """Remove all input points in a specific frame."""
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            frame_idx = request.frame_index
            obj_id = request.object_id

            logger.info(
                f"clear inputs on frame {frame_idx} in session {session_id}: {obj_id=}"
            )
            session = self.__get_session(session_id)

            if self._is_chunked(session):
                cs: ChunkedSessionState = session["chunked_state"]
                # Remove stored inputs for this object on this frame
                if obj_id in cs.point_inputs and frame_idx in cs.point_inputs[obj_id]:
                    del cs.point_inputs[obj_id][frame_idx]
                if obj_id in cs.mask_inputs and frame_idx in cs.mask_inputs[obj_id]:
                    del cs.mask_inputs[obj_id][frame_idx]
                # Return an empty mask response
                return PropagateDataResponse(frame_index=frame_idx, results=[])

            inference_state = session["state"]
            frame_idx, obj_ids, video_res_masks = (
                self.predictor.clear_all_prompts_in_frame(
                    inference_state, frame_idx, obj_id
                )
            )
            masks_binary = (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()

            rle_mask_list = self.__get_rle_mask_list(
                object_ids=obj_ids, masks=masks_binary
            )

            return PropagateDataResponse(
                frame_index=frame_idx,
                results=rle_mask_list,
            )

    def clear_points_in_video(
        self, request: ClearPointsInVideoRequest
    ) -> ClearPointsInVideoResponse:
        """Remove all input points in all frames throughout the video."""
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            logger.info(f"clear all inputs across the video in session {session_id}")
            session = self.__get_session(session_id)

            if self._is_chunked(session):
                cs: ChunkedSessionState = session["chunked_state"]
                cs.point_inputs.clear()
                cs.mask_inputs.clear()
                session["state"]["obj_ids"] = []
                return ClearPointsInVideoResponse(success=True)

            inference_state = session["state"]
            self.predictor.reset_state(inference_state)
            return ClearPointsInVideoResponse(success=True)

    def remove_object(self, request: RemoveObjectRequest) -> RemoveObjectResponse:
        """Remove an object id from the tracking state."""
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            obj_id = request.object_id
            logger.info(f"remove object in session {session_id}: {obj_id=}")
            session = self.__get_session(session_id)

            if self._is_chunked(session):
                cs: ChunkedSessionState = session["chunked_state"]
                cs.point_inputs.pop(obj_id, None)
                cs.mask_inputs.pop(obj_id, None)
                if obj_id in session["state"]["obj_ids"]:
                    session["state"]["obj_ids"].remove(obj_id)
                return RemoveObjectResponse(results=[])

            inference_state = session["state"]
            new_obj_ids, updated_frames = self.predictor.remove_object(
                inference_state, obj_id
            )

            results = []
            for frame_index, video_res_masks in updated_frames:
                masks = (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()
                rle_mask_list = self.__get_rle_mask_list(
                    object_ids=new_obj_ids, masks=masks
                )
                results.append(
                    PropagateDataResponse(
                        frame_index=frame_index,
                        results=rle_mask_list,
                    )
                )

            return RemoveObjectResponse(results=results)

    def propagate_in_video(
        self, request: PropagateInVideoRequest
    ) -> Generator[PropagateDataResponse, None, None]:
        """Propagate existing input points in all frames to track the object across video."""
        session_id = request.session_id
        start_frame_idx = request.start_frame_index

        with self.autocast_context(), self.inference_lock:
            try:
                session = self.__get_session(session_id)
                session["canceled"] = False

                if self._is_chunked(session):
                    logger.info(f"[CHUNKED] Starting chunked propagation for session {session_id}")
                    yield from self._propagate_chunked(session, session_id, start_frame_idx)
                    return

                # --- Normal (non-chunked) propagation ---
                inference_state = session["state"]

                logger.info(
                    f"propagate in video in session {session_id}: "
                    f"start_frame_idx={start_frame_idx}"
                )
                logger.warning(f"[MEMORY DEBUG] Before propagation:")
                self._log_memory_stats()

                self.__clear_non_cond_outputs(inference_state)

                # Forward propagation
                for outputs in self.predictor.propagate_in_video(
                    inference_state=inference_state,
                    start_frame_idx=start_frame_idx,
                    reverse=False,
                ):
                    if session["canceled"]:
                        return None

                    frame_idx, obj_ids, video_res_masks = outputs
                    masks_binary = (
                        (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()
                    )
                    rle_mask_list = self.__get_rle_mask_list(
                        object_ids=obj_ids, masks=masks_binary
                    )
                    yield PropagateDataResponse(
                        frame_index=frame_idx,
                        results=rle_mask_list,
                    )

                # Backward propagation
                for outputs in self.predictor.propagate_in_video(
                    inference_state=inference_state,
                    start_frame_idx=start_frame_idx,
                    reverse=True,
                ):
                    if session["canceled"]:
                        return None

                    frame_idx, obj_ids, video_res_masks = outputs
                    masks_binary = (
                        (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()
                    )
                    rle_mask_list = self.__get_rle_mask_list(
                        object_ids=obj_ids, masks=masks_binary
                    )
                    yield PropagateDataResponse(
                        frame_index=frame_idx,
                        results=rle_mask_list,
                    )

            except Exception as e:
                logger.error(f"[MEMORY DEBUG] Exception during propagation: {type(e).__name__}: {e}")
                self._log_memory_stats()
                raise
            finally:
                logger.warning(f"[MEMORY DEBUG] After propagation:")
                self._log_memory_stats()
                logger.info(
                    f"propagation ended in session {session_id}; {self.__get_session_stats()}"
                )

    def cancel_propagate_in_video(
        self, request: CancelPropagateInVideoRequest
    ) -> CancelPorpagateResponse:
        session = self.__get_session(request.session_id)
        session["canceled"] = True
        return CancelPorpagateResponse(success=True)

    # ------------------------------------------------------------------ #
    #  Chunked propagation helpers                                        #
    # ------------------------------------------------------------------ #

    def _create_chunk_dir(self, cs: ChunkedSessionState, start: int, end: int, label: str) -> Path:
        """Create a temp dir with symlinks: 00000.jpg -> all_frames/{start:05d}.jpg, etc."""
        chunk_dir = cs.session_dir / f"chunk_{label}_{start}_{end}"
        chunk_dir.mkdir(parents=True, exist_ok=True)

        for local_idx, global_idx in enumerate(range(start, end)):
            src = cs.all_frames_dir / f"{global_idx:05d}.jpg"
            dst = chunk_dir / f"{local_idx:05d}.jpg"
            if not dst.exists() and src.exists():
                os.symlink(src, dst)

        return chunk_dir

    def _cleanup_chunk_dir(self, chunk_dir: Path):
        """Remove a temporary chunk directory."""
        try:
            shutil.rmtree(chunk_dir, ignore_errors=True)
        except Exception as e:
            logger.warning(f"[CHUNKED] Failed to clean up {chunk_dir}: {e}")

    def _replay_inputs_for_chunk(
        self, cs: ChunkedSessionState, inference_state, chunk_start: int, chunk_end: int
    ):
        """Replay all stored point_inputs and mask_inputs that fall within [chunk_start, chunk_end)."""
        # Replay point inputs
        for obj_id, frames in cs.point_inputs.items():
            for frame_idx, inp in sorted(frames.items()):
                if chunk_start <= frame_idx < chunk_end:
                    local_idx = frame_idx - chunk_start
                    self.predictor.add_new_points_or_box(
                        inference_state=inference_state,
                        frame_idx=local_idx,
                        obj_id=obj_id,
                        points=inp["points"],
                        labels=inp["labels"],
                        clear_old_points=inp["clear_old_points"],
                        normalize_coords=False,
                    )

        # Replay mask inputs
        for obj_id, frames in cs.mask_inputs.items():
            for frame_idx, rle_mask in sorted(frames.items()):
                if chunk_start <= frame_idx < chunk_end:
                    local_idx = frame_idx - chunk_start
                    mask = decode_masks(rle_mask)
                    self.predictor.add_new_mask(
                        inference_state=inference_state,
                        frame_idx=local_idx,
                        obj_id=obj_id,
                        mask=torch.tensor(mask > 0),
                    )

    def _extract_boundary_masks(self, inference_state, local_frame_idx):
        """
        Extract the predicted mask at a given local frame index for all objects.
        Returns {obj_id: binary_mask_tensor} for use as boundary seeds.
        """
        boundary_masks = {}
        output_dict_per_obj = inference_state.get("output_dict_per_obj", {})
        obj_idx_to_id = inference_state.get("obj_idx_to_id", {})

        for obj_idx, obj_output in output_dict_per_obj.items():
            obj_id = obj_idx_to_id.get(obj_idx, obj_idx)
            # Check both cond and non-cond outputs for the mask at this frame
            mask_logits = None
            for output_key in ["cond_frame_outputs", "non_cond_frame_outputs"]:
                if local_frame_idx in obj_output.get(output_key, {}):
                    mask_logits = obj_output[output_key][local_frame_idx].get("pred_masks")
                    break

            if mask_logits is not None:
                # mask_logits shape: [1, 1, H_model, W_model] — threshold it
                binary = (mask_logits > self.score_thresh).squeeze()
                boundary_masks[obj_id] = binary.cpu()

        return boundary_masks

    def _propagate_chunk(
        self,
        cs: ChunkedSessionState,
        session: Dict,
        chunk_start: int,
        chunk_end: int,
        label: str,
        seed_masks: Optional[Dict[int, Any]] = None,
        seed_local_frame: int = 0,
        propagate_reverse: bool = False,
        propagate_start_local: Optional[int] = None,
    ) -> Generator[PropagateDataResponse, None, None]:
        """
        Process a single chunk: init_state, seed boundary masks, replay inputs, propagate.
        Yields PropagateDataResponse with global frame indices.
        Returns boundary masks from the edge frame for chaining to the next chunk.
        """
        chunk_dir = self._create_chunk_dir(cs, chunk_start, chunk_end, label)
        offload_video_to_cpu = self.device.type in ["mps", "cuda"]

        try:
            inference_state = self.predictor.init_state(
                str(chunk_dir),
                offload_video_to_cpu=offload_video_to_cpu,
                async_loading_frames=False,
            )

            # Seed boundary masks from the previous chunk
            if seed_masks:
                for obj_id, mask_tensor in seed_masks.items():
                    self.predictor.add_new_mask(
                        inference_state=inference_state,
                        frame_idx=seed_local_frame,
                        obj_id=obj_id,
                        mask=mask_tensor,
                    )

            # Replay user inputs that fall within this chunk's range
            self._replay_inputs_for_chunk(cs, inference_state, chunk_start, chunk_end)

            # Determine start frame for propagation within this chunk
            if propagate_start_local is None:
                propagate_start_local = seed_local_frame

            # Propagate
            for outputs in self.predictor.propagate_in_video(
                inference_state=inference_state,
                start_frame_idx=propagate_start_local,
                reverse=propagate_reverse,
            ):
                if session["canceled"]:
                    return

                local_idx, obj_ids, video_res_masks = outputs
                global_idx = local_idx + chunk_start
                masks_binary = (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()
                rle_mask_list = self.__get_rle_mask_list(
                    object_ids=obj_ids, masks=masks_binary
                )
                yield PropagateDataResponse(
                    frame_index=global_idx,
                    results=rle_mask_list,
                )

            # Extract boundary masks from the edge of this chunk
            chunk_len = chunk_end - chunk_start
            if propagate_reverse:
                edge_local = 0
            else:
                edge_local = chunk_len - 1
            self._last_boundary_masks = self._extract_boundary_masks(inference_state, edge_local)

            # Cleanup SAM2 state
            self.predictor.reset_state(inference_state)
            del inference_state

        finally:
            self._cleanup_chunk_dir(chunk_dir)
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
            import gc
            gc.collect()

    def _propagate_chunked(
        self,
        session: Dict,
        session_id: str,
        start_frame_idx: int,
    ) -> Generator[PropagateDataResponse, None, None]:
        """
        Core chunked propagation logic. Processes the video in chunks,
        passing boundary masks between chunks to maintain tracking continuity.
        """
        cs: ChunkedSessionState = session["chunked_state"]
        N = cs.num_frames
        chunk_size = cs.chunk_size

        logger.warning(f"[CHUNKED] Propagating: N={N}, chunk_size={chunk_size}, start_frame={start_frame_idx}")
        self._log_memory_stats()

        # --- Phase A: Initial chunk (contains the start frame) ---
        initial_start = max(0, start_frame_idx - chunk_size // 2)
        initial_end = min(N, initial_start + chunk_size)
        # Adjust start if end was clamped
        initial_start = max(0, initial_end - chunk_size)
        local_start = start_frame_idx - initial_start

        logger.warning(f"[CHUNKED] Phase A: initial chunk [{initial_start}, {initial_end}), local_start={local_start}")

        # Forward pass within initial chunk
        self._last_boundary_masks = {}
        for response in self._propagate_chunk(
            cs, session, initial_start, initial_end,
            label="init_fwd",
            propagate_reverse=False,
            propagate_start_local=local_start,
        ):
            yield response
        if session["canceled"]:
            return
        forward_boundary = dict(self._last_boundary_masks)

        # Backward pass within initial chunk
        self._last_boundary_masks = {}
        for response in self._propagate_chunk(
            cs, session, initial_start, initial_end,
            label="init_bwd",
            propagate_reverse=True,
            propagate_start_local=local_start,
        ):
            yield response
        if session["canceled"]:
            return
        backward_boundary = dict(self._last_boundary_masks)

        # --- Phase B: Forward continuation chunks ---
        cursor = initial_end
        fwd_boundary = forward_boundary
        chunk_num = 0
        while cursor < N:
            if session["canceled"]:
                return
            c_start = cursor
            c_end = min(N, cursor + chunk_size)
            chunk_num += 1

            logger.warning(f"[CHUNKED] Phase B: forward chunk {chunk_num} [{c_start}, {c_end})")

            self._last_boundary_masks = {}
            for response in self._propagate_chunk(
                cs, session, c_start, c_end,
                label=f"fwd_{chunk_num}",
                seed_masks=fwd_boundary,
                seed_local_frame=0,  # Seed at start of chunk (boundary from previous)
                propagate_reverse=False,
                propagate_start_local=0,
            ):
                yield response

            if session["canceled"]:
                return
            fwd_boundary = dict(self._last_boundary_masks)
            cursor = c_end

        # --- Phase C: Backward continuation chunks ---
        cursor = initial_start
        bwd_boundary = backward_boundary
        chunk_num = 0
        while cursor > 0:
            if session["canceled"]:
                return
            c_end = cursor
            c_start = max(0, cursor - chunk_size)
            chunk_num += 1
            chunk_len = c_end - c_start

            logger.warning(f"[CHUNKED] Phase C: backward chunk {chunk_num} [{c_start}, {c_end})")

            self._last_boundary_masks = {}
            for response in self._propagate_chunk(
                cs, session, c_start, c_end,
                label=f"bwd_{chunk_num}",
                seed_masks=bwd_boundary,
                seed_local_frame=chunk_len - 1,  # Seed at end of chunk (boundary from next)
                propagate_reverse=True,
                propagate_start_local=chunk_len - 1,
            ):
                yield response

            if session["canceled"]:
                return
            bwd_boundary = dict(self._last_boundary_masks)
            cursor = c_start

        logger.warning(f"[CHUNKED] Propagation complete for session {session_id}")

    def __clear_non_cond_outputs(self, inference_state, obj_ids=None):
        """Clear non-conditioning frame outputs to force re-computation during re-propagation."""
        output_dict = inference_state["output_dict_per_obj"]
        frames_tracked = inference_state["frames_tracked_per_obj"]

        for obj_idx, obj_output in output_dict.items():
            if obj_ids is not None:
                obj_id = next(
                    (k for k, v in inference_state["obj_id_to_idx"].items() if v == obj_idx),
                    None
                )
                if obj_id not in obj_ids:
                    continue

            obj_output["non_cond_frame_outputs"].clear()

            if obj_idx in frames_tracked:
                frames_tracked[obj_idx].clear()

    def __get_rle_mask_list(
        self, object_ids: List[int], masks: np.ndarray
    ) -> List[PropagateDataValue]:
        """
        Return a list of data values, i.e. list of object/mask combos.
        """
        return [
            self.__get_mask_for_object(object_id=object_id, mask=mask)
            for object_id, mask in zip(object_ids, masks)
        ]

    def __get_mask_for_object(
        self, object_id: int, mask: np.ndarray
    ) -> PropagateDataValue:
        """
        Create a data value for an object/mask combo.
        """
        mask_rle = encode_masks(np.array(mask, dtype=np.uint8, order="F"))
        mask_rle["counts"] = mask_rle["counts"].decode()
        return PropagateDataValue(
            object_id=object_id,
            mask=Mask(
                size=mask_rle["size"],
                counts=mask_rle["counts"],
            ),
        )

    def __get_session(self, session_id: str):
        session = self.session_states.get(session_id, None)
        if session is None:
            raise RuntimeError(
                f"Cannot find session {session_id}; it might have expired"
            )
        return session

    def _log_memory_stats(self):
        """Log detailed memory statistics for debugging."""
        import psutil
        import os

        # System memory with detailed breakdown
        vm = psutil.virtual_memory()
        logger.warning(f"  System RAM breakdown:")
        logger.warning(f"    Total: {vm.total / 1024**2:.1f} MB")
        logger.warning(f"    Available: {vm.available / 1024**2:.1f} MB (what apps can use)")
        logger.warning(f"    Used: {vm.used / 1024**2:.1f} MB ({vm.percent:.1f}%)")
        logger.warning(f"    Free: {vm.free / 1024**2:.1f} MB (completely unused)")
        logger.warning(f"    Cached: {vm.cached / 1024**2:.1f} MB (disk cache, can be freed)")
        logger.warning(f"    Buffers: {vm.buffers / 1024**2:.1f} MB (kernel buffers)")

        # Show active memory (used excluding cache/buffers)
        # active = total - free - cached - buffers
        active_used = vm.total - vm.free - vm.cached - vm.buffers
        logger.warning(f"    Active (apps + system): ~{active_used / 1024**2:.1f} MB")

        # Process memory
        process = psutil.Process(os.getpid())
        process_mem = process.memory_info()
        logger.warning(f"  This process (PID {os.getpid()}):")
        logger.warning(f"    RSS (real memory): {process_mem.rss / 1024**2:.1f} MB")
        logger.warning(f"    VMS (virtual): {process_mem.vms / 1024**2:.1f} MB")

        # GPU memory if available
        if torch.cuda.is_available():
            logger.warning(f"  GPU memory:")
            logger.warning(f"    Allocated: {torch.cuda.memory_allocated() / 1024**2:.1f} MB")
            logger.warning(f"    Reserved: {torch.cuda.memory_reserved() / 1024**2:.1f} MB")
            logger.warning(f"    Free: {(torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_reserved()) / 1024**2:.1f} MB")

    def __get_session_stats(self):
        """Get a statistics string for live sessions and their GPU usage."""
        live_session_strs = []
        for session_id, session in self.session_states.items():
            if session.get("chunked", False):
                cs = session["chunked_state"]
                live_session_strs.append(
                    f"'{session_id}' (CHUNKED {cs.num_frames} frames, chunk_size={cs.chunk_size})"
                )
            else:
                live_session_strs.append(
                    f"'{session_id}' ({session['state']['num_frames']} frames, "
                    f"{len(session['state']['obj_ids'])} objects)"
                )
        gpu_stats = ""
        if torch.cuda.is_available():
            gpu_stats = (
                f", GPU memory: {torch.cuda.memory_allocated() // 1024**2} MiB used and "
                f"{torch.cuda.memory_reserved() // 1024**2} MiB reserved"
            )
        return f"live sessions: [{', '.join(live_session_strs)}]{gpu_stats}"

    def __clear_session_state(self, session_id: str) -> bool:
        session = self.session_states.pop(session_id, None)
        if session is None:
            logger.warning(
                f"cannot close session {session_id} as it does not exist (it might have expired); "
                f"{self.__get_session_stats()}"
            )
            return False
        else:
            try:
                # Chunked session cleanup
                if session.get("chunked", False):
                    cs: ChunkedSessionState = session["chunked_state"]
                    # Remove all_frames directory
                    if cs.all_frames_dir.exists():
                        shutil.rmtree(cs.all_frames_dir, ignore_errors=True)
                        logger.info(f"[CHUNKED] Removed all_frames dir for session {session_id}")
                    # Remove any leftover chunk_* temp dirs
                    if cs.session_dir.exists():
                        for chunk_dir in cs.session_dir.glob("chunk_*"):
                            shutil.rmtree(chunk_dir, ignore_errors=True)
                    del session
                    import gc
                    gc.collect()
                    if self.device.type == "cuda":
                        torch.cuda.empty_cache()
                    logger.info(f"removed chunked session {session_id}; {self.__get_session_stats()}")
                    return True

                # Normal session cleanup
                inference_state = session.get("state")
                if inference_state is not None and isinstance(inference_state, dict):
                    for key in ['obj_id_to_frames', 'obj_id_to_idx', 'output_dict_per_obj',
                                'frames_tracked_per_obj', 'obj_ids', 'obj_idx_to_id']:
                        if key in inference_state:
                            if isinstance(inference_state[key], dict):
                                inference_state[key].clear()
                            elif isinstance(inference_state[key], list):
                                inference_state[key].clear()

                    if 'images' in inference_state:
                        del inference_state['images']
                    if 'video_segments' in inference_state:
                        del inference_state['video_segments']

                del session

                import gc
                gc.collect()

                if self.device.type == "cuda":
                    torch.cuda.empty_cache()
                    logger.info(f"GPU memory cleaned for session {session_id}")

            except Exception as e:
                logger.warning(f"Error during cleanup for session {session_id}: {e}")

            logger.info(f"removed session {session_id}; {self.__get_session_stats()}")
            return True

    def get_model_info(self) -> Dict[str, Any]:
        """Get comprehensive model information including resolution and resource usage."""
        # Get GPU memory info if available
        gpu_memory_info = {}
        if torch.cuda.is_available():
            gpu_memory_info = {
                "gpu_memory_used_mb": torch.cuda.memory_allocated() // 1024**2,
                "gpu_memory_reserved_mb": torch.cuda.memory_reserved() // 1024**2,
                "gpu_memory_total_mb": torch.cuda.get_device_properties(0).total_memory // 1024**2,
            }
        
        # Calculate estimated frame capacity
        available_memory = gpu_memory_info.get("gpu_memory_total_mb", 10000)
        estimated_max_frames = get_max_frames(self.model_size, self.resolution, available_memory)
        memory_per_frame = get_memory_per_frame(self.model_size, self.resolution)
        
        return {
            "model_size": self.model_size,
            "resolution": self.resolution,
            "model_info": self.model_info,
            "estimated_max_frames": estimated_max_frames,
            "memory_per_frame_mb": memory_per_frame,
            "device": str(self.device),
            "active_sessions": len(self.session_states),
            **gpu_memory_info
        }

    def get_resource_usage(self) -> Dict[str, Any]:
        """Get current resource usage statistics."""
        return {
            "active_sessions": len(self.session_states),
            "model_size": self.model_size,
            "resolution": self.resolution,
            "memory_per_frame_mb": get_memory_per_frame(self.model_size, self.resolution),
            "device": str(self.device),
            "session_stats": self.__get_session_stats()
        }
