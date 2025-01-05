import os
import numpy as np
from PIL import Image
import streamlit as st
import uuid
import time
from streamlit_image_annotation import pointdet
from helpers import create_tagged_frame, load_vid, load_model, save_masks
from queue_manager import add_job, get_queue_position
from centerline import centerline
from review_masks import review_masks
import shutil

os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
os.environ["TORCH_ALLOW_TF32_CUDA"] = "1"

st.markdown(
    """
    <style>
        section[data-testid="stSidebar"] {
            width: 500px !important;
        }
        .block-container {
            max-width: 900px !important;
        }
    </style>
    """,
    unsafe_allow_html=True,
)
if "video_dir" not in st.session_state:
    st.warning("Please load a video first")
    load_vid()
    st.stop()
else:
    if st.sidebar.button("Reload video"):
        load_vid()
n_objects = st.sidebar.number_input(
    "Number of objects", value=1, min_value=1, max_value=10
)
st.sidebar.divider()
video_dir = st.session_state["video_dir"]
st.session_state["frame_names"] = [
    p.name
    for p in video_dir.iterdir()
    if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg")
]
frame_names = st.session_state["frame_names"]

frame_0 = Image.open(video_dir / frame_names[0])
frame_height, frame_width, _ = np.array(frame_0).shape
mask_tab, review_mask_tab, centerline_tab = st.tabs(
    ["Create Masks", "Review masks", "Get Centerlines"]
)
with mask_tab:
    frame_names.sort(key=lambda p: int(os.path.splitext(p)[0]))
    ann_frame_idx = st.select_slider("Frame Index", options=range(len(frame_names)))

    # annotation plugin
    label_list = []
    for i in range(1, n_objects + 1):
        label_list += [f"Add Object {i}", f"Remove Object {i}"]
    if "result_dict" not in st.session_state:
        result_dict = {}
        for img_idx in range(len(frame_names)):
            result_dict[img_idx] = {"points": [], "labels": []}
        st.session_state["result_dict"] = result_dict.copy()

    target_image_path = str(video_dir / frame_names[ann_frame_idx])

    new_labels = pointdet(
        image_path=target_image_path,
        label_list=label_list,
        points=st.session_state["result_dict"][ann_frame_idx]["points"],
        labels=st.session_state["result_dict"][ann_frame_idx]["labels"],
        use_space=True,
        key=target_image_path,
        height=frame_height,
        width=frame_width,
    )
    if new_labels is not None:
        st.session_state["result_dict"][ann_frame_idx]["points"] = [
            v["point"] for v in new_labels
        ]
        st.session_state["result_dict"][ann_frame_idx]["labels"] = [
            v["label_id"] for v in new_labels
        ]
    all_points = {
        k: v for k, v in st.session_state["result_dict"].items() if v["points"] != []
    }
    if sm := st.button("Show masks", disabled=(not all_points)):
        # Initialize the predictor if it doesn't exist in session_state
        if "predictor" not in st.session_state:
            predictor, inference_state = load_model(video_dir)
            st.session_state["predictor"] = predictor
            st.session_state["inference_state"] = inference_state
        predictor = st.session_state["predictor"]
        inference_state = st.session_state["inference_state"]
        for frame_idx, points_labels_dict in all_points.items():
            annotations = {}
            for ann_obj_id in range(n_objects):
                curr_anns = [
                    idx
                    for idx, label in enumerate(points_labels_dict["labels"])
                    if label in (ann_obj_id * 2, ann_obj_id * 2 + 1)
                ]
                labels = np.array(points_labels_dict["labels"], dtype=np.float32)[
                    curr_anns
                ]
                # for labels, `1` means positive click and `0` means negative click
                labels = np.where(labels % 2 == 0, 1, 0)
                points = np.array(points_labels_dict["points"], dtype=np.float32)[
                    curr_anns
                ]
                annotations[ann_obj_id] = (points, labels)
                _, out_obj_ids, out_mask_logits = predictor.add_new_points_or_box(
                    inference_state=inference_state,
                    frame_idx=frame_idx,
                    obj_id=ann_obj_id,
                    points=points,
                    labels=labels,
                )
                st.session_state["annotations"] = annotations
                st.session_state["inference_state"] = inference_state
                st.session_state["predictor"] = predictor
            # show the results on the current (interacted) frame
            masks = {
                obj_id: (mask[0] > 0.0).cpu().numpy()
                for obj_id, mask in zip(out_obj_ids, out_mask_logits)
            }
            with st.sidebar:
                st.write("Frame Index: ", frame_idx)
                create_tagged_frame(
                    video_dir,
                    frame_names[frame_idx],
                    masks,
                    annotations=annotations,
                    save=True,
                    save_dir=video_dir / "tagged",
                )
    if st.button("Propogate through video", disabled=(not sm)):

        job_id = str(uuid.uuid4())
        print("Job ID:", job_id)
        # Create a Job object and enqueue it
        # Example usage:
        job = add_job(
            job_id,
            {
                "video_dir": video_dir,
                "predictor": st.session_state["predictor"],
                "inference_state": st.session_state["inference_state"],
                "annotations": st.session_state["annotations"],
                "frame_names": frame_names,
            },
        )
        queue_position = get_queue_position(job.job_id)
        st.success(f"Job {job.job_id} is at position {queue_position} in the queue.")
        while not job.done.is_set():
            if queue_position != (new_queue_position := get_queue_position(job.job_id)):
                queue_position = new_queue_position
                st.success(
                    f"Job {job.job_id} is at position {queue_position} in the queue."
                )
            time.sleep(20)

        # Once done, we can display the result
        video_segments = job.result
        save_masks(video_segments, video_dir)
        st.success("Propagation complete!")
        shutil.make_archive(str(video_dir / "masks"), "zip", str(video_dir / "masks"))
        # Provide a download button for the zip file
        with open(str(video_dir / "masks.zip"), "rb") as fp:
            st.download_button(
                label="Download masks",
                data=fp,
                file_name="masks.zip",
                mime="application/zip",
            )
with review_mask_tab:
    review_masks()
with centerline_tab:
    centerline()
