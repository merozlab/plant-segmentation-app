# filepath: /home/yasmine/alex/plant-segmentation-app/demo/backend/server/inference_app.py
# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import logging
from typing import Any, Generator
import requests
import os
import json

import app_conf
from app_conf import (
    API_URL,
    GALLERY_PATH,
    GALLERY_PREFIX,
    POSTERS_PATH,
    POSTERS_PREFIX,
    UPLOADS_PATH,
    UPLOADS_PREFIX,
)
from resolution_config import get_default_resolution
from data.loader import preload_data
from data.schema import schema
from data.store import set_videos
from flask import Flask, make_response, Request, request, Response, send_from_directory
from flask_cors import CORS
from inference.data_types import PropagateDataResponse, PropagateInVideoRequest
from inference.multipart import MultipartResponseBuilder
from inference.predictor import InferenceAPI
from strawberry.flask.views import GraphQLView

logger = logging.getLogger(__name__)

VIDEO_API_URL = os.getenv("VIDEO_API_URL", "http://localhost:7264")

app = Flask(__name__)
cors = CORS(app, supports_credentials=True)

videos = preload_data()
set_videos(videos)

inference_api = InferenceAPI()


@app.route("/healthy")
def healthy() -> Response:
    return make_response("OK", 200)


@app.route("/model_info")
def model_info() -> Response:
    """Get comprehensive model information including resolution and resource usage."""
    try:
        info = inference_api.get_model_info()
        return make_response(json.dumps(info), 200, {"Content-Type": "application/json"})
    except Exception as e:
        logger.error(f"Error getting model info: {e}")
        return make_response(json.dumps({"error": str(e)}), 500, {"Content-Type": "application/json"})


@app.route("/resource_usage")
def resource_usage() -> Response:
    """Get current resource usage statistics."""
    try:
        usage = inference_api.get_resource_usage()
        return make_response(json.dumps(usage), 200, {"Content-Type": "application/json"})
    except Exception as e:
        logger.error(f"Error getting resource usage: {e}")
        return make_response(json.dumps({"error": str(e)}), 500, {"Content-Type": "application/json"})


@app.route(f"/{GALLERY_PREFIX}/<path:path>", methods=["GET"])
def send_gallery_video(path: str) -> Response:
    try:
        return send_from_directory(
            GALLERY_PATH,
            path,
        )
    except:
        raise ValueError("resource not found")


@app.route(f"/{POSTERS_PREFIX}/<path:path>", methods=["GET"])
def send_poster_image(path: str) -> Response:
    try:
        return send_from_directory(
            POSTERS_PATH,
            path,
        )
    except:
        raise ValueError("resource not found")


@app.route(f"/{UPLOADS_PREFIX}/<path:path>", methods=["GET"])
def send_uploaded_video(path: str):
    try:
        return send_from_directory(
            UPLOADS_PATH,
            path,
        )
    except:
        raise ValueError("resource not found")


@app.route("/propagate_in_video", methods=["POST"])
def propagate_in_video() -> Response:
    data = request.json
    args = {
        "session_id": data["session_id"],
        "start_frame_index": data.get("start_frame_index", 0),
    }
    boundary = "frame"
    frame = gen_track_with_mask_stream(boundary, **args)
    return Response(frame, mimetype="multipart/x-savi-stream; boundary=" + boundary)


