from pathlib import Path
import cv2
import numpy as np
from scipy.interpolate import interp1d
from typing import Tuple, List, Optional


def distribute_points(
    x: np.ndarray, y: np.ndarray, n_points: int
) -> Tuple[np.ndarray, np.ndarray]:
    """Redistribute points uniformly along a contour"""
    distances = np.sqrt(np.diff(x) ** 2 + np.diff(y) ** 2)
    cumulative_dist = np.insert(np.cumsum(distances), 0, 0)
    uniform_dist = np.linspace(0, cumulative_dist[-1], n_points)
    x_interp = interp1d(cumulative_dist, x, kind="linear")
    y_interp = interp1d(cumulative_dist, y, kind="linear")
    x_uniform = x_interp(uniform_dist)
    y_uniform = y_interp(uniform_dist)
    return x_uniform, y_uniform


def apply_pca(
    points: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Apply PCA to get principal components"""
    mu = np.mean(points, axis=0)
    Xc = points - mu
    C = np.cov(Xc, rowvar=False)
    eigenvals, eigenvecs = np.linalg.eigh(C)

    # Sort by eigenvalue (largest first)
    idx = np.argsort(eigenvals)[::-1]
    eigenvals = eigenvals[idx]
    eigenvecs = eigenvecs[:, idx]

    v1 = eigenvecs[:, 0]  # First principal axis (length direction)
    v2 = eigenvecs[:, 1]  # Second principal axis (width direction)

    return mu, v1, v2, eigenvals


def PCA_sort(
    points: np.ndarray, points_to_sort: Optional[np.ndarray] = None
) -> np.ndarray:
    """Apply PCA and sort points along principal axis"""
    mu = np.mean(points, axis=0)
    Xc = points - mu
    C = np.cov(Xc, rowvar=False)
    eigenvals, eigenvecs = np.linalg.eigh(C)
    v1 = eigenvecs[:, np.argmax(eigenvals)]  # principal axis

    if points_to_sort is not None:
        Xc = points_to_sort - mu
    s = Xc @ v1
    order = np.argsort(s)
    points_to_use = points_to_sort if points_to_sort is not None else points
    return points_to_use[order]


def get_principal_axis(points: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Get principal axis from points"""
    mu = np.mean(points, axis=0)
    Xc = points - mu
    C = np.cov(Xc, rowvar=False)
    eigenvals, eigenvecs = np.linalg.eigh(C)
    v1 = eigenvecs[:, np.argmax(eigenvals)]  # principal axis
    return mu, v1


def find_mask_centroid(mask: np.ndarray) -> np.ndarray:
    """Find the centroid of the mask that is guaranteed to be inside"""
    # Use moments to find centroid
    moments = cv2.moments(mask)

    cx = int(moments["m10"] / moments["m00"])
    cy = int(moments["m01"] / moments["m00"])
    # Verify centroid is inside mask
    if mask[cy, cx] > 0:
        return np.array([cx, cy])
    # If centroid is outside, find nearest point inside mask
    y_coords, x_coords = np.where(mask > 0)
    mask_points = np.column_stack((x_coords, y_coords))
    distances = np.sum((mask_points - np.array([cx, cy])) ** 2, axis=1)
    nearest_idx = np.argmin(distances)
    return mask_points[nearest_idx]


def find_width_intersections(
    mask: np.ndarray, centroid: np.ndarray, width_axis: np.ndarray
) -> List[np.ndarray]:
    """Find intersections of width axis with mask edges"""
    h, w = mask.shape
    intersections = []

    # Step in both directions along the width axis
    for direction in [-1, 1]:
        t = 0
        step_size = 0.5

        while t < max(w, h):  # Maximum possible distance
            point = centroid + direction * t * width_axis
            x, y = int(round(point[0])), int(round(point[1]))

            # Check if point is outside image bounds
            if x < 0 or x >= w or y < 0 or y >= h:
                break
            # Check if we've hit an edge (transition from inside to outside mask)
            if mask[y, x] == 0:  # We're outside the mask
                # Step back to find the edge
                prev_point = centroid + direction * (t - step_size) * width_axis
                prev_x, prev_y = int(round(prev_point[0])), int(round(prev_point[1]))

                if 0 <= prev_x < w and 0 <= prev_y < h and mask[prev_y, prev_x] > 0:
                    intersections.append(prev_point)
                break
            t += step_size

    return intersections


def edge_pca_centerline(
    path: Path | str,
    edge_percentage: float | None = None,
    n_points: int | None = None,
) -> np.ndarray:
    """
    Extract centerline for the largest contour in a mask image.

    Args:
        path: Path to the mask image
        edge_percentage: Percentage of contour points to use for edge detection
        n_points: Number of points to generate along centerline

    Returns:
        Centerline as numpy array of shape (n_points, 2)
    """
    frame = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    _, mask = cv2.threshold(frame, 128, 255, cv2.THRESH_BINARY)

    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    largest_contour = max(contours, key=cv2.contourArea)

    # Use the new contour-based function
    return edge_pca_centerline_from_contour(
        largest_contour, mask, edge_percentage, n_points
    )


def multi_contour_centerlines(
    path: str,
    n_contours: int | None = None,
    edge_percentage: float | None = None,
    n_points: int | None = None,
) -> np.ndarray:
    """
    Extract centerlines for multiple contours in a mask image.

    Args:
        path: Path to the mask image
        n_contours: Number of contours to process (largest first)
        edge_percentage: Percentage of contour points to use for edge detection
        n_points: Number of points to generate along each centerline
        display: Whether to display the contours with different colors

    Returns:
        List of centerlines, each as numpy array of shape (n_points, 2)
    """

    frame = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    _, mask = cv2.threshold(frame, 128, 255, cv2.THRESH_BINARY)

    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if len(contours) == 0:
        return []

    # Sort contours by area (largest first)
    contours_sorted = sorted(contours, key=cv2.contourArea, reverse=True)

    # Take only the requested number of contours
    if n_contours is None or n_contours > len(contours_sorted):
        n_contours = len(contours_sorted)
    selected_contours = contours_sorted[: min(n_contours, len(contours_sorted))]

    centerlines = []
    for i, contour in enumerate(selected_contours):
        if area := cv2.contourArea(contour) < 100:
            print(f"Skipping contour {i} with area {area} (too small)")
            continue
        try:
            # Create a mask for this specific contour
            contour_mask = np.zeros_like(mask)
            cv2.fillPoly(contour_mask, [contour], (255,))
            # print(
            #     f"Processing contour {i + 1}/{n_contours} with area {cv2.contourArea(contour)}"
            # )
            centerline = edge_pca_centerline_from_contour(
                contour, contour_mask, edge_percentage, n_points
            )
            centerlines.append(centerline)
        except Exception as e:
            continue
    stacked = np.vstack(centerlines) if centerlines else np.empty((0, 2))
    return stacked


def edge_pca_centerline_from_contour(
    contour: np.ndarray,
    mask: np.ndarray,
    edge_percentage: float | None = None,
    n_points: int | None = None,
) -> np.ndarray:
    """
    Extract centerline from a given contour using edge PCA method.

    Args:
        contour: OpenCV contour array
        edge_percentage: Percentage of contour points to use for edge detection
        n_points: Number of points to generate along centerline

    Returns:
        Centerline as numpy array of shape (n_points, 2)
    """
    # Distribute points uniformly along contour
    if edge_percentage is None or n_points is None:
        # Calculate adaptive parameters based on contour geometry
        edge_percentage_, n_points_ = calculate_adaptive_parameters(contour, mask)
        if edge_percentage is None:
            edge_percentage = edge_percentage_
        if n_points is None:
            n_points = n_points_

    contour_points = contour.reshape(-1, 2)
    x_sorted, y_sorted = contour_points[:, 0], contour_points[:, 1]
    x_uniform, y_uniform = distribute_points(x_sorted, y_sorted, len(contour))
    uniform_contour = np.column_stack((x_uniform, y_uniform))
    sorted_points = PCA_sort(uniform_contour)
    print("GOT EDGE_PERCENTAGE:", edge_percentage)
    # Get first and last edge_percentage of points
    n = max(int(len(sorted_points) * edge_percentage), 1)
    start_edge_points = sorted_points[:n]
    end_edge_points = sorted_points[-n:]

    # Fit rectangular contours to start and end edge points

    def fit_rectangle_to_points(points):
        """Fit a minimum area rectangle to a set of points"""
        if len(points) < 3:
            if cv2.contourArea(contour) > 2000:
                print("edge_percentage:", edge_percentage)
                print("n_points:", n_points)
                print("points:", sorted_points)
            raise ValueError(
                f"Cannot fit rectangle to {len(points)} points. Need at least 3 points."
            )

        try:
            # Apply PCA to get principal axes
            mu, v1, v2, _ = apply_pca(points)
        except Exception as e:
            raise ValueError(f"PCA failed for rectangle fitting: {e}")

        # Project points onto principal axes
        centered_points = points - mu
        proj_v1 = np.dot(centered_points, v1)
        proj_v2 = np.dot(centered_points, v2)

        # Find extents along each axis
        min_v1, max_v1 = np.min(proj_v1), np.max(proj_v1)
        min_v2, max_v2 = np.min(proj_v2), np.max(proj_v2)

        # Check for degenerate cases
        if np.isclose(max_v1, min_v1) or np.isclose(max_v2, min_v2):
            raise ValueError(
                "Cannot fit rectangle: points are collinear or form a degenerate shape"
            )

        # Create rectangle corners in projected space
        corners_proj = np.array(
            [
                [min_v1, min_v2],
                [max_v1, min_v2],
                [max_v1, max_v2],
                [min_v1, max_v2],
                [min_v1, min_v2],
            ]
        )

        # Transform back to original coordinate system
        corners = mu + corners_proj[:, 0:1] * v1 + corners_proj[:, 1:2] * v2

        return corners

    # Fit rectangles to both edge point sets
    start_rectangle = fit_rectangle_to_points(start_edge_points)
    end_rectangle = fit_rectangle_to_points(end_edge_points)

    # Find where principal axes cross the contours for each edge group
    axis_intersections = []
    # Find the side of each rectangle that is farthest along the principal axis
    # Find the center points of each side of both rectangles
    start_side_centers = []
    end_side_centers = []

    for rectangle, side_centers in [
        (start_rectangle, start_side_centers),
        (end_rectangle, end_side_centers),
    ]:
        # Calculate center of each side (rectangle has 5 points, last one closes it)
        for i in range(4):  # 4 sides
            side_start = rectangle[i]
            side_end = rectangle[i + 1]
            side_center = (side_start + side_end) / 2
            side_centers.append(side_center)

    # Use the main principal axis of the contour, not the principal axis of the rectangle
    mu, v1 = get_principal_axis(uniform_contour)

    # Project side centers onto principal axis and find most extreme
    start_projections = [
        (np.dot(center - mu, v1), center) for center in start_side_centers
    ]
    end_projections = [(np.dot(center - mu, v1), center) for center in end_side_centers]
    # Find the most extreme (farthest) point along each principal axis
    start_extreme = max(start_projections, key=lambda x: abs(x[0]))[1]
    end_extreme = max(end_projections, key=lambda x: abs(x[0]))[1]

    axis_intersections = [start_extreme, end_extreme]

    edge_segments = []
    for corner_idx in range(len(axis_intersections)):
        start_corner = axis_intersections[corner_idx]
        end_corner = axis_intersections[(corner_idx + 1) % len(axis_intersections)]

        # Find closest points on contour to the corners
        start_idx = np.argmin(np.sum((uniform_contour - start_corner) ** 2, axis=1))
        end_idx = np.argmin(np.sum((uniform_contour - end_corner) ** 2, axis=1))

        # Extract segment between corners
        if start_idx <= end_idx:
            segment = uniform_contour[start_idx : end_idx + 1]
        else:
            # Wrap around
            segment = np.vstack(
                [uniform_contour[start_idx:], uniform_contour[: end_idx + 1]]
            )

        # Redistribute n_points along this segment
        if len(segment) > 1:
            x_seg, y_seg = distribute_points(segment[:, 0], segment[:, 1], n_points)
            redistributed_segment = np.column_stack((x_seg, y_seg))

            # Reverse the second segment to match orientation
            if corner_idx == 1:
                redistributed_segment = redistributed_segment[::-1]

            edge_segments.append(redistributed_segment)

    # Find centerline by averaging corresponding points between edge segments
    if len(edge_segments) >= 2:
        segment1, segment2 = edge_segments[0], edge_segments[1]
        centerline = (segment1 + segment2) / 2
        return centerline
    else:
        if cv2.contourArea(contour) > 2000:
            print(
                f":( :( :( Could not extract two edge segments from contour: {len(edge_segments)} found"
            )
        raise ValueError("Could not extract two edge segments from contour")


def calculate_adaptive_parameters(
    contour: np.ndarray, mask: np.ndarray
) -> Tuple[float, int]:
    """
    Calculate adaptive edge_percentage and n_points based on contour geometry.

    Args:
        contour: OpenCV contour array
        mask: Binary mask of the contour

    Returns:
        tuple: (edge_percentage, n_points) where:
            - edge_percentage = width / length
            - n_points = length (rounded to int)
    """
    contour_points = contour.reshape(-1, 2)

    # Step 1: Apply PCA to redistributed contour
    x_sorted, y_sorted = contour_points[:, 0], contour_points[:, 1]
    x_uniform, y_uniform = distribute_points(x_sorted, y_sorted, len(contour_points))
    redistributed_contour = np.column_stack((x_uniform, y_uniform))

    _, _, width_axis, _ = apply_pca(redistributed_contour)
    mask_centroid = find_mask_centroid(mask)
    # Step 2: Estimate width from eigenvalues ratio
    # For rod-like shapes, width is approximately related to the square root of the smaller eigenvalue
    width_intersections = find_width_intersections(mask, mask_centroid, width_axis)
    if len(width_intersections) < 2:
        raise ValueError("Could not find sufficient width intersections in contour")
    width = np.linalg.norm(width_intersections[0] - width_intersections[1])
    # Step 3: Find length (contour perimeter adjusted for rod shape)
    arclength = cv2.arcLength(contour, True)
    length = (arclength - 2 * width) / 2

    # Step 4: Calculate parameters
    edge_percentage = (
        (width + length / 2) / (2 * width + 2 * length) if length > 0 else 0.3
    )
    n_points = int(np.ceil(length))

    # Apply reasonable bounds
    edge_percentage = max(
        0.01, min(0.5, float(edge_percentage))
    )  # Clamp between 1% and 50%
    n_points = max(10, min(1000, int(n_points)))  # Clamp between 10 and 1000 points

    return edge_percentage, n_points
