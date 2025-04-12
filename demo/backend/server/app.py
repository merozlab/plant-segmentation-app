# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import logging
from typing import Any, Generator
import json
import numpy as np
import cv2
from pycocotools import mask as mask_util
from pathlib import Path
import zipfile

from app_conf import (
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


# TOOD: Protect route with ToS permission check
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


@app.route("/maskify", methods=["POST"])
def maskify() -> Response:
    data = request.json
    base = UPLOADS_PATH / data["session_id"]
    # Load the JSON file with mask data
    for file in base.glob("*.json"):
        with open(file, "r") as f:
            mask_data = json.load(f)

        # Create an empty image with the correct dimensions
        height, width = mask_data["results"][0]["mask"]["size"]
        # Create a blank image (black background)
        image = np.zeros((height, width, 3), dtype=np.uint8)

        # Define colors for different objects
        colors = [
            (255, 0, 0),  # Red
            (0, 255, 0),  # Green
            (0, 0, 255),  # Blue
            (255, 255, 0),  # Yellow
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Cyan
            (255, 165, 0),  # Orange
            (128, 0, 128),  # Purple
            (128, 255, 0),  # Lime
            (0, 128, 128),  # Teal
        ]

        # Process each mask
        for i, result in enumerate(mask_data["results"]):
            # Get the mask in RLE format
            rle = result["mask"]
            # Decode RLE to binary mask
            binary_mask = mask_util.decode(rle)

            # Select a color for this mask
            color = colors[i % len(colors)]

            # Apply the mask with the selected color
            for c in range(3):
                image[:, :, c] = np.where(binary_mask == 1, color[c], image[:, :, c])

        # Save as JPG
        # Ensure the directory exists
        output_dir = base / "masks"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / (file.stem.replace("frame", "mask") + ".jpg")
        cv2.imwrite(output_path, image)
    return make_response("Masks created successfully, zipping skipped.", 200)


@app.route("/zip", methods=["POST"])
def zip_masks() -> Response:
    """
    Zip all files in a directory.
    """
    session_id = request.json["session_id"]
    base = UPLOADS_PATH / session_id
    directory = base / "masks"
    zip_name =  (session_id + "_masks.zip")
    with zipfile.ZipFile(base / zip_name, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file in directory.glob("*.jpg"):
            zipf.write(file, str(file.relative_to(directory)))
    # Send the zip file
    return send_from_directory(
        directory=str(base),
        path=zip_name,
        as_attachment=True,
    )

class MyGraphQLView(GraphQLView):
    def get_context(self, request: Request, response: Response) -> Any:
        return {"inference_api": inference_api}


# Add GraphQL route to Flask app.
app.add_url_rule(
    "/graphql",
    view_func=MyGraphQLView.as_view(
        "graphql_view",
        schema=schema,
        # Disable GET queries
        # https://strawberry.rocks/docs/operations/deployment
        # https://strawberry.rocks/docs/integrations/flask
        allow_queries_via_get=False,
        # Strawberry recently changed multipart request handling, which now
        # requires enabling support explicitly for views.
        # https://github.com/strawberry-graphql/strawberry/issues/3655
        multipart_uploads_enabled=True,
    ),
)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
