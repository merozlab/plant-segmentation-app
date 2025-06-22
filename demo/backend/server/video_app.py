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
from typing import Dict, Any, Tuple
from pathlib import Path
import os
import numpy as np
import cv2
import re
import pandas as pd

from mask_to_curvature import (
    centerlines_to_df,
    find_closest_point,
    get_centerline,
    get_contours,
    get_centerline_pca,
    get_centerline_edge_pca,
    get_centerline_skeletonize,
)
from edge_pca_centerline import multi_contour_centerlines
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


def get_original_filenames(safe_folder_name: str) -> Tuple[str, str]:
    original_folder_name = "_".join(safe_folder_name.split("/")[-1].split("_")[1:-1])
    original_folder_path = UPLOADS_PATH / original_folder_name
    if original_folder_path.exists():
        return [x.stem for x in sorted(original_folder_path.glob("*"))]
    return []


@app.route("/maskify", methods=["POST"])
def maskify() -> Response:
    data = request.json
    base = UPLOADS_PATH / data["session_id"]
    # get original file names
    sfn = data.get("safe_folder_name", None)
    original_file_names = get_original_filenames(sfn) if sfn else None
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
        if idx == 0:
            print("height and width of mask data", height, width)

        for obj_idx, result in enumerate(mask_data["results"]):
            rle = result["mask"]
            binary_mask = mask_util.decode(rle)
            # Convert to uint8 and scale to 0/255 for black and white
            bw_mask = (binary_mask * 255).astype(np.uint8)
            # Use original file name if available, else fallback to mask_{idx+1:05d}.jpg
            if original_file_names:
                # Use the original file name and append the object index
                output_filename = f"{original_file_names[idx]}_mask.bmp"
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
    data = request.json
    session_id = data["session_id"]
    erode = data.get("erode", False)

    base = UPLOADS_PATH / session_id
    directory = base / "masks"
    zip_name = session_id + "_masks.zip"

    if erode:
        # Create a temporary directory for eroded masks
        eroded_dir = base / "masks_eroded"
        eroded_dir.mkdir(exist_ok=True)

        # Process each mask file and apply erosion
        for file in directory.rglob("*"):
            if file.is_file() and file.suffix.lower() in [
                ".bmp",
                ".jpg",
                ".jpeg",
                ".png",
            ]:
                # Read the image
                img = cv2.imread(str(file), cv2.IMREAD_GRAYSCALE)
                if img is not None:
                    # Apply erosion
                    kernel = np.ones((3, 3), np.uint8)
                    eroded_img = cv2.erode(img, kernel, iterations=1)

                    # Save to eroded directory maintaining folder structure
                    relative_path = file.relative_to(directory)
                    eroded_file_path = eroded_dir / relative_path
                    eroded_file_path.parent.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(eroded_file_path), eroded_img)

        # Create zip from eroded directory
        with zipfile.ZipFile(base / zip_name, "w", zipfile.ZIP_DEFLATED) as zipf:
            for file in eroded_dir.rglob("*"):
                if file.is_file():
                    zipf.write(file, str(file.relative_to(eroded_dir)))

        # Clean up temporary directory
        import shutil

        shutil.rmtree(eroded_dir)
    else:
        # Original behavior - no erosion
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


@app.route("/centerline", methods=["POST"])
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
    object_dir = masks_dir / data["object"]
    response = []
    for frame in sorted(object_dir.glob("*.bmp")):
        contour = get_contours(frame)
        start_index = find_closest_point(contour, data["base_coords"][:2])
        centerline = get_centerline(contour, start_index, display=False)
        img = cv2.imread(str(frame))
        height, _ = img.shape[:2]
        transformed_centerline = [
            centerline[0].tolist(),
            (height - centerline[1]).tolist(),
        ]
        response.append(transformed_centerline)
    return make_response(
        response,
        200,
    )


