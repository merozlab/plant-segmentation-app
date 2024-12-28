import streamlit as st
from PIL import Image
from helpers import test_masks


def review_masks():
    video_dir = test_masks()
    frame_names = st.session_state["frame_names"]
    objects_masks = sorted(
        [str(p.name) for p in (video_dir / "masks").iterdir() if p.is_dir()]
    )
    object = st.selectbox(
        "Select photos to work on", objects_masks, key="object_mask_review"
    )
    frame = st.slider("Frame Index", 0, len(frame_names) - 1)
    folder = video_dir / "masks" / object
    test_frame = Image.open(folder / frame_names[frame])
    st.image(test_frame, use_container_width=True)
