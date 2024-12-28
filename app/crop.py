# with crop_tab:
#     # TODO: session state
#     # Upload an image and set some options for demo purposes
#     objects = [f"Object {i}" for i in range(n_objects)]
#     bboxs = detection(
#         image_path=video_dir / frame_names[0],
#         label_list=objects,
#         bboxes=[[frame_width // 4, frame_height // 4] * 2],
#         labels=[0],
#         height=512,
#         width=512,
#         line_width=5,
#         use_space=True,
#     )
#     if not bboxs:
#         st.warning("Please draw bounding boxes around the objects and press complete")
#         # st.stop()
#     else:
#         labels = [b["label_id"] for b in bboxs]
#         if len(set(labels)) != len(labels):
#             st.warning("Please make sure the labels are unique")
#             # st.stop()
#         if st.button("Crop all photos", key=f"crop_button_{i}"):
#             (video_dir / "cropped").mkdir(exist_ok=True)
#             for i, bbox in enumerate(bboxs):
#                 b = bbox["bbox"]
#                 (video_dir / "cropped" / f"object_{i}").mkdir(exist_ok=True)
#                 for frame_name in frame_names:
#                     img_path = video_dir / frame_name
#                     img = Image.open(img_path)
#                     cropped_img = img.crop((b[0], b[1], b[0] + b[2], b[1] + b[3]))
#                     cropped_img.save(video_dir / f"cropped/object_{i}" / frame_name)
#             st.success("Cropped all photos :)")