@app.route("/centerlines_pca", methods=["POST"])
def centerlines_pca() -> Response:
    data = request.json
    session_id = data["session_id"]
    sfn = data.get("safe_folder_name", None)
    n_points = data.get("n_points", None)
    edge_percentage = data.get("edge_percentage", None)
    original_file_names = get_original_filenames(sfn) if sfn else None

    base = UPLOADS_PATH / session_id
    masks_dir = base / "masks"
    response = {}
    # Load the JSON file with mask data
    if not base.exists():
        return make_response("Session not found", 404)
    elif not masks_dir.exists():
        return make_response("Masks not found", 404)

    # Compute centerlines for each object asynchronously save CSVs
    for object_dir in masks_dir.iterdir():
        if object_dir.is_dir():
            if data.get("pca_algorithm") == "edge":
                frame_centerlines = []
                for frame in sorted(object_dir.glob("*.bmp")):
                    # Get all centerlines for this frame (may be multiple contours)
                    centerlines = multi_contour_centerlines(
                        str(frame),
                        n_contours=None,  # Process all contours
                        edge_percentage=edge_percentage,
                        n_points=n_points,
                    )
                    centerlines = [c for c in centerlines if len(c) > 0]
                    # If only one centerline, return it directly; otherwise return all
                    if len(centerlines) == 1:
                        frame_centerlines.append(centerlines[0].tolist())
                    else:
                        # Join all centerlines in this frame into one combined centerline
                        combined_centerline = np.concatenate(
                            centerlines, axis=1
                        ).tolist()
                        print(combined_centerline[0])
                        frame_centerlines.append(combined_centerline)
                response[object_dir.name] = frame_centerlines
            elif data.get("pca_algorithm") == "skeletonize":
                frame_centerlines = []
                for frame in sorted(object_dir.glob("*.bmp")):
                    try:
                        # Get centerline for this frame using skeletonize
                        centerline = get_centerline_skeletonize(
                            str(frame), n_points=n_points
                        )
                        if (
                            len(centerline) == 2
                            and len(centerline[0]) > 0
                            and len(centerline[1]) > 0
                        ):
                            frame_centerlines.append(centerline)
                        else:
                            # Empty centerline, append empty lists
                            frame_centerlines.append([[], []])
                    except Exception as e:
                        print(
                            f"Warning: Failed to extract skeleton centerline for frame {frame}: {e}"
                        )
                        # Append empty centerline for this frame
                        frame_centerlines.append([[], []])
                response[object_dir.name] = frame_centerlines

    # Asynchronously save CSVs for each object
    def _save_centerlines_csvs(centerlines_dict, base_path, original_file_names):
        try:
            centerlines_df = centerlines_to_df(
                centerlines_dict, frame_names=original_file_names
            )
            csv_dir = base_path / "centerlines"
            csv_dir.mkdir(parents=True, exist_ok=True)
            for obj, df in centerlines_df.items():
                df = df.rename({"x": "x (pixels)", "y": "y (pixels)"}, axis=1)
                df.to_csv(csv_dir / f"{obj}.csv", index=False)
            # After CSVs are written, zip the centerlines folder
            try:
                zip_name = f"{base_path.name}_centerlines.zip"
                zip_path = base_path / zip_name
                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                    for file in csv_dir.glob("*.csv"):
                        zipf.write(file, str(file.relative_to(csv_dir)))
            except Exception as zip_err:
                logger.error(f"Error zipping centerlines CSVs: {zip_err}")
        except Exception as e:
            logger.error(f"Error saving centerlines CSVs: {e}")

    threading.Thread(
        target=_save_centerlines_csvs,
        args=(response, base, original_file_names),
        daemon=True,
    ).start()

    # Return response immediately, CSV saving continues in background
    return make_response(response, 200)


@app.route("/centerlines_zip", methods=["POST"])
def centerline_zip() -> Response:
    data = request.json
    session_id = data["session_id"]
    units = data.get("units", "pixels")  # Default to pixels
    pixels_to_meters_ratio = data.get("pixels_to_meters_ratio", None)

    # Validate that if meters are requested, we have a conversion ratio
    if units == "meters" and (
        pixels_to_meters_ratio is None or pixels_to_meters_ratio <= 0
    ):
        return make_response(
            "Invalid or missing pixels_to_meters_ratio for meter units", 400
        )

    base = UPLOADS_PATH / session_id
    if not base.exists():
        return make_response("Session not found", 404)

    centerlines_dir = base / "centerlines"
    if not centerlines_dir.exists():
        return make_response("Centerlines not found", 404)

    # If units are meters and we have a conversion ratio, create converted CSV files
    if units == "meters" and pixels_to_meters_ratio is not None:
        converted_dir = None
        try:
            # Create a temporary directory for converted CSV files
            converted_dir = base / "centerlines_meters"
            converted_dir.mkdir(exist_ok=True)

            # Process each CSV file
            for csv_file in centerlines_dir.glob("*.csv"):
                df = pd.read_csv(csv_file)

                # Convert pixel coordinates to meters
                if "x (pixels)" in df.columns:
                    df["x (meters)"] = df["x (pixels)"] * pixels_to_meters_ratio
                    df = df.drop(columns=["x (pixels)"])

                if "y (pixels)" in df.columns:
                    df["y (meters)"] = df["y (pixels)"] * pixels_to_meters_ratio
                    df = df.drop(columns=["y (pixels)"])

                # Save converted CSV
                converted_csv_path = converted_dir / csv_file.name
                df.to_csv(converted_csv_path, index=False)

            # Create zip file with converted CSVs
            zip_name = f"{base.name}_centerlines_meters.zip"
            zip_path = base / zip_name
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                for file in converted_dir.glob("*.csv"):
                    zipf.write(file, str(file.relative_to(converted_dir)))

            return send_from_directory(
                directory=str(base),
                path=zip_name,
                as_attachment=True,
            )
        except Exception as e:
            logger.error(f"Error converting centerlines to meters: {e}")
            return make_response("Error converting to meters", 500)
        finally:
            # Clean up temporary directory
            if converted_dir and converted_dir.exists():
                import shutil

                try:
                    shutil.rmtree(converted_dir)
                except Exception as e:
                    logger.warning(f"Failed to clean up temporary directory: {e}")
    else:
        # Return original pixel-based zip file
        zip_name = f"{base.name}_centerlines.zip"
        zip_path = base / zip_name

        # If the zip file doesn't exist, create it from the centerlines directory
        if not zip_path.exists():
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                for file in centerlines_dir.glob("*.csv"):
                    zipf.write(file, str(file.relative_to(centerlines_dir)))

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


