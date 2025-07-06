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

from app_conf import (
    API_URL,
    GALLERY_PATH,
    GALLERY_PREFIX,
    POSTERS_PATH,
    POSTERS_PREFIX,
    UPLOADS_PATH,
    UPLOADS_PREFIX,
)
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
            return make_response(
                {
                    "gpu_available": False,
                    "total_memory": 0,
                    "model_estimates": {
                        "tiny": {"max_frames": 800, "memory_per_frame": "~2MB"},
                        "small": {"max_frames": 650, "memory_per_frame": "~3MB"},
                        "base_plus": {"max_frames": 500, "memory_per_frame": "~4MB"},
                        "large": {"max_frames": 300, "memory_per_frame": "~6MB"},
                    },
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

        model_estimates = {}
        for model, mem_per_frame in memory_per_frame.items():
            # Calculate usable memory (total - model overhead - buffer)
            usable_memory = max(
                0, available_memory - base_memory_overhead - (512 * 1024**2)
            )  # 512MB buffer
            estimated_frames = max(0, int(usable_memory / mem_per_frame))

            model_estimates[model] = {
                "max_frames": estimated_frames,
                "memory_per_frame": f"~{mem_per_frame / (1024**2):.1f}MB",
            }

        return make_response(
            {
                "gpu_available": True,
                "total_memory": total_memory,
                "allocated_memory": allocated_memory,
                "reserved_memory": reserved_memory,
                "available_memory": available_memory,
                "model_estimates": model_estimates,
            },
            200,
        )

    except Exception as e:
        return make_response(
            {
                "error": str(e),
                "gpu_available": False,
                "model_estimates": {
                    "tiny": {"max_frames": 800, "memory_per_frame": "~1.5MB"},
                    "small": {"max_frames": 650, "memory_per_frame": "~2.5MB"},
                    "base_plus": {"max_frames": 500, "memory_per_frame": "~4MB"},
                    "large": {"max_frames": 300, "memory_per_frame": "~6MB"},
                },
            },
            200,
        )


@app.route("/set_model_size", methods=["POST"])
def set_model_size() -> Response:
    """Change the SAM2 model size"""
    try:
        data = request.json
        if not data or "model_size" not in data:
            return make_response({"error": "model_size parameter required"}, 400)

        model_size = data["model_size"]
        valid_sizes = ["tiny", "small", "base_plus", "large"]

        if model_size not in valid_sizes:
            return make_response(
                {"error": f"Invalid model size. Must be one of: {valid_sizes}"}, 400
            )

        # Update the model size in app_conf
        import app_conf

        app_conf.MODEL_SIZE = model_size

        # Note: This requires restarting the inference API to take effect
        # For now, we'll just return success and let the frontend know a restart is needed
        return make_response(
            {
                "status": "success",
                "model_size": model_size,
                "message": "Model size updated. Please restart the session for changes to take effect.",
            },
            200,
        )

    except Exception as e:
        return make_response({"error": str(e)}, 500)


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
