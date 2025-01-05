import streamlit as st
from PIL import Image
import numpy as np
from helpers import test_masks
import cv2


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
    st.image(test_frame)
    if st.button("Fix holes and gaps"):
        kernel_size = st.number_input("Kernel size", 10, 1000, 100, 10)
        test_frame = np.array(test_frame)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_size, kernel_size))
        closed_mask = cv2.morphologyEx(test_frame, cv2.MORPH_CLOSE, kernel)
        st.image(closed_mask, use_container_width=True)
        with open(folder / frame_names[frame], "wb") as f:
            Image.fromarray(closed_mask).save(f)
        st.success("Holes and gaps fixed, file saved (overwrite)")
