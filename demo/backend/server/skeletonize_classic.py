import pandas as pd
import numpy as np
import cv2
from skimage.morphology import skeletonize
from scipy.interpolate import interp1d
from typing import Dict, List, Optional
from numpy.typing import ArrayLike


def distribute_points(x, y, n_points):
    distances = np.sqrt(np.diff(x) ** 2 + np.diff(y) ** 2)
    cumulative_dist = np.insert(np.cumsum(distances), 0, 0)
    uniform_dist = np.linspace(0, cumulative_dist[-1], n_points)
    x_interp = interp1d(cumulative_dist, x, kind="linear")
    y_interp = interp1d(cumulative_dist, y, kind="linear")
    x_uniform = x_interp(uniform_dist)
    y_uniform = y_interp(uniform_dist)
    return x_uniform, y_uniform


def get_centerline_skeletonize(path, n_points=100):
    """
    Extract centerline using skimage skeletonize algorithm for multiple contours.

    Args:
        path: Path to the binary mask image
        n_points: Number of points to return for the centerline

    Returns:
        List containing [x_coords, y_coords] of the centerline points
    """
    # Handle None n_points parameter
    if n_points is None:
        n_points = 100

    # Read image and convert to binary
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return [[], []]

    # Ensure binary image
    _, binary = cv2.threshold(image, 127, 255, cv2.THRESH_BINARY)

    # Find contours to identify separate regions
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if len(contours) == 0:
        return [[], []]

    # Sort contours by area (largest first) and filter out very small ones
    contours_sorted = sorted(contours, key=cv2.contourArea, reverse=True)

    # Filter out contours that are too small (less than 100 pixels area)
    min_contour_area = 100
    significant_contours = [
        c for c in contours_sorted if cv2.contourArea(c) >= min_contour_area
    ]

    if len(significant_contours) == 0:
        return [[], []]

    all_centerlines = []

    # Process each significant contour separately
    for contour in significant_contours:
        try:
            # Create a mask for this specific contour
            contour_mask = np.zeros_like(binary)
            cv2.fillPoly(contour_mask, [contour], 255)

            # Apply skeletonization to this contour only
            binary_bool = contour_mask > 0
            skeleton = skeletonize(binary_bool)

            # Find skeleton points
            skeleton_points = np.where(skeleton)

            if len(skeleton_points[0]) == 0:
                continue

            # Convert to (x, y) coordinates
            y_coords = skeleton_points[0]
            x_coords = skeleton_points[1]
            skeleton_coords = np.column_stack((x_coords, y_coords))

            if len(skeleton_coords) < 2:
                continue

            # Order points to create a continuous path
            ordered_points = _order_skeleton_points(skeleton_coords)

            if len(ordered_points) < 2:
                continue

            # Calculate number of points proportional to contour size for this specific contour
            contour_area = cv2.contourArea(contour)
            total_area = sum(cv2.contourArea(c) for c in significant_contours)

            # Ensure we don't divide by zero and have a reasonable minimum
            if total_area > 0:
                contour_n_points = max(10, int(n_points * (contour_area / total_area)))
            else:
                contour_n_points = max(10, n_points // len(significant_contours))

            x_uniform, y_uniform = distribute_points(
                ordered_points[:, 0], ordered_points[:, 1], contour_n_points
            )

            all_centerlines.append([x_uniform.tolist(), y_uniform.tolist()])

        except Exception as e:
            print(f"Warning: Failed to extract skeleton centerline for contour: {e}")
            continue

    if len(all_centerlines) == 0:
        return [[], []]
    elif len(all_centerlines) == 1:
        return all_centerlines[0]
    else:
        # Combine multiple centerlines by concatenating them
        # This creates a single centerline that includes all significant contours
        all_x = []
        all_y = []
        for centerline in all_centerlines:
            all_x.extend(centerline[0])
            all_y.extend(centerline[1])

        # Redistribute points uniformly across the combined centerline
        if len(all_x) >= n_points:
            # Sample n_points from the combined centerlines
            indices = np.linspace(0, len(all_x) - 1, n_points, dtype=int)
            sampled_x = [all_x[i] for i in indices]
            sampled_y = [all_y[i] for i in indices]
            return [sampled_x, sampled_y]
        else:
            return [all_x, all_y]


def _order_skeleton_points(skeleton_coords):
    """
    Order skeleton points to create a continuous path.

    Args:
        skeleton_coords: numpy array of (x, y) coordinates

    Returns:
        numpy array of ordered points
    """
    if len(skeleton_coords) < 2:
        return skeleton_coords

    ordered_points = []
    remaining_points = skeleton_coords.tolist()

    # Start with the first point
    current_point = remaining_points.pop(0)
    ordered_points.append(current_point)

    # Find the next closest point iteratively to create a path
    while remaining_points:
        distances = [
            np.linalg.norm(np.array(current_point) - np.array(p))
            for p in remaining_points
        ]
        closest_idx = np.argmin(distances)
        current_point = remaining_points.pop(closest_idx)
        ordered_points.append(current_point)

    return np.array(ordered_points)
