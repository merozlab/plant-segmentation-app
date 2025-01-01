import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_agg import FigureCanvasAgg as FigureCanvas
from matplotlib.patches import Rectangle
import os
import cv2
from PIL import Image
import streamlit as st
from pathlib import Path
from tqdm import tqdm
import zipfile
import torch
from sam2.build_sam import build_sam2_video_predictor


def split_vid_to_frames(video_path, video_dir):
    if not os.path.exists(video_dir):
        os.makedirs(video_dir)

    cap = cv2.VideoCapture(video_path)
    frame_count = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        frame_number = f"{frame_count:05d}"
        text_position = (frame.shape[1] - 200, 50)
        cv2.putText(
            frame,
            frame_number,
            text_position,
            cv2.FONT_HERSHEY_SIMPLEX,
            2,
            (255, 255, 255),
            3,
            cv2.LINE_AA,
        )
        frame_path = os.path.join(video_dir, f"{frame_number}.jpg")
        cv2.imwrite(frame_path, frame)
        frame_count += 1

    cap.release()
    st.success(f"Extracted {frame_count} frames from {video_path}")
    return video_dir


def upload_video():
    vid = st.file_uploader("Upload a file", type=["mp4"], label_visibility="collapsed")
    if vid is not None:
        video_path = BASE_PATH / vid.name
        with open(video_path, "wb") as f:
            f.write(vid.getbuffer())
        st.success(f"Saved file: {video_path}")
        video_dir = BASE_PATH / video_path.stem
        if not video_dir.exists():
            video_dir.mkdir()
            with tqdm(total=100, desc="Extracting frames") as pbar:
                video_dir = split_vid_to_frames(video_path, video_dir)
                pbar.update(100)
        else:
            st.warning(f"Video {vid.name} already exists")
        return video_dir
    else:
        return None


def upload_folder():
    folder = st.file_uploader("Upload a folder", type=["zip"])
    if folder is not None:
        folder_path = BASE_PATH / folder.name
        with open(folder_path, "wb") as f:
            f.write(folder.getbuffer())
        st.success(f"Saved file: {folder_path}")
        video_dir = BASE_PATH / folder_path.stem
        if not video_dir.exists():
            video_dir.mkdir()
            with zipfile.ZipFile(folder_path, "r") as zip_ref:
                zip_ref.extractall(video_dir)
            # Check if there are no photos in the folder
            if not any(
                file.suffix in [".jpg", ".jpeg", ".JPG", ".JPEG"]
                for file in video_dir.iterdir()
            ):
                # Find the first subfolder
                subfolders = [f for f in video_dir.iterdir() if f.is_dir()]
                if subfolders:
                    first_subfolder = subfolders[0]
                    # Move images from the first subfolder to the parent folder
                    for file in first_subfolder.iterdir():
                        if file.suffix in [".jpg", ".jpeg", ".JPG", ".JPEG"]:
                            file.rename(video_dir / file.name)
                    # Remove the subfolder
                    first_subfolder.rmdir()
            # Rename files to 00001, 00002, etc.
            for idx, file in enumerate(sorted(video_dir.iterdir())):
                new_name = video_dir / f"{idx:05d}{file.suffix}"
                file.rename(new_name)
            # video_dir = split_vid_to_frames(folder_path, video_dir)
            folder_path.unlink()
            return video_dir
        else:
            st.warning(f"Folder {folder.name} already exists")


def show_mask_video(mask, ax, obj_id=None, random_color=False, bw=False):
    ax.axis("off")
    if random_color:
        color = np.concatenate([np.random.random(3), np.array([0.6])], axis=0)
    elif bw:
        color = np.array([1.0, 1.0, 1.0])
        # ax.set_facecolor("black")
    else:
        cmap = plt.get_cmap("tab20")
        cmap_idx = 0 if obj_id is None else obj_id
        color = np.array([*cmap(cmap_idx)[:3], 0.6])
    h, w = mask.shape[-2:]
    mask_image = mask.reshape(h, w, 1) * color.reshape(1, 1, -1)
    ax.titlesize = 0
    ax.imshow(mask_image)
    return mask_image


def show_points_video(annotations, ax, marker_size=200):
    coords, labels = annotations
    pos_points = coords[labels == 1]
    neg_points = coords[labels == 0]
    ax.scatter(
        pos_points[:, 0],
        pos_points[:, 1],
        color="green",
        marker=".",
        s=marker_size,
        edgecolor="white",
        linewidth=1.25,
    )
    ax.scatter(
        neg_points[:, 0],
        neg_points[:, 1],
        color="red",
        marker=".",
        s=marker_size,
        edgecolor="white",
        linewidth=1.25,
    )


def show_box_video(box, ax):
    x0, y0 = box[0], box[1]
    w, h = box[2] - box[0], box[3] - box[1]
    ax.add_patch(
        Rectangle((x0, y0), w, h, edgecolor="green", facecolor=(0, 0, 0, 0), lw=2)
    )