@app.route("/gpu_info", methods=["GET"])
def gpu_info() -> Response:
    """Return GPU memory information and estimated frame capacity for each model size"""
    try:
        import torch

        if not torch.cuda.is_available():
            # Import resolution config for fallback data
            from resolution_config import get_model_info
            
            fallback_estimates = {}
            fallback_data = {
                "tiny": {"max_frames": 800, "memory_per_frame": "~2MB"},
                "small": {"max_frames": 650, "memory_per_frame": "~3MB"},
                "base_plus": {"max_frames": 500, "memory_per_frame": "~4MB"},
                "large": {"max_frames": 300, "memory_per_frame": "~6MB"},
            }
            
            for model, estimates in fallback_data.items():
                model_info = get_model_info(model)
                fallback_estimates[model] = {
                    **estimates,
                    "resolutions": model_info["resolutions"],
                    "default_resolution": model_info["default_resolution"],
                    "description": model_info["description"],
                }
            
            return make_response(
                {
                    "gpu_available": False,
                    "total_memory": 0,
                    "model_estimates": fallback_estimates,
                    "current_resolution": app_conf.MODEL_RESOLUTION if app_conf.MODEL_RESOLUTION is not None else get_default_resolution(app_conf.MODEL_SIZE),
                },
                200,
            )

        # Get GPU memory info
        total_memory = torch.cuda.get_device_properties(0).total_memory
        allocated_memory = torch.cuda.memory_allocated(0)
        reserved_memory = torch.cuda.memory_reserved(0)
        available_memory = total_memory - reserved_memory

        # Estimate frame capacity based on empirical data
        # These are rough estimates based on typical SAM2 memory usage patterns
        base_memory_overhead = 2 * 1024**3  # 2GB base model overhead

        # Memory per frame estimates (in bytes) for each model
        memory_per_frame = {
            "tiny": 1.5 * 1024**2,  # ~1.5MB per frame
            "small": 2.5 * 1024**2,  # ~2.5MB per frame
            "base_plus": 4 * 1024**2,  # ~4MB per frame
            "large": 6 * 1024**2,  # ~6MB per frame
        }

        # Import resolution config
        from resolution_config import get_model_info
        
        model_estimates = {}
        for model, mem_per_frame in memory_per_frame.items():
            # Calculate usable memory (total - model overhead - buffer)
            usable_memory = max(
                0, available_memory - base_memory_overhead - (512 * 1024**2)
            )  # 512MB buffer
            estimated_frames = max(0, int(usable_memory / mem_per_frame))
            
            # Get resolution info from config
            model_info = get_model_info(model)

            model_estimates[model] = {
                "max_frames": estimated_frames,
                "memory_per_frame": f"~{mem_per_frame / (1024**2):.1f}MB",
                "resolutions": model_info["resolutions"],
                "default_resolution": model_info["default_resolution"],
                "description": model_info["description"],
            }

        return make_response(
            {
                "gpu_available": True,
                "total_memory": total_memory,
                "allocated_memory": allocated_memory,
                "reserved_memory": reserved_memory,
                "available_memory": available_memory,
                "model_estimates": model_estimates,
                "current_resolution": app_conf.MODEL_RESOLUTION if app_conf.MODEL_RESOLUTION is not None else get_default_resolution(app_conf.MODEL_SIZE),
            },
            200,
        )

    except Exception as e:
        # Import resolution config for error fallback
        from resolution_config import get_model_info
        
        error_estimates = {}
        error_data = {
            "tiny": {"max_frames": 800, "memory_per_frame": "~1.5MB"},
            "small": {"max_frames": 650, "memory_per_frame": "~2.5MB"},
            "base_plus": {"max_frames": 500, "memory_per_frame": "~4MB"},
            "large": {"max_frames": 300, "memory_per_frame": "~6MB"},
        }
        
        for model, estimates in error_data.items():
            model_info = get_model_info(model)
            error_estimates[model] = {
                **estimates,
                "resolutions": model_info["resolutions"],
                "default_resolution": model_info["default_resolution"],
                "description": model_info["description"],
            }
        
        return make_response(
            {
                "error": str(e),
                "gpu_available": False,
                "model_estimates": error_estimates,
                "current_resolution": app_conf.MODEL_RESOLUTION if app_conf.MODEL_RESOLUTION is not None else get_default_resolution(app_conf.MODEL_SIZE),
            },
            200,
        )


@app.route("/set_model_size", methods=["POST"])
def set_model_size() -> Response:
    """Change the SAM2 model size and optionally resolution"""
    try:
        data = request.json
        if not data or "model_size" not in data:
            return make_response({"error": "model_size parameter required"}, 400)

        model_size = data["model_size"]
        resolution = data.get("resolution")
        valid_sizes = ["tiny", "small", "base_plus", "large"]

        if model_size not in valid_sizes:
            return make_response(
                {"error": f"Invalid model size. Must be one of: {valid_sizes}"}, 400
            )

        # Validate resolution if provided
        if resolution is not None:
            from resolution_config import validate_resolution, get_model_resolutions
            
            if not validate_resolution(model_size, resolution):
                valid_resolutions = get_model_resolutions(model_size)
                return make_response(
                    {"error": f"Invalid resolution {resolution} for model {model_size}. Valid resolutions: {valid_resolutions}"}, 
                    400
                )

        # Update the model size in app_conf
        import app_conf

        app_conf.MODEL_SIZE = model_size
        
        # Update resolution if provided
        if resolution is not None:
            app_conf.MODEL_RESOLUTION = resolution

        # Note: This requires restarting the inference API to take effect
        # For now, we'll just return success and let the frontend know a restart is needed
        response_data = {
            "status": "success",
            "model_size": model_size,
            "message": "Model updated. Please restart the session for changes to take effect.",
        }
        
        if resolution is not None:
            response_data["resolution"] = resolution
            
        return make_response(response_data, 200)

    except Exception as e:
        return make_response({"error": str(e)}, 500)