def unzip(zip_path: Path, extract_to: Path) -> None:
    """Unzip the provided zip file to the specified directory."""
    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(extract_to)
    zip_path.unlink(missing_ok=True)
    print(f"Unzipped {zip_path} to {extract_to}")


def convert_folder_to_video_async(video_id: str, upload_dir: Path):
    # Check if the folder contains images
    image_extensions = [".jpg", ".jpeg", ".png", ".bmp", ".tiff"]
    image_files = []
    print(f"Processing folder: {upload_dir}", "video_id:", video_id)

    for ext in image_extensions:
        image_files += list((upload_dir).glob(f"*{ext}"))
        image_files += list((upload_dir).glob(f"*{ext.upper()}"))

    if not image_files:
        raise ValueError(
            f"No image files found in the extracted folder. Supported formats: {', '.join(image_extensions)}"
        )

    print(f"Found {len(image_files)} images in the extracted folder")

    # Create a text file listing all image files in their correct order
    filelist_path = upload_dir / "filelist.txt"
    with open(filelist_path, "w") as f:
        for img_path in sorted(image_files):
            # Write the format expected by ffmpeg: file '/path/to/image.jpg'
            f.write(f"file '{img_path.absolute()}'\n")
    try:
        video_path = str(upload_dir.parent / f"{video_id}.mp4")
        ext = image_files[0].suffix

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

        # ffmpeg_cmd = [
        #     "ffmpeg",
        #     "-y",
        #     "-framerate",
        #     "24",
        #     "-pattern_type",
        #     "glob",
        #     "-i",
        #     f"{upload_dir}/*{ext}",
        #     "-c:v",
        #     "libx264",
        #     "-pix_fmt",
        #     "yuv420p",
        #     "-vf",
        #     "scale=1280:720:force_original_aspect_ratio=decrease",
        #     video_path,
        # ]

        result = subprocess.run(ffmpeg_cmd, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(f"FFmpeg failed: {result.stderr}")

        PROCESSING_STATUS[video_id] = {
            "status": "ready",
            "video": {
                "id": f"{video_id}",
                "url": f"/uploads/{video_id}.mp4",
                "original_folder": str(upload_dir),
            },
        }

        print(f"Video {video_id} processed successfully. Saved to {video_path}")
    except Exception as e:
        PROCESSING_STATUS[video_id] = {
            "status": "error",
            "message": str(e) if str(e) else "Unknown error processing folder",
        }
        print(f"Exception processing video {video_id}: {str(e)}")


def convert_zip_to_video_async(zip_path: Path, video_id: str, upload_dir: Path):
    unzip(zip_path, upload_dir)
    convert_folder_to_video_async(video_id, upload_dir)


@app.route("/upload_zip", methods=["POST"])
def upload_zip():
    file = request.files.get("file")
    if not file or not file.filename.endswith(".zip"):
        return make_response("Invalid file format. Only ZIP files are accepted.", 400)

    if file.content_length and file.content_length > 1024 * 1024 * 1024:
        return make_response("File too large. Maximum size is 1GB.", 400)

    timeint = int(time.time())
    zip_name = f"{Path(file.filename).stem}_{timeint}"
    video_id = f"zip_{zip_name}_{timeint}"
    upload_dir = UPLOADS_PATH / zip_name
    upload_dir.mkdir(parents=True, exist_ok=True)
    zip_path = upload_dir / zip_name
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
        """Process a local folder of images into a video
        (only available in local deployment)"""
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

        # # Generate a unique ID for this processing job
        timestamp = int(time.time())
        safe_folder_name = "".join(c if c.isalnum() else "_" for c in folder_name)[:20]
        video_id = f"local_{safe_folder_name}_{timestamp}"
        # upload_dir = UPLOADS_PATH / video_id
        # upload_dir.mkdir(parents=True, exist_ok=True)

        # Set the initial processing status
        PROCESSING_STATUS[video_id] = {"status": "processing", "folder": folder_name}

        # Start processing in a separate thread
        threading.Thread(
            target=convert_folder_to_video_async,
            args=(video_id, folder_path),
        ).start()

        return {"status": "processing", "id": video_id}

else:
    # When IS_LOCAL_DEPLOYMENT is false, provide a disabled endpoint that returns a clear message
    @app.route("/process_local_folder", methods=["POST"])
    def process_local_folder():
        return make_response(
            "Local folder processing is disabled in this deployment", 403
        )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