def create_tagged_frame(
    video_dir: Path,
    frame_name: str,
    mask_logits,
    annotations=None,
    save: bool = False,
    save_dir: Path | None = None,
    bw: bool = False,
    display=True,
):
    mask_shape = mask_logits[next(iter(mask_logits))].shape
    height, width = mask_shape[-2], mask_shape[-1]
    dpi = 300
    figsize = (width / dpi, height / dpi)
    plt.figure(figsize=figsize, dpi=dpi)
    if not bw:
        plt.imshow(Image.open(video_dir / frame_name))
        # show_points_video(annotations[obj_id], plt.gca()) # FIXME
        # show_points_video(points, labels, plt.gca())
    for obj_id, mask in mask_logits.items():
        show_mask_video(
            mask,
            plt.gca(),
            obj_id=obj_id,
            bw=bw,
        )
    if save and save_dir:
        save_dir.mkdir(exist_ok=True)
        plt.savefig(save_dir / frame_name, bbox_inches="tight", pad_inches=0)
    if display:
        st.pyplot(plt)
    plt.close()


def create_masked_video(
    video_dir,
    video_segments,
    frame_names,
    out_frame_idx,
    video_writer,
    frame_width,
    frame_height,
):
    frame = np.array(Image.open(os.path.join(video_dir, frame_names[out_frame_idx])))
    fig, ax = plt.subplots(figsize=(6, 4), dpi=100)
    canvas = FigureCanvas(fig)
    ax.imshow(frame)
    ax.axis("off")
    for out_obj_id, out_mask in video_segments[out_frame_idx].items():
        show_mask_video(out_mask, ax, obj_id=out_obj_id, bw=True)
    plt.tight_layout(pad=0)
    canvas.draw()
    buf = np.asarray(canvas.buffer_rgba())
    plt_img = cv2.resize(buf, (frame_width, frame_height))
    plt_img = cv2.cvtColor(plt_img, cv2.COLOR_RGBA2BGR)
    video_writer.write(plt_img)
    plt.close(fig)


BASE_PATH = Path("app/app_data")


@st.dialog("Load video")
def load_vid():
    video_dir = None
    load_video = st.segmented_control(
        "Upload video",
        ["Select existing frames", "Upload zip folder", "Upload video"],
        label_visibility="collapsed",
        default="Select existing frames",
    )
    if load_video == "Upload video":
        video_dir = upload_video()
    elif load_video == "Upload zip folder":
        video_dir = upload_folder()
    else:
        vid_list = [f for f in BASE_PATH.iterdir() if f.is_dir()]
        idx = (
            vid_list.index(st.session_state["video_dir"])
            if "video_dir" in st.session_state
            else 0
        )
        video_dir = st.selectbox(
            "Select existing frames",
            vid_list,
            index=idx,
            format_func=lambda x: x.name,
        )
    if video_dir is None:
        st.warning("Please select a video")
        st.stop()

    frame_names = sorted(
        [p.name for p in video_dir.iterdir() if p.suffix.lower() in [".jpg", ".jpeg"]]
    )
    rotate = st.radio(
        "Rotate image", [90, 180, 270], index=None, key="rotate", horizontal=True
    )
    flip = st.radio("Flip image", ["Horizontal", "Vertical"], index=None, key="flip")
    if not load_video == "Upload zip folder":
        reformat = st.checkbox(
            "Reformat image names to 00001.jpg, 00002.jpg, etc.", value=False
        )
    if st.button("Proceed"):
        for frame_name in frame_names:
            img = Image.open(video_dir / frame_name)
            if rotate:
                img = img.rotate(rotate, expand=True)
            if flip == "Horizontal":
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
            elif flip == "Vertical":
                img = img.transpose(Image.FLIP_TOP_BOTTOM)
            if reformat:
                idx = frame_names.index(frame_name)
                new_name = f"{idx:05d}.jpg"
                img.save(video_dir / new_name)
                if (video_dir / frame_name).exists():
                    (video_dir / frame_name).unlink()
            else:
                img.save(video_dir / frame_name)
        st.session_state["video_dir"] = video_dir
        st.rerun()


def load_model(video_dir):
    sam2_checkpoint = "checkpoints/sam2.1_hiera_large.pt"
    model_cfg = "configs/sam2.1/sam2.1_hiera_l.yaml"
    # select the device for computation
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"Torch is loaded. Using device: {device}")

    if device.type == "cuda":
        # use bfloat16 for the entire notebook
        torch.autocast("cuda", dtype=torch.bfloat16).__enter__()
        # turn on tfloat32 for Ampere GPUs (https://pytorch.org/docs/stable/notes/cuda.html#tensorfloat-32-tf32-on-ampere-devices)
        if torch.cuda.get_device_properties(0).major >= 8:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
    elif device.type == "mps":
        print(
            "\nSupport for MPS devices is preliminary. SAM 2 is trained with CUDA and might "
            "give numerically different outputs and sometimes degraded performance on MPS. "
            "See e.g. https://github.com/pytorch/pytorch/issues/84936 for a discussion."
        )
    predictor = build_sam2_video_predictor(
        model_cfg, sam2_checkpoint, device=device, vos_optimized=False
    )
    # loads frames from the video directory
    inference_state = predictor.init_state(video_path=str(video_dir))
    predictor.reset_state(inference_state)
    return predictor, inference_state


def test_masks():
    if video_dir := st.session_state.get("video_dir"):
        if not (video_dir / "masks").exists():
            st.warning("Please segment the objects first")
            st.stop()
    else:
        st.warning("Please segment the objects first")
        st.stop()
    return video_dir