@app.route("/presets", methods=["GET"])
def get_presets() -> Response:
    """Get all available preset configurations with memory estimates"""
    try:
        from resolution_config import get_all_presets, get_memory_per_frame, get_max_frames
        import torch

        presets = get_all_presets()

        # Add memory estimates if GPU available
        if torch.cuda.is_available():
            total_memory = torch.cuda.get_device_properties(0).total_memory
            available_memory_mb = (total_memory - torch.cuda.memory_reserved(0)) // 1024**2

            for preset_name, config in presets.items():
                model_size = config["model_size"]
                resolution = config["resolution"]

                memory_per_frame = get_memory_per_frame(model_size, resolution)
                max_frames = get_max_frames(model_size, resolution, available_memory_mb)

                config["memory_per_frame_mb"] = round(memory_per_frame, 2)
                config["estimated_max_frames"] = max_frames

        return make_response(json.dumps(presets), 200, {"Content-Type": "application/json"})

    except Exception as e:
        logger.error(f"Error getting presets: {e}")
        return make_response(json.dumps({"error": str(e)}), 500, {"Content-Type": "application/json"})


@app.route("/set_preset", methods=["POST"])
def set_preset() -> Response:
    """Set model configuration using a preset"""
    try:
        from resolution_config import get_preset_config

        data = request.json
        preset_name = data.get("preset")

        if not preset_name:
            return make_response(json.dumps({"error": "preset parameter required"}), 400, {"Content-Type": "application/json"})

        config = get_preset_config(preset_name)
        if not config:
            return make_response(json.dumps({"error": f"Invalid preset: {preset_name}"}), 400, {"Content-Type": "application/json"})

        # Update app configuration
        import app_conf
        app_conf.MODEL_SIZE = config["model_size"]
        app_conf.MODEL_RESOLUTION = config["resolution"]

        return make_response(json.dumps({
            "status": "success",
            "preset": preset_name,
            "model_size": config["model_size"],
            "resolution": config["resolution"],
            "message": "Preset applied. Please refresh the page for changes to take effect."
        }), 200, {"Content-Type": "application/json"})

    except Exception as e:
        logger.error(f"Error setting preset: {e}")
        return make_response(json.dumps({"error": str(e)}), 500, {"Content-Type": "application/json"})


def gen_track_with_mask_stream(
    boundary: str,
    session_id: str,
    start_frame_index: int,
) -> Generator[bytes, None, None]:
    with inference_api.autocast_context():
        request = PropagateInVideoRequest(
            type="propagate_in_video",
            session_id=session_id,
            start_frame_index=start_frame_index,
        )
        output_dir = UPLOADS_PATH / session_id
        output_dir.mkdir(parents=True, exist_ok=True)
        for chunk in inference_api.propagate_in_video(request=request):
            if True:
                try:
                    # Get frame data as JSON
                    frame_data = json.loads(chunk.to_json())

                    # Determine frame number (assuming it's in the frame data or use an index)
                    frame_idx = frame_data.get("frame_index", -1)

                    # Save to file - either as JSON or process into image if needed
                    frame_filename = output_dir / f"frame_{frame_idx:05d}.json"
                    with open(frame_filename, "w") as f:
                        json.dump(frame_data, f, indent=2)

                    logger.debug(f"Saved frame {frame_idx} to {frame_filename}")
                except Exception as e:
                    logger.error(f"Error saving frame: {str(e)}")

            yield MultipartResponseBuilder.build(
                boundary=boundary,
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "Frame-Current": "-1",
                    # Total frames minus the reference frame
                    "Frame-Total": "-1",
                    "Mask-Type": "RLE[]",
                },
                body=chunk.to_json().encode("UTF-8"),
            ).get_message()


class MyGraphQLView(GraphQLView):
    def get_context(self, request: Request, response: Response) -> Any:
        return {"inference_api": inference_api}


# Add GraphQL route to Flask app.
app.add_url_rule(
    "/graphql",
    view_func=MyGraphQLView.as_view(
        "graphql_view",
        schema=schema,
        allow_queries_via_get=False,
        multipart_uploads_enabled=True,
    ),
)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
