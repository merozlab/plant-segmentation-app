# filepath: /home/yasmine/alex/plant-segmentation-app/demo/backend/server/video_app.py
# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

import logging
import json
import zipfile
import time
import threading
import subprocess
from typing import Dict, Any
from pathlib import Path
import os
import numpy as np
import cv2
import re

from mask_to_curvature import (
    centerlines_to_df,
    find_closest_point,
    get_centerline,
    get_contours,
)
from pycocotools import mask as mask_util

from app_conf import (
    GALLERY_PATH,
    GALLERY_PREFIX,
    POSTERS_PATH,
    POSTERS_PREFIX,
    UPLOADS_PATH,
    UPLOADS_PREFIX,
    IS_LOCAL_DEPLOYMENT,
)
from flask import Flask, make_response, request, Response, send_from_directory
from flask_cors import CORS

logger = logging.getLogger(__name__)

INFERENCE_API_URL = os.getenv("INFERENCE_API_URL", "http://localhost:7263")

app = Flask(__name__)
cors = CORS(app, supports_credentials=True)


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


@app.route("/maskify", methods=["POST"])
def maskify() -> Response:
    data = request.json
    base = UPLOADS_PATH / data["session_id"]
    print("data", data)
    # get original file names
    original_file_names = []
    if data.get("original_file_path", None):
        original_folder_path = UPLOADS_PATH / data["original_file_path"].strip("/")
        if original_folder_path.exists():
            original_file_names = [
                x.stem for x in sorted(original_folder_path.glob("*"))
            ]
            print("original filenames", original_file_names[:10])

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
            # Use original file name if available, else fallback to mask_{idx+1:05d}.jpg
            if original_file_names:
                # Use the original file name and append the object index
                original_file_name = original_file_names[idx]
                output_filename = f"{original_file_name}_mask.bmp"
            else:
                # Fallback to using the index
                output_filename = f"{idx+1:05d}_mask.bmp"
            output_path = object_dirs[obj_idx] / output_filename
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


PROCESSING_STATUS: Dict[str, Dict[str, Any]] = {}


@app.route("/api/video_status/<video_id>", methods=["GET"])
def video_status(video_id):
    status = PROCESSING_STATUS.get(video_id, None)
    if status is None:
        return make_response("Video not found", 404)
    if status["status"] == "ready":
        # Return video data
        return {"status": "ready", "video": status["video"]}
    elif status["status"] == "processing":
        return {"status": "processing"}
    else:
        # Return error message if available
        error_message = status.get("message", "Unknown error processing the file")
        return {"status": "error", "message": error_message}


def convert_zip_to_video_async(zip_path, video_id, upload_dir):
    try:
        # Unpack zip
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(upload_dir)

        # Get zip file contents for better error messages
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            files = zip_ref.namelist()

            # Check if there are any files that look like images
            image_extensions = {".jpg", ".jpeg", ".png"}
            potential_images = [
                f
                for f in files
                if any(f.lower().endswith(ext) for ext in image_extensions)
            ]

            if not potential_images:
                raise ValueError("No image files found in the ZIP archive")

        # Use ffmpeg to convert images to video
        video_path = str(Path(upload_dir).parent / f"{video_id}.mp4")

        # Determine image extension from first image found
        ext = Path(potential_images[0]).suffix

        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-framerate",
            "24",
            "-pattern_type",
            "glob",
            "-i",
            f"{upload_dir}/*{ext}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "scale=1280:720:force_original_aspect_ratio=decrease",
            video_path,
        ]

        # Capture output and error for better error handling
        result = subprocess.run(ffmpeg_cmd, check=False, capture_output=True, text=True)

        if result.returncode != 0:
            raise ValueError(f"FFmpeg failed: {result.stderr}")

        # Simulate video data
        PROCESSING_STATUS[video_id] = {
            "status": "ready",
            "video": {"id": f"{video_id}", "url": f"/uploads/{video_id}.mp4"},
        }
        # Clean up the zip file after processing
        zip_path.unlink(missing_ok=True)
        print(f"Video {video_id} processed successfully. Saved to {video_path}")
    except Exception as e:
        PROCESSING_STATUS[video_id] = {
            "status": "error",
            "message": str(e) if str(e) else "Unknown error processing ZIP file",
        }
        print(f"Exception processing video {video_id}: {str(e)}")


@app.route("/upload_zip", methods=["POST"])
def upload_zip():
    file = request.files.get("file")
    if not file or not file.filename.endswith(".zip"):
        return make_response("Invalid file format. Only ZIP files are accepted.", 400)

    if file.content_length and file.content_length > 1024 * 1024 * 1024:
        return make_response("File too large. Maximum size is 1GB.", 400)

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


