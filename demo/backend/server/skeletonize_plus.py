from pathlib import Path
import cv2
import numpy as np
from scipy.interpolate import interp1d
from typing import Tuple, List, Optional


def _distribute_points(
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


def _apply_pca(
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


def _find_mask_centroid(mask: np.ndarray) -> np.ndarray:
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


def _find_width_intersections(
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


def _calculate_adaptive_parameters(
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
    x_uniform, y_uniform = _distribute_points(x_sorted, y_sorted, len(contour_points))
    redistributed_contour = np.column_stack((x_uniform, y_uniform))

    _, _, width_axis, _ = _apply_pca(redistributed_contour)
    mask_centroid = _find_mask_centroid(mask)
    # Step 2: Estimate width from eigenvalues ratio
    # For rod-like shapes, width is approximately related to the square root of the smaller eigenvalue
    width_intersections = _find_width_intersections(mask, mask_centroid, width_axis)
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


def _find_endpoints_with_skeleton(mask):
    """
    Find rod endpoints by skeletonizing the mask and finding skeleton endpoints.
    """
    from skimage.morphology import skeletonize

    # Skeletonize the mask
    skeleton = skeletonize(mask > 0)

    # Find skeleton endpoints (pixels with only 1 neighbor)
    def count_neighbors(skeleton):
        """Count the number of skeleton neighbors for each skeleton pixel."""
        kernel = np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.uint8)

        # Convolve to count neighbors
        neighbor_count = cv2.filter2D(skeleton.astype(np.uint8), -1, kernel)
        return neighbor_count

    neighbor_count = count_neighbors(skeleton)

    # Endpoints have exactly 1 neighbor
    endpoints_mask = (skeleton > 0) & (neighbor_count == 1)
    endpoint_coords = np.column_stack(np.where(endpoints_mask))

    if len(endpoint_coords) < 2:
        # Fallback: use the two skeleton points farthest from each other
        skeleton_coords = np.column_stack(np.where(skeleton > 0))
        if len(skeleton_coords) >= 2:
            # Find the two skeleton points farthest apart
            max_dist = 0
            best_pair = (0, 1)
            for i in range(len(skeleton_coords)):
                for j in range(i + 1, len(skeleton_coords)):
                    dist = np.linalg.norm(skeleton_coords[i] - skeleton_coords[j])
                    if dist > max_dist:
                        max_dist = dist
                        best_pair = (i, j)
            endpoint_coords = skeleton_coords[[best_pair[0], best_pair[1]]]
        else:
            # Ultimate fallback
            return None, None, skeleton

    # Convert from (y, x) to (x, y) format
    endpoints = endpoint_coords[:, [1, 0]]

    # If more than 2 endpoints, pick the two farthest apart
    if len(endpoints) > 2:
        max_dist = 0
        best_pair = (0, 1)
        for i in range(len(endpoints)):
            for j in range(i + 1, len(endpoints)):
                dist = np.linalg.norm(endpoints[i] - endpoints[j])
                if dist > max_dist:
                    max_dist = dist
                    best_pair = (i, j)
        endpoints = endpoints[[best_pair[0], best_pair[1]]]

    return endpoints[0], endpoints[1], skeleton


def _line_segment_intersect_contour(line_start, line_end, contour_points):
    """Find all intersections between a line segment and contour segments"""
    intersections = []

    for i in range(len(contour_points)):
        p1 = contour_points[i]
        p2 = contour_points[(i + 1) % len(contour_points)]

        # Line segment intersection using parametric form
        d1 = line_end - line_start
        d2 = p2 - p1
        d3 = line_start - p1

        cross_d1_d2 = d1[0] * d2[1] - d1[1] * d2[0]

        if abs(cross_d1_d2) < 1e-10:  # Parallel lines
            continue

        t = (-d3[0] * d2[1] + d3[1] * d2[0]) / cross_d1_d2
        s = (-d3[0] * d1[1] + d3[1] * d1[0]) / cross_d1_d2

        # Check if intersection is within both line segments
        if 0 <= t <= 1 and 0 <= s <= 1:
            intersection_point = line_start + t * d1
            intersections.append(intersection_point)

    return np.array(intersections) if intersections else np.array([]).reshape(0, 2)


def _get_contour_intercept_with_rectangle_axis(
    rectangle, skeleton_endpoint, contour_points
):
    """Find where the line cutting through rectangle's shorter axis intercepts the contour"""

    # Get all 4 side centers and their lengths
    side_info = []
    for i in range(4):
        side_start = rectangle[i]
        side_end = rectangle[i + 1]
        side_length = np.linalg.norm(side_end - side_start)
        side_center = (side_start + side_end) / 2
        side_info.append((side_length, side_center, i))

    # Sort by length to find shorter and longer sides
    side_info.sort(key=lambda x: x[0])
    shorter_sides = side_info[:2]  # Two shortest sides

    # Get midpoints of the two shorter sides
    shorter_center1 = shorter_sides[0][1]
    shorter_center2 = shorter_sides[1][1]

    # The line cutting through the rectangle is between these two shorter side centers
    line_start = shorter_center1
    line_end = shorter_center2
    line_direction = line_end - line_start
    line_length = np.linalg.norm(line_direction)

    if line_length < 1e-10:  # Degenerate case
        return skeleton_endpoint

    # Extend the line beyond the rectangle to ensure we catch contour intersections
    extended_line_start = line_start - 2 * line_direction
    extended_line_end = line_end + 2 * line_direction

    intersections = _line_segment_intersect_contour(
        extended_line_start, extended_line_end, contour_points
    )

    if len(intersections) == 0:
        # Fallback: return the shorter side center closest to skeleton endpoint
        distances = [
            np.linalg.norm(info[1] - skeleton_endpoint) for info in shorter_sides
        ]
        closest_idx = np.argmin(distances)
        return shorter_sides[closest_idx][1]

    # Choose the intersection closest to the skeleton endpoint
    distances_to_skeleton = [
        np.linalg.norm(point - skeleton_endpoint) for point in intersections
    ]
    closest_intersection_idx = np.argmin(distances_to_skeleton)
    chosen_intersection = intersections[closest_intersection_idx]

    return chosen_intersection


def _get_endpoint_neighborhood_adaptive(endpoint, contour_points, edge_percentage):
    """Get neighborhood points around an endpoint using adaptive edge_percentage."""
    # Find the closest contour point to the endpoint
    distances = np.linalg.norm(contour_points - endpoint, axis=1)
    closest_idx = np.argmin(distances)

    # Calculate neighborhood size based on edge_percentage
    total_contour_length = len(contour_points)
    neighborhood_size = max(
        int(total_contour_length * edge_percentage), 5
    )  # At least 5 points
    half_size = neighborhood_size // 2

    # Get indices for the neighborhood (with wrap-around for closed contours)
    indices = []
    for i in range(-half_size, half_size + 1):
        idx = (closest_idx + i) % total_contour_length
        indices.append(idx)

    neighborhood = contour_points[indices]
    return neighborhood


def _fit_rectangle_to_points(points):
    """Fit a minimum area rectangle to a set of points"""
    if len(points) < 3:
        raise ValueError(
            f"Cannot fit rectangle to {len(points)} points. Need at least 3 points."
        )

    try:
        # Apply PCA to get principal axes
        mu, v1, v2, _ = _apply_pca(points)
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


def _validate_and_clean_centerline(centerline, mask, n_points):
    """Remove centerline points that fall outside the mask and redistribute evenly"""
    valid_points = []

    for point in centerline:
        x, y = int(round(point[0])), int(round(point[1]))
        # Check if point is within image bounds and inside mask
        if 0 <= x < mask.shape[1] and 0 <= y < mask.shape[0] and mask[y, x] > 0:
            valid_points.append(point)

    if len(valid_points) < 2:
        raise ValueError("Too few valid centerline points inside mask")

    valid_points = np.array(valid_points)

    # Redistribute points evenly along the cleaned centerline
    if len(valid_points) != n_points:
        x_clean, y_clean = _distribute_points(
            valid_points[:, 0], valid_points[:, 1], n_points
        )
        redistributed_centerline = np.column_stack((x_clean, y_clean))
        return redistributed_centerline

    return valid_points


def _visualize_centerline_extraction(mask, start_rectangle, end_rectangle, centerline):
    """Visualize the centerline extraction process"""
    import matplotlib.pyplot as plt

    plt.figure(figsize=(12, 10))

    # Plot the mask
    plt.imshow(mask, cmap="gray", alpha=0.7)

    # Plot fitted rectangles
    plt.plot(
        start_rectangle[:, 0],
        start_rectangle[:, 1],
        "g-",
        linewidth=3,
        label="Start rectangle",
    )
    plt.plot(
        end_rectangle[:, 0],
        end_rectangle[:, 1],
        "orange",
        linewidth=3,
        label="End rectangle",
    )

    # Plot centerline
    plt.plot(
        centerline[:, 0],
        centerline[:, 1],
        "r-",
        linewidth=3,
        label="Centerline",
    )

    plt.title("Rectangle Fitting and Centerline")
    plt.legend()
    plt.axis("equal")
    plt.tight_layout()
    plt.show()


def skeletonize_plus(
    path: Path | str,
    edge_percentage: float | None = None,
    n_points: int | None = None,
    plot: bool = False,
) -> np.ndarray:
    """
    Extract centerline for the largest contour in a mask image.

    Args:
        path: Path to the mask image
        edge_percentage: Percentage of contour points to use for edge detection
        n_points: Number of points to generate along centerline
        plot: Whether to show visualization of fitted rectangles and centerline

    Returns:
        Centerline as numpy array of shape (n_points, 2)
    """
    frame = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    _, mask = cv2.threshold(frame, 128, 255, cv2.THRESH_BINARY)

    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    largest_contour = max(contours, key=cv2.contourArea)

    # Use the new contour-based function
    return skeletonize_plus_from_contour(
        largest_contour, mask, edge_percentage, n_points, plot
    )


def skeletonize_plus_from_contour(
    contour: np.ndarray,
    mask: np.ndarray,
    edge_percentage: float | None = None,
    n_points: int | None = None,
    plot: bool = False,
) -> np.ndarray:
    """
    Extract centerline from a given contour using skeleton-based endpoint detection.

    Args:
        contour: OpenCV contour array
        mask: Binary mask of the contour
        edge_percentage: Percentage of contour points to use for edge detection
        n_points: Number of points to generate along centerline
        plot: Whether to show visualization

    Returns:
        Centerline as numpy array of shape (n_points, 2)
    """
    # Validate and set edge_percentage if provided
    if edge_percentage is not None:
        # Ensure edge_percentage is within valid range (1% to 50%)
        if not (0.01 <= edge_percentage <= 0.5):
            raise ValueError(
                f"edge_percentage must be between 0.01 (1%) and 0.5 (50%), got {edge_percentage}"
            )

    # Validate and set n_points if provided
    if n_points is not None:
        # Ensure n_points is within valid range
        if not (10 <= n_points <= 1000):
            raise ValueError(
                f"n_points must be between 10 and 1000, got {n_points}"
            )

    # Calculate adaptive parameters if not provided
    if edge_percentage is None or n_points is None:
        edge_percentage_, n_points_ = _calculate_adaptive_parameters(contour, mask)
        if edge_percentage is None:
            edge_percentage = edge_percentage_
        if n_points is None:
            n_points = n_points_

    # Distribute points uniformly along contour
    contour_points = contour.reshape(-1, 2)
    x_sorted, y_sorted = contour_points[:, 0], contour_points[:, 1]
    x_uniform, y_uniform = _distribute_points(x_sorted, y_sorted, len(contour))
    uniform_contour = np.column_stack((x_uniform, y_uniform))

    # Find rod endpoints using skeletonization
    start_endpoint, end_endpoint, _ = _find_endpoints_with_skeleton(mask)

    if start_endpoint is None or end_endpoint is None:
        raise ValueError("Could not find skeleton endpoints")

    # Create neighborhoods around the endpoints using adaptive edge_percentage
    start_edge_points = _get_endpoint_neighborhood_adaptive(
        start_endpoint, uniform_contour, edge_percentage
    )
    end_edge_points = _get_endpoint_neighborhood_adaptive(
        end_endpoint, uniform_contour, edge_percentage
    )

    # Fit rectangles to both edge point sets
    start_rectangle = _fit_rectangle_to_points(start_edge_points)
    end_rectangle = _fit_rectangle_to_points(end_edge_points)

    # Get the contour intercepts for both rectangles
    start_extreme = _get_contour_intercept_with_rectangle_axis(
        start_rectangle, start_endpoint, uniform_contour
    )
    end_extreme = _get_contour_intercept_with_rectangle_axis(
        end_rectangle, end_endpoint, uniform_contour
    )

    axis_intersections = [start_extreme, end_extreme]

    # Find centerline by creating edge segments
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
            x_seg, y_seg = _distribute_points(segment[:, 0], segment[:, 1], n_points)
            redistributed_segment = np.column_stack((x_seg, y_seg))

            # Reverse the second segment to match orientation
            if corner_idx == 1:
                redistributed_segment = redistributed_segment[::-1]

            edge_segments.append(redistributed_segment)

    # Find centerline by averaging corresponding points between edge segments
    if len(edge_segments) >= 2:
        segment1, segment2 = edge_segments[0], edge_segments[1]
        centerline = (segment1 + segment2) / 2

        # Clean and redistribute the centerline
        centerline = _validate_and_clean_centerline(centerline, mask, n_points)

        # Ensure points are ordered from left to right
        if centerline[0, 0] > centerline[-1, 0]:
            centerline = centerline[::-1]

        # Visualize if requested
        if plot:
            _visualize_centerline_extraction(
                mask, start_rectangle, end_rectangle, centerline
            )

        return centerline
    else:
        if cv2.contourArea(contour) > 2000:
            print(
                f"Could not extract two edge segments from contour: {len(edge_segments)} found"
            )
        raise ValueError("Could not extract two edge segments from contour")
