# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import contextlib
import json
import logging
import os
import uuid
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Generator, List

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
    get_memory_per_frame
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
            # This prevents memory buildup from unclosed sessions
            if len(self.session_states) > 2:
                logger.warning(f"[MEMORY DEBUG] Cleaning up old sessions (have {len(self.session_states)} active)")
                # Get oldest sessions (by session_id which includes timestamp)
                sessions_to_close = sorted(self.session_states.keys())[:-2]  # Keep only 2 most recent
                for old_sid in sessions_to_close:
                    logger.warning(f"[MEMORY DEBUG] Auto-closing old session: {old_sid}")
                    self.__clear_session_state(old_sid)

            # Pre-check video to estimate memory requirements and prevent OOM
            import av
            import psutil
            import os

            # Initialize variables at function scope to avoid UnboundLocalError
            process_memory_mb = 0
            stop_monitoring = None

            try:
                with av.open(request.path) as container:
                    video_stream = container.streams.video[0]
                    num_frames = video_stream.frames
                    if num_frames == 0:
                        # Fallback: estimate from duration and fps
                        duration = float(video_stream.duration * video_stream.time_base) if video_stream.duration else 0
                        fps = float(video_stream.average_rate) if video_stream.average_rate else 24
                        num_frames = int(duration * fps)

                    width = video_stream.width
                    height = video_stream.height

                    logger.warning(f"[MEMORY CHECK] Video stats: {num_frames} frames, {width}x{height}")

                    # Check frame count limits based on model size (with async loading)
                    max_frames_recommendation = {
                        "small": 1500,  # Increased from 1000 with async loading
                        "base_plus": 1000,  # Increased from 600 with async loading
                        "large": 600  # Increased from 400 with async loading
                    }.get(self.model_size, 1000)

                    if num_frames > max_frames_recommendation:
                        logger.error(f"[MEMORY CHECK] ERROR: Video has {num_frames} frames, exceeds recommendation of {max_frames_recommendation} for {self.model_size} model!")
                        raise RuntimeError(
                            f"Video has too many frames ({num_frames}) for the '{self.model_size}' model preset. "
                            f"Recommended maximum: {max_frames_recommendation} frames. "
                            f"Please: (1) Use 'small' model preset for longer videos, (2) Trim video to ~{max_frames_recommendation//24} seconds, or (3) Reduce frame rate."
                        )
                    elif num_frames > max_frames_recommendation * 0.8:
                        logger.warning(f"[MEMORY CHECK] WARNING: Video has {num_frames} frames, close to limit of {max_frames_recommendation} for {self.model_size} model")
                        logger.warning(f"[MEMORY CHECK] Memory may be tight. Consider: (1) Using 'small' model preset, (2) Trimming video, or (3) Reducing frame rate")

                    # Calculate estimated memory needed using model-specific multiplier
                    # SAM2 uses more memory than raw frames due to:
                    # - Video decoding buffers, preprocessing, embeddings, tracking state
                    # - Model-specific multiplier based on model size (small=1.5x, base_plus=2.5x, large=4.0x)
                    # Note: We offload video frames to CPU, so this is RAM (not GPU) constraint
                    from resolution_config import RESOLUTION_CONFIGS

                    # Debug: log what model_size we have
                    logger.warning(f"[MEMORY CHECK] self.model_size = '{self.model_size}' (type: {type(self.model_size).__name__})")

                    model_config = RESOLUTION_CONFIGS.get(self.model_size, RESOLUTION_CONFIGS["base_plus"])
                    memory_multiplier = model_config.get("memory_multiplier", 2.5)

                    # If model_size is empty/None, log a warning
                    if not self.model_size:
                        logger.error(f"[MEMORY CHECK] WARNING: model_size is empty! Using fallback base_plus config")

                    bytes_per_frame = width * height * 3 * memory_multiplier
                    estimated_memory_mb = (num_frames * bytes_per_frame) / (1024 ** 2)

                    # Get available system memory (conservative limit for container)
                    available_memory_mb = psutil.virtual_memory().available / (1024 ** 2)
                    total_memory_mb = psutil.virtual_memory().total / (1024 ** 2)

                    # Get current process memory usage
                    process = psutil.Process(os.getpid())
                    process_memory_mb = process.memory_info().rss / (1024 ** 2)

                    # Check for Docker/cgroup memory limits
                    docker_memory_limit_mb = None
                    try:
                        # Try to read cgroup memory limit (Docker container)
                        with open('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'r') as f:
                            limit_bytes = int(f.read().strip())
                            # Check if it's not the default "unlimited" value
                            if limit_bytes < (1 << 62):  # Not unlimited
                                docker_memory_limit_mb = limit_bytes / (1024 ** 2)
                                logger.warning(f"[MEMORY CHECK] Docker memory limit detected: {docker_memory_limit_mb:.1f} MB")
                    except:
                        # Try cgroup v2 path
                        try:
                            with open('/sys/fs/cgroup/memory.max', 'r') as f:
                                limit_str = f.read().strip()
                                if limit_str != 'max':
                                    docker_memory_limit_mb = int(limit_str) / (1024 ** 2)
                                    logger.warning(f"[MEMORY CHECK] Docker memory limit detected (v2): {docker_memory_limit_mb:.1f} MB")
                        except:
                            pass

                    # Use Docker limit if it's lower than system available memory
                    if docker_memory_limit_mb and docker_memory_limit_mb < available_memory_mb:
                        logger.warning(f"[MEMORY CHECK] Using Docker limit ({docker_memory_limit_mb:.1f} MB) instead of available ({available_memory_mb:.1f} MB)")
                        available_memory_mb = docker_memory_limit_mb

                    # Allow using up to 85% of available memory for video frames
                    # Keep minimal headroom for system stability
                    max_allowed_mb = available_memory_mb * 0.85

                    logger.warning(f"[MEMORY CHECK] Model: {self.model_size}, multiplier: {memory_multiplier}x")
                    logger.warning(f"[MEMORY CHECK] Total RAM: {total_memory_mb:.1f} MB, Available: {available_memory_mb:.1f} MB")
                    logger.warning(f"[MEMORY CHECK] Process currently using: {process_memory_mb:.1f} MB")
                    logger.warning(f"[MEMORY CHECK] Video needs: {estimated_memory_mb:.1f} MB")

                    # Calculate total memory that would be needed (process + video)
                    total_needed_mb = process_memory_mb + estimated_memory_mb
                    logger.warning(f"[MEMORY CHECK] Total needed (process + video): {total_needed_mb:.1f} MB")
                    logger.warning(f"[MEMORY CHECK] Max allowed: {max_allowed_mb:.1f} MB")

                    if total_needed_mb > max_allowed_mb:
                        # Suggest closing old sessions if there are any
                        active_sessions = len(self.session_states)
                        session_hint = ""
                        if active_sessions > 0:
                            session_hint = f" You have {active_sessions} session(s) still loaded. Try closing old sessions or refreshing the page."

                        raise RuntimeError(
                            f"Not enough memory to process video: {num_frames} frames at {width}x{height} "
                            f"would need ~{total_needed_mb:.0f}MB total (process: {process_memory_mb:.0f}MB + video: {estimated_memory_mb:.0f}MB) "
                            f"but only {max_allowed_mb:.0f}MB available.{session_hint} "
                            f"Try reducing video resolution/duration or using the 'small' model preset."
                        )

            except Exception as e:
                # Re-raise if it's one of our custom errors (memory or frame limit checks)
                if "too large to process" in str(e) or "too many frames" in str(e):
                    raise  # Re-raise our custom error
                logger.warning(f"Could not pre-check video: {e}. Proceeding anyway...")

            # Offload video frames to CPU to save GPU memory for longer videos
            # This helps process more frames at the cost of slightly slower inference
            offload_video_to_cpu = self.device.type in ["mps", "cuda"]  # Enable for CUDA as well

            # Log memory before loading video
            logger.warning(f"[MEMORY DEBUG] Before init_state:")
            self._log_memory_stats()

            # Check if we have too many existing sessions and warn
            active_sessions = len(self.session_states)
            if active_sessions > 0:
                logger.warning(f"[MEMORY DEBUG] WARNING: {active_sessions} existing session(s) still in memory!")
                logger.warning(f"[MEMORY DEBUG] Consider closing old sessions to free memory")
                # Log info about existing sessions
                for sid, session in self.session_states.items():
                    num_frames = session['state'].get('num_frames', 0)
                    logger.warning(f"[MEMORY DEBUG]   - Session {sid}: {num_frames} frames")

            # Clear GPU cache before loading new video
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
                logger.warning(f"[MEMORY DEBUG] Cleared GPU cache")

            # Monitor memory in a separate thread during init_state
            import threading
            import time
            peak_memory = [process_memory_mb]  # Use list to allow modification in thread
            stop_monitoring = threading.Event()

            try:

                def monitor_memory():
                    import psutil
                    import os
                    proc = psutil.Process(os.getpid())
                    while not stop_monitoring.is_set():
                        current = proc.memory_info().rss / (1024 ** 2)
                        if current > peak_memory[0]:
                            peak_memory[0] = current
                        time.sleep(0.5)  # Check every 500ms

                monitor_thread = threading.Thread(target=monitor_memory, daemon=True)
                monitor_thread.start()

                logger.warning(f"[MEMORY DEBUG] Starting init_state (this may take 30-60 seconds for large videos)...")
                inference_state = self.predictor.init_state(
                    request.path,
                    offload_video_to_cpu=offload_video_to_cpu,
                    async_loading_frames=True,  # Load frames lazily to reduce peak memory
                )

                stop_monitoring.set()
                monitor_thread.join(timeout=1.0)

                logger.warning(f"[MEMORY DEBUG] init_state completed successfully")
                logger.warning(f"[MEMORY DEBUG] Peak memory during init_state: {peak_memory[0]:.1f} MB (grew by {peak_memory[0] - process_memory_mb:.1f} MB)")

            except torch.cuda.OutOfMemoryError as e:
                if stop_monitoring is not None:
                    stop_monitoring.set()
                logger.error(f"[MEMORY DEBUG] GPU OOM during init_state: {e}")
                self._log_memory_stats()
                raise RuntimeError(
                    f"GPU out of memory while loading video. Try using a smaller model or reducing video resolution."
                )
            except MemoryError as e:
                if stop_monitoring is not None:
                    stop_monitoring.set()
                logger.error(f"[MEMORY DEBUG] System OOM during init_state: {e}")
                self._log_memory_stats()
                raise RuntimeError(
                    f"System out of memory while loading video. Try reducing video resolution or duration."
                )
            except Exception as e:
                if stop_monitoring is not None:
                    stop_monitoring.set()
                logger.error(f"[MEMORY DEBUG] Unexpected error during init_state: {type(e).__name__}: {e}")
                self._log_memory_stats()
                raise

            # Log memory after loading video
            logger.warning(f"[MEMORY DEBUG] After init_state:")
            self._log_memory_stats()
            logger.warning(f"[MEMORY DEBUG] Video loaded successfully: {inference_state['num_frames']} frames")

            self.session_states[session_id] = {
                "canceled": False,
                "state": inference_state,
            }
            return StartSessionResponse(session_id=session_id)

    def close_session(self, request: CloseSessionRequest) -> CloseSessionResponse:
        is_successful = self.__clear_session_state(request.session_id)
        return CloseSessionResponse(success=is_successful)

    def add_points(
        self, request: AddPointsRequest, test: str = ""
    ) -> PropagateDataResponse:
        with self.autocast_context(), self.inference_lock:
            session = self.__get_session(request.session_id)
            inference_state = session["state"]

            frame_idx = request.frame_index
            obj_id = request.object_id
            points = request.points
            labels = request.labels
            clear_old_points = request.clear_old_points

            # add new prompts and instantly get the output on the same frame
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

            # Create response object
            response = PropagateDataResponse(
                frame_index=frame_idx,
                results=rle_mask_list,
            )

            # Save frame data as JSON to the same folder structure as propagate_in_video
            try:
                output_dir = UPLOADS_PATH / request.session_id
                output_dir.mkdir(parents=True, exist_ok=True)

                # Save to file in the same format as propagate_in_video
                frame_filename = output_dir / f"frame_{frame_idx:05d}.json"

                # Manually create the frame data structure to match propagate_in_video format
                frame_data = {
                    "frame_index": response.frame_index,
                    "results": [
                        {
                            "object_id": result.object_id,
                            "mask": {
                                "size": result.mask.size,
                                "counts": result.mask.counts,
                            },
                        }
                        for result in response.results
                    ],
                }

                with open(frame_filename, "w") as f:
                    json.dump(frame_data, f, indent=2)

                logger.debug(f"Saved add_points frame {frame_idx} to {frame_filename}")
            except Exception as e:
                logger.error(f"Error saving add_points frame: {str(e)}")

            return response

    def add_mask(self, request: AddMaskRequest) -> PropagateDataResponse:
        """
        Add new points on a specific video frame.
        - mask is a numpy array of shape [H_im, W_im] (containing 1 for foreground and 0 for background).
        Note: providing an input mask would overwrite any previous input points on this frame.
        """
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            frame_idx = request.frame_index
            obj_id = request.object_id
            rle_mask = {
                "counts": request.mask.counts,
                "size": request.mask.size,
            }

            mask = decode_masks(rle_mask)

            logger.info(
                f"add mask on frame {frame_idx} in session {session_id}: {obj_id=}, {mask.shape=}"
            )
            session = self.__get_session(session_id)
            inference_state = session["state"]

            frame_idx, obj_ids, video_res_masks = self.model.add_new_mask(
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
        """
        Remove all input points in a specific frame.
        """
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            frame_idx = request.frame_index
            obj_id = request.object_id

            logger.info(
                f"clear inputs on frame {frame_idx} in session {session_id}: {obj_id=}"
            )
            session = self.__get_session(session_id)
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
        """
        Remove all input points in all frames throughout the video.
        """
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            logger.info(f"clear all inputs across the video in session {session_id}")
            session = self.__get_session(session_id)
            inference_state = session["state"]
            self.predictor.reset_state(inference_state)
            return ClearPointsInVideoResponse(success=True)

    def remove_object(self, request: RemoveObjectRequest) -> RemoveObjectResponse:
        """
        Remove an object id from the tracking state.
        """
        with self.autocast_context(), self.inference_lock:
            session_id = request.session_id
            obj_id = request.object_id
            logger.info(f"remove object in session {session_id}: {obj_id=}")
            session = self.__get_session(session_id)
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
        session_id = request.session_id
        start_frame_idx = request.start_frame_index
        propagation_direction = "both"
        max_frame_num_to_track = None

        """
        Propagate existing input points in all frames to track the object across video.
        """

        # Note that as this method is a generator, we also need to use autocast_context
        # in caller to this method to ensure that it's called under the correct context
        # (we've added `autocast_context` to `gen_track_with_mask_stream` in app.py).
        with self.autocast_context(), self.inference_lock:
            logger.info(
                f"propagate in video in session {session_id}: "
                f"{propagation_direction=}, {start_frame_idx=}, {max_frame_num_to_track=}"
            )

            # Log memory before propagation
            logger.warning(f"[MEMORY DEBUG] Before propagation:")
            self._log_memory_stats()

            try:
                session = self.__get_session(session_id)
                session["canceled"] = False

                inference_state = session["state"]
                if propagation_direction not in ["both", "forward", "backward"]:
                    raise ValueError(
                        f"invalid propagation direction: {propagation_direction}"
                    )

                self.__clear_non_cond_outputs(inference_state)

                # First doing the forward propagation
                if propagation_direction in ["both", "forward"]:
                    for outputs in self.predictor.propagate_in_video(
                        inference_state=inference_state,
                        start_frame_idx=start_frame_idx,
                        max_frame_num_to_track=max_frame_num_to_track,
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

                # Then doing the backward propagation (reverse in time)
                if propagation_direction in ["both", "backward"]:
                    for outputs in self.predictor.propagate_in_video(
                        inference_state=inference_state,
                        start_frame_idx=start_frame_idx,
                        max_frame_num_to_track=max_frame_num_to_track,
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
                # Log upon completion (so that e.g. we can see if two propagations happen in parallel).
                # Using `finally` here to log even when the tracking is aborted with GeneratorExit.
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
        # print both the session ids and their video frame numbers
        live_session_strs = [
            f"'{session_id}' ({session['state']['num_frames']} frames, "
            f"{len(session['state']['obj_ids'])} objects)"
            for session_id, session in self.session_states.items()
        ]
        session_stats_str = (
            "Test String Here - -"
            f"live sessions: [{', '.join(live_session_strs)}], GPU memory: "
            f"{torch.cuda.memory_allocated() // 1024**2} MiB used and "
            f"{torch.cuda.memory_reserved() // 1024**2} MiB reserved"
            f" (max over time: {torch.cuda.max_memory_allocated() // 1024**2} MiB used "
            f"and {torch.cuda.max_memory_reserved() // 1024**2} MiB reserved)"
        )
        return session_stats_str

    def __clear_session_state(self, session_id: str) -> bool:
        session = self.session_states.pop(session_id, None)
        if session is None:
            logger.warning(
                f"cannot close session {session_id} as it does not exist (it might have expired); "
                f"{self.__get_session_stats()}"
            )
            return False
        else:
            # Aggressively clean up session memory
            try:
                inference_state = session.get("state")
                if inference_state is not None:
                    # Clear all cached data structures
                    for key in ['obj_id_to_frames', 'obj_id_to_idx', 'output_dict_per_obj',
                                'frames_tracked_per_obj', 'obj_ids', 'obj_idx_to_id']:
                        if key in inference_state:
                            if isinstance(inference_state[key], dict):
                                inference_state[key].clear()
                            elif isinstance(inference_state[key], list):
                                inference_state[key].clear()

                    # Clear video frames if stored
                    if 'images' in inference_state:
                        del inference_state['images']
                    if 'video_segments' in inference_state:
                        del inference_state['video_segments']

                # Delete the session completely
                del session

                # Force Python garbage collection
                import gc
                gc.collect()

                # Clean up GPU memory
                if self.device.type == "cuda":
                    torch.cuda.empty_cache()
                    logger.info(f"GPU memory cleaned for session {session_id}")

            except Exception as e:
                logger.warning(f"Error during aggressive cleanup for session {session_id}: {e}")

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