# Add local folder processing endpoint if IS_LOCAL_DEPLOYMENT is enabled
if IS_LOCAL_DEPLOYMENT:

    @app.route("/process_local_folder", methods=["POST"])
    def process_local_folder():
        """Process a local folder of images into a video (only available in local deployment)"""
        data = request.json
        if not data or "folderPath" not in data:
            return make_response("No folder name provided", 400)

        folder_name = data["folderPath"].strip()
        # For security, restrict the folder to be within the uploads directory
        folder_path = UPLOADS_PATH / folder_name

        if not folder_path.exists() or not folder_path.is_dir():
            return make_response(
                f"Folder '{folder_name}' not found in uploads directory", 404
            )

        # Generate a unique ID for this processing job
        # Include folder name to make it more identifiable
        timestamp = int(time.time())
        safe_folder_name = "".join(c if c.isalnum() else "_" for c in folder_name)[:20]
        video_id = f"local_{safe_folder_name}_{timestamp}"
        upload_dir = UPLOADS_PATH / video_id
        upload_dir.mkdir(parents=True, exist_ok=True)

        # Set the initial processing status
        PROCESSING_STATUS[video_id] = {"status": "processing", "folder": folder_name}

        # Start processing in a separate thread
        threading.Thread(
            target=process_local_folder_async, args=(folder_path, video_id, upload_dir)
        ).start()

        return {"status": "processing", "id": video_id}

    def process_local_folder_async(folder_path, video_id, upload_dir):
        try:
            # Find all image files in the folder
            image_extensions = [".jpg", ".jpeg", ".png"]
            images = []
            for ext in image_extensions:
                try:
                    files = list(folder_path.glob(f"*{ext}"))
                    images.extend(files)
                    upper_files = list(folder_path.glob(f"*{ext.upper()}"))
                    images.extend(upper_files)
                    print(
                        f"Found {len(files)} {ext} files and {len(upper_files)} {ext.upper()} files"
                    )
                except Exception as ext_err:
                    print(f"Error searching for {ext} files: {str(ext_err)}")

            # Sort images naturally (so 1.jpg comes before 10.jpg)
            try:

                def natural_sort_key(s):
                    return [
                        int(text) if text.isdigit() else text.lower()
                        for text in re.split(r"(\d+)", str(s.name))
                    ]

                images = sorted(images, key=natural_sort_key)
                print(f"Sorted {len(images)} images naturally")
            except Exception as sort_err:
                print(
                    f"Error during natural sorting, falling back to basic sort: {str(sort_err)}"
                )
                images = sorted(images, key=lambda x: str(x.name))

            if not images:
                PROCESSING_STATUS[video_id] = {
                    "status": "error",
                    "message": f"No image files found in the folder '{folder_path.name}'",
                }
                return

            print(f"Found {len(images)} images in {folder_path}")

            # Create a text file listing all image files in their correct order
            filelist_path = upload_dir / "filelist.txt"
            with open(filelist_path, "w") as f:
                for img_path in images:
                    # Write the format expected by ffmpeg: file '/path/to/image.jpg'
                    f.write(f"file '{img_path.absolute()}'\n")

            print(f"Created filelist with {len(images)} images at {filelist_path}")

            # Use ffmpeg to convert images to video using the filelist
            video_path = str(Path(upload_dir).parent / f"{video_id}.mp4")
            import subprocess

            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(filelist_path),
                "-framerate",
                "24",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-vf",
                "scale=1280:720:force_original_aspect_ratio=decrease",
                video_path,
            ]
            print(*ffmpeg_cmd)

            # Capture output and error for better error handling
            result = subprocess.run(
                ffmpeg_cmd, check=False, capture_output=True, text=True
            )

            if result.returncode != 0:
                error_output = result.stderr
                print(f"FFMPEG error: {error_output}")

                if "Output file #0 does not contain any stream" in error_output:
                    PROCESSING_STATUS[video_id] = {
                        "status": "error",
                        "message": "No valid image files found in the folder for processing",
                    }
                elif "No such file or directory" in error_output:
                    PROCESSING_STATUS[video_id] = {
                        "status": "error",
                        "message": "Error accessing image files. Please check file permissions.",
                    }
                elif "does not contain any stream" in error_output:
                    PROCESSING_STATUS[video_id] = {
                        "status": "error",
                        "message": "Could not process the images. Please make sure they are valid image files.",
                    }
                else:
                    PROCESSING_STATUS[video_id] = {
                        "status": "error",
                        "message": f"Failed to convert images to video: {error_output[:100]}...",
                    }
                return
            # Delete the filelist.txt file after successful processing
            try:
                filelist_path.unlink(missing_ok=True)
                print(f"Deleted temporary filelist at {filelist_path}")
            except Exception as del_err:
                print(f"Note: Could not delete temporary filelist: {str(del_err)}")
            # Set the video data in the processing status
            PROCESSING_STATUS[video_id] = {
                "status": "ready",
                "video": {
                    "id": f"/uploads/{video_id}",
                    "url": f"/uploads/{video_id}.mp4",
                    "original_folder": str(folder_path),
                },
            }
            print(f"Video {video_id} processed successfully. Saved to {video_path}")

        except Exception as e:
            PROCESSING_STATUS[video_id] = {
                "status": "error",
                "message": str(e) if str(e) else "Unknown error processing folder",
            }
            print(f"Exception processing folder {video_id}: {str(e)}")

else:
    # When IS_LOCAL_DEPLOYMENT is false, provide a disabled endpoint that returns a clear message
    @app.route("/process_local_folder", methods=["POST"])
    def process_local_folder():
        return make_response(
            "Local folder processing is disabled in this deployment", 403
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
