import streamlit as st
from PIL import Image
import numpy as np
from streamlit_image_annotation import pointdet
import cv2
from mask_to_curvature import (
    get_contours,
    find_closest_point,
    get_centerline,
    display_centerlines,
    get_tip_angles,
    get_arclength,
)
from helpers import test_masks


def centerline():
    video_dir = test_masks()
    frame_names = st.session_state["frame_names"]
    objects_masks = sorted(
        [str(p.name) for p in (video_dir / "masks").iterdir() if p.is_dir()]
    )
    object = st.selectbox("Select photos to work on", objects_masks)
    folder = video_dir / "masks" / object
    test_frame = Image.open(folder / frame_names[0])
    test_frame_height, test_frame_width = np.array(test_frame).shape[:2]
    # st.image(test_frame, use_container_width=True)
    # mode = st.selectbox(
    #     "Select start point and length scale", ["Start point", "Length scale"]
    # )
    if "result_dict_init" not in st.session_state:
        result_dict_init = {obj: {"points": [], "labels": []} for obj in objects_masks}
        st.session_state["result_dict_init"] = result_dict_init.copy()

    target_image_path = str(folder / frame_names[0])
    frame_height, frame_width = np.array(Image.open(target_image_path)).shape[:2]
    new_labels = pointdet(
        image_path=target_image_path,
        label_list=[object + "_start"],
        points=st.session_state["result_dict_init"][object]["points"],
        labels=st.session_state["result_dict_init"][object]["labels"],
        use_space=True,
        key=target_image_path + "_init",
        height=frame_height,
        width=frame_width,
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
    st.json(start_points_dict)
    if not any([v["points"] for v in start_points_dict.values()]):
        st.warning("Please select all start point")
        st.stop()
    st.write("### Results")
    centerlines = []
    start_coords = (
        start_points_dict[object]["points"][0][0],
        test_frame_height - start_points_dict[object]["points"][0][1],
    )
    for frame in frame_names:
        image = cv2.imread(folder / frame)
        contour = get_contours(image)
        start_index = find_closest_point(contour, start_coords)
        centerline = get_centerline(
            contour, start_index, display=(frame == frame_names[0])
        )
        centerlines.append(centerline)
        #     end_index = find_closest_point(contour, (end_x, end_y))
        #     sides = split_contour(contour, start_index, end_index, display=True)
        #     centerlines.append(get_centerline(sides, contour, display=True))
    display_centerlines(centerlines)
    get_tip_angles(centerlines, display=True)
    get_arclength(centerlines, display=True)
