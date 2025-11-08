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

    def autocast_context(self):
        if self.device.type == "cuda":
            return torch.autocast("cuda", dtype=torch.bfloat16)
        else:
            return contextlib.nullcontext()

    def start_session(self, request: StartSessionRequest) -> StartSessionResponse:
        with self.autocast_context(), self.inference_lock:
            session_id = str(uuid.uuid4())
            # Offload video frames to CPU to save GPU memory for longer videos
            # This helps process more frames at the cost of slightly slower inference
            offload_video_to_cpu = self.device.type in ["mps", "cuda"]  # Enable for CUDA as well
            inference_state = self.predictor.init_state(
                request.path,
                offload_video_to_cpu=offload_video_to_cpu,
            )
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
            finally:
                # Log upon completion (so that e.g. we can see if two propagations happen in parallel).
                # Using `finally` here to log even when the tracking is aborted with GeneratorExit.
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
            # Clean up GPU memory when closing session
            if self.device.type == "cuda":
                try:
                    # Try to clear any session-specific GPU memory
                    inference_state = session.get("state")
                    if inference_state is not None:
                        # Clear any cached tensors in the inference state
                        if hasattr(inference_state, 'obj_id_to_frames'):
                            inference_state.obj_id_to_frames.clear()
                        if hasattr(inference_state, 'obj_id_to_idx'):
                            inference_state.obj_id_to_idx.clear()
                    
                    # Force GPU memory cleanup
                    torch.cuda.empty_cache()
                    logger.info(f"GPU memory cleaned for session {session_id}")
                except Exception as e:
                    logger.warning(f"Failed to clean GPU memory for session {session_id}: {e}")
            
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
