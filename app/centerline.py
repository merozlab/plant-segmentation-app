import streamlit as st
from PIL import Image
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from streamlit_image_annotation import pointdet
import cv2
from mask_to_curvature import (
    get_contours,
    plot_contour,
    find_closest_point,
    get_centerline,
    display_centerlines,
    get_tip_angles,
    get_arclength,
)
from helpers import test_masks


def centerlines_to_df(centerlines):
    l = []
    for i, t in enumerate(centerlines):
        l.append(pd.DataFrame({"frame": i, "x": t[0], "y": t[1]}))
    return pd.concat(l).reset_index(drop=True)


def centerline():
    video_dir = test_masks()
    # st.rerun()
    frame_names = st.session_state["frame_names"]
    objects_masks = sorted(
        [str(p.name) for p in (video_dir / "masks").iterdir() if p.is_dir()]
    )
    object = st.selectbox("Select photos to work on", objects_masks)
    folder = video_dir / "masks" / object
    frame_idx = st.select_slider(
        "Frame Index", options=range(len(frame_names)), key="frame_idx_centerline"
    )
    test_frame = Image.open(folder / frame_names[frame_idx])
    test_frame_height, test_frame_width = np.array(test_frame).shape[:2]
    # st.image(test_frame, use_container_width=True)
    # mode = st.selectbox(
    #     "Select start point and length scale", ["Start point", "Length scale"]
    # )
    if "result_dict_init" not in st.session_state:
        result_dict_init = {obj: {"points": [], "labels": []} for obj in objects_masks}
        st.session_state["result_dict_init"] = result_dict_init.copy()

    new_labels = pointdet(
        image_path=str(folder / frame_names[frame_idx]),
        label_list=[object + "_start"],
        points=st.session_state["result_dict_init"][object]["points"],
        labels=st.session_state["result_dict_init"][object]["labels"],
        use_space=True,
        key="find_first_point",
        height=test_frame_height,
        width=test_frame_width,
    )

    if new_labels is not None:
        st.session_state["result_dict_init"][object]["points"] = [
            v["point"] for v in new_labels
        ]
        st.session_state["result_dict_init"][object]["labels"] = [
            v["label_id"] for v in new_labels
        ]
    # st.number_input("Length scale", step=None)
    start_points_dict = st.session_state["result_dict_init"]
    if not any([v["points"] for v in start_points_dict.values()]):
        st.warning("Please select all start points")
        st.stop()
    centerlines = []
    start_coords = (
        start_points_dict[object]["points"][0][0],
        test_frame_height - start_points_dict[object]["points"][0][1],
    )

    for frame in frame_names:
        contour = get_contours(folder / frame)
        #### experimental - dealing with frames where no mask was found.
        if len(contour) == 0:
            continue
        ####
        start_index = find_closest_point(contour, start_coords)
        centerline = get_centerline(contour, start_index, display=False)
        centerlines.append(centerline)
    st.write("### Centerline Data")
    st.dataframe(centerlines_to_df(centerlines))
    centerlines_df = centerlines_to_df(centerlines)
    csv = centerlines_df.to_csv(index=False)
    st.download_button(
        label="Download data (CSV)",
        data=csv,
        file_name="centerlines.csv",
        mime="text/csv",
    )
    st.write("### Results")
    # x, y = centerlines[frame_idx]
    # plot_centerline(x, y, x_unif, y_unif, centerline_intrep)
    flip = (
        -1 if st.checkbox(label="Flip centerline order", key="flip_centerline") else 1
    )
    display_centerlines(centerlines, flip)
    get_tip_angles(centerlines, display=True)
    get_arclength(centerlines, display=True)
    # with
    # st.download_button(
    #     label="Download centerlines",
    #     data=centerlines_df,
    #     file_name="results.csv",
    #     mime="text/csv",
    # )
