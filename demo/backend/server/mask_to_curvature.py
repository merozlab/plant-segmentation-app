import pandas as pd
import glob
import numpy as np
import cv2
import matplotlib.pyplot as plt
from scipy.interpolate import interp1d
from typing import Optional, Tuple
from numpy.typing import ArrayLike
import streamlit as st


def get_contours(path) -> np.ndarray:
    image = cv2.imread(path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Apply binary thresholding
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Get main contour
    largest_contour = max(contours, key=cv2.contourArea)
    # flip y axis
    largest_contour[:, 0, 1] = image.shape[0] - largest_contour[:, 0, 1]
    return largest_contour


def plot_contour(contour):
    x_contour, y_contour = contour[:, 0, 0], contour[:, 0, 1]
    plt.figure()
    plt.plot(x_contour, y_contour, "b-", label="Original Contour")
    plt.legend()
    plt.axis("equal")
    st.pyplot(plt.gcf())


def distribute_points(x, y, n_points):
    distances = np.sqrt(np.diff(x) ** 2 + np.diff(y) ** 2)
    cumulative_dist = np.insert(np.cumsum(distances), 0, 0)
    uniform_dist = np.linspace(0, cumulative_dist[-1], n_points)
    x_interp = interp1d(cumulative_dist, x, kind="linear")
    y_interp = interp1d(cumulative_dist, y, kind="linear")
    x_uniform = x_interp(uniform_dist)
    y_uniform = y_interp(uniform_dist)
    return x_uniform, y_uniform


def get_centerline(contour, start_index, dist=100, display=False):
    shifted_contour = np.concatenate((contour[start_index:], contour[:start_index]))
    x, y = shifted_contour[:, 0, 0], shifted_contour[:, 0, 1]
    x_unif, y_unif = distribute_points(x, y, dist)
    stack = np.column_stack((x_unif, y_unif))
    centerline = (stack[: dist // 2] + stack[dist // 2 :][::-1]) / 2
    centerline_intrep = distribute_points(centerline[:, 0], centerline[:, 1], dist // 2)
    if display:
        plot_centerline(x, y, x_unif, y_unif, centerline_intrep)
    return centerline_intrep


def plot_centerline(x, y, x_unif, y_unif, centerline):
    plt.figure()
    plt.plot(x, y, "b-", label="Original Contour")
    plt.plot(x_unif, y_unif, "ro", label="Uniform Points")
    plt.plot(centerline[0], centerline[1], "go", label="Centerline")
    plt.legend()
    plt.axis("equal")
    st.pyplot(plt.gcf())


def find_closest_point(contour, point):
    distances = np.sqrt(np.sum((contour[:, 0, :] - point) ** 2, axis=1))
    return int(np.argmin(distances))


def display_centerlines(centerlines):
    # centerlines
    colors = plt.cm.viridis(np.linspace(0, 1, len(centerlines)))
    plt.figure()
    for i, (x, y) in enumerate(centerlines):
        plt.plot(x[:-2], y[:-2], color=colors[i])
    plt.title("Centerlines")
    plt.xlabel("x")
    plt.ylabel("y")
    plt.axis("equal")
    st.pyplot(plt.gcf())


def display_angles(avg_angles, std_angles):
    plt.figure()
    plt.errorbar(
        range(len(avg_angles)),
        avg_angles,
        yerr=std_angles,
        fmt=".",
        ecolor="r",
        capsize=0,
    )
    plt.title(
        "Angle between the Second to Last Point and the 10th to Last Point for Each Centerline"
    )
    plt.xlabel("Centerline Index")
    plt.ylabel("Angle (radians)")
    # Set y-ticks in terms of π
    y_ticks = np.arange(0, np.pi + np.pi / 4, np.pi / 4)
    y_labels = [f"${tick/np.pi}\\pi$" if tick != 0 else "0" for tick in y_ticks]
    plt.yticks(y_ticks, y_labels)
    st.pyplot(plt.gcf())


def get_arclength(centerlines, display=False):
    arclengths = []
    for centerline in centerlines:
        x, y = centerline
        dx = np.diff(x)
        dy = np.diff(y)
        arclength = np.sum(np.sqrt(dx**2 + dy**2))
        arclengths.append(arclength)
    if display:
        plt.clf()
        plt.plot(range(len(arclengths)), arclengths)
        plt.title("Arclength of Centerlines")
        plt.xlabel("Time")
        plt.ylabel("Arclength")
        st.pyplot(plt.gcf())
    return arclengths


def get_tip_angles(centerlines, display=False):
    angles = []
    for centerline in centerlines:
        x_points, y_points = centerline
        angles_between_points = []
        for i in range(5, 11):
            dx = x_points[-2] - x_points[-i]
            dy = y_points[-2] - y_points[-i]
            angle = np.arctan2(dy, dx)
            angles_between_points.append(angle)
        avg_angle = np.mean(angles_between_points)
        std_angle = np.std(angles_between_points)
        angles.append((avg_angle, std_angle))
    avg_angles, std_angles = zip(*angles)
    if display:
        display_angles(avg_angles, std_angles)
    return angles


def centerlines_to_df(centerlines):
    l = []
    for i, t in enumerate(centerlines):
        l.append(pd.DataFrame({"frame": i, "x": t[0], "y": t[1]}))
    return pd.concat(l).reset_index(drop=True)
