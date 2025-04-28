# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import logging
from typing import Any, Generator, Tuple
import json
from mask_to_curvature import (
    centerlines_to_df,
    find_closest_point,
    get_centerline,
    get_contours,
)
import numpy as np
import cv2
from pycocotools import mask as mask_util
from pathlib import Path
import zipfile
import threading
import time

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
    # Collect all JSON files and sort by frame index
    json_files = sorted(base.glob("*.json"), key=lambda f: int(f.stem.split("_")[-1]))
    if not json_files:
        return make_response("No mask JSON files found.", 404)

    # Determine number of objects from the first file
    with open(json_files[0], "r") as f:
        mask_data = json.load(f)
    num_objects = len(mask_data["results"])

    # Prepare output directories for each object
    object_dirs = []
    masks_dir = base / "masks"
    masks_dir.mkdir(parents=True, exist_ok=True)
    for i in range(num_objects):
        obj_dir = masks_dir / f"object_{i+1}"
        obj_dir.mkdir(parents=True, exist_ok=True)
        object_dirs.append(obj_dir)

    # Process each frame
    for idx, file in enumerate(json_files):
        with open(file, "r") as f:
            mask_data = json.load(f)
        height, width = mask_data["results"][0]["mask"]["size"]

        for obj_idx, result in enumerate(mask_data["results"]):
            rle = result["mask"]
            binary_mask = mask_util.decode(rle)
            # Convert to uint8 and scale to 0/255 for black and white
            bw_mask = (binary_mask * 255).astype(np.uint8)
            output_path = object_dirs[obj_idx] / f"mask_{idx+1:05d}.jpg"
            cv2.imwrite(str(output_path), bw_mask)

    return make_response(
        "Masks created successfully, per-object folders generated.", 200
    )


@app.route("/zip", methods=["POST"])
def zip_masks() -> Response:
    """
    Zip all files in a directory.
    """
    session_id = request.json["session_id"]
    base = UPLOADS_PATH / session_id
    directory = base / "masks"
    zip_name = session_id + "_masks.zip"
    with zipfile.ZipFile(base / zip_name, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file in directory.rglob("*"):
            if file.is_file():
                zipf.write(file, str(file.relative_to(directory)))
    # Send the zip file
    return send_from_directory(
        directory=str(base),
        path=zip_name,
        as_attachment=True,
    )


@app.route("/centerlines", methods=["POST"])
def centerline() -> Response:
    data = request.json
    session_id = data["session_id"]
    base = UPLOADS_PATH / session_id
    masks_dir = base / "masks"
    # Load the JSON file with mask data
    if not base.exists():
        return make_response("Session not found", 404)
    elif not masks_dir.exists():
        return make_response("Masks not found", 404)
    base_coords: Tuple[int, int] = data["base_coords"][0]
    objects = [f"object_{o + 1}" for o in range(len(data["base_coords"]))]
    centerlines = {object: [] for object in objects}
    for object in objects:
        object_dir = masks_dir / object
        for frame in sorted(object_dir.glob("*.jpg")):
            contour = get_contours(frame)
            start_index = find_closest_point(contour, base_coords)
            centerline = get_centerline(contour, start_index, display=False)
            centerlines[object].append(centerline)
    centerlines_df = centerlines_to_df(centerlines)
    centerlines_path = base / "centerlines"
    centerlines_path.mkdir(exist_ok=True)
    for object, df in centerlines_df.items():
        df.to_csv(centerlines_path / f"{object}.csv", index=False)

    zip_name = session_id + "_centerlines.zip"
    with zipfile.ZipFile(base / zip_name, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file in centerlines_path.glob("*"):
            if file.is_file():
                zipf.write(file, str(file.relative_to(centerlines_path)))

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


PROCESSING_STATUS = {}


@app.route("/api/video_status/<video_id>", methods=["GET"])
def video_status(video_id):
    status = PROCESSING_STATUS.get(video_id, None)
    if status is None:
        return {"status": "not_found"}, 404
    if status["status"] == "ready":
        # Return video data (simulate, or load from DB)
        # You may want to return more fields as needed
        return {"status": "ready", "video": status["video"]}
    elif status["status"] == "processing":
        return {"status": "processing"}, 200
    else:
        return {"status": "error"}, 500


def convert_zip_to_video_async(zip_path, video_id, upload_dir):
    try:
        # Unpack zip
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(upload_dir)
        # Find images
        images = sorted(
            [
                str(p)
                for p in Path(upload_dir).glob("**/*")
                if p.suffix.lower() in [".jpg", ".jpeg", ".png"]
            ]
        )
        if not images:
            PROCESSING_STATUS[video_id] = {"status": "error"}
            return
        # Use ffmpeg to convert images to video
        video_path = str(Path(upload_dir) / f"{video_id}.mp4")
        import subprocess

        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-framerate",
            "24",
            "-pattern_type",
            "glob",
            "-i",
            f"{upload_dir}/*.jpg",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "scale=1280:720:force_original_aspect_ratio=decrease",
            video_path,
        ]
        subprocess.run(ffmpeg_cmd, check=True)
        # Simulate video data (replace with actual video info as needed)
        PROCESSING_STATUS[video_id] = {
            "status": "ready",
            "video": {"id": video_id, "url": f"/uploads/{video_id}.mp4"},
        }
    except Exception as e:
        PROCESSING_STATUS[video_id] = {"status": "error"}


@app.route("/upload_zip", methods=["POST"])
def upload_zip():
    file = request.files.get("file")
    if not file or not file.filename.endswith(".zip"):
        return make_response("No zip file uploaded", 400)
    if file.content_length and file.content_length > 1024 * 1024 * 1024:
        return make_response("Zip file too large (max 1GB)", 413)
    video_id = Path(file.filename).stem + str(int(time.time()))
    upload_dir = UPLOADS_PATH / video_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    zip_path = upload_dir / file.filename
    file.save(zip_path)
    PROCESSING_STATUS[video_id] = {"status": "processing"}
    threading.Thread(
        target=convert_zip_to_video_async, args=(zip_path, video_id, upload_dir)
    ).start()
    return {"status": "processing", "id": video_id}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
