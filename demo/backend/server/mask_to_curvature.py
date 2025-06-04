import pandas as pd
import numpy as np
import cv2
from skimage.morphology import skeletonize
from scipy.interpolate import interp1d
from typing import Dict, List, Optional
from numpy.typing import ArrayLike


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


def distribute_points(x, y, n_points):
    distances = np.sqrt(np.diff(x) ** 2 + np.diff(y) ** 2)
    cumulative_dist = np.insert(np.cumsum(distances), 0, 0)
    uniform_dist = np.linspace(0, cumulative_dist[-1], n_points)
    x_interp = interp1d(cumulative_dist, x, kind="linear")
    y_interp = interp1d(cumulative_dist, y, kind="linear")
    x_uniform = x_interp(uniform_dist)
    y_uniform = y_interp(uniform_dist)
    return x_uniform, y_uniform


def get_centerline(contour, start_index, dist=200):
    shifted_contour = np.concatenate((contour[start_index:], contour[:start_index]))
    x, y = shifted_contour[:, 0, 0], shifted_contour[:, 0, 1]
    x_unif, y_unif = distribute_points(x, y, dist)
    stack = np.column_stack((x_unif, y_unif))
    centerline = (stack[: dist // 2] + stack[dist // 2 :][::-1]) / 2
    centerline_intrep = distribute_points(centerline[:, 0], centerline[:, 1], dist // 2)
    return centerline_intrep


def PCA(points, points_to_sort=[]):
    mu = np.mean(points, axis=0)
    Xc = points - mu
    C = np.cov(Xc, rowvar=False)
    eigenvals, eigenvecs = np.linalg.eigh(C)
    v1 = eigenvecs[:, np.argmax(eigenvals)]  # principal axis
    if len(points_to_sort) > 0:
        Xc = points_to_sort - mu
    s = Xc @ v1
    order = np.argsort(s)
    points = points_to_sort if len(points_to_sort) > 0 else points
    return points[order]


def get_principal_axis(points):
    mu = np.mean(points, axis=0)
    Xc = points - mu
    C = np.cov(Xc, rowvar=False)
    eigenvals, eigenvecs = np.linalg.eigh(C)
    v1 = eigenvecs[:, np.argmax(eigenvals)]  # principal axis
    return mu, v1


def find_closest_point(contour, point):
    distances = np.sqrt(np.sum((contour[:, 0, :] - point) ** 2, axis=1))
    return int(np.argmin(distances))


def get_centerline_pca(path, n_points=100):
    # Read the image
    frame = cv2.imread(path, cv2.IMREAD_GRAYSCALE)

    # Apply threshold to get mask
    _, mask = cv2.threshold(frame, 128, 255, cv2.THRESH_BINARY)

    # Get non-zero points
    ys, xs = np.nonzero(mask)
    pts = np.vstack((xs, ys)).T  # shape (n,2)

    # Global PCA
    mu = pts.mean(axis=0)
    Xc = pts - mu
    C = np.cov(Xc, rowvar=False)
    eigvals, eigvecs = np.linalg.eigh(C)
    v1 = eigvecs[:, np.argmax(eigvals)]

    # Project and sort
    s = Xc.dot(v1)
    order = np.argsort(s)
    pts_sorted = Xc[order]

    # Bin into segments
    n = len(pts_sorted)
    centroids = []
    directions = []
    bins = 100
    for j in range(bins):
        seg = pts_sorted[j * n // bins : (j + 1) * n // bins]
        mu_j = seg.mean(axis=0)
        Cj = np.cov(seg, rowvar=False)
        wj, vj = np.linalg.eigh(Cj)
        v1j = vj[:, np.argmax(wj)]
        centroids.append(mu_j)
        directions.append(v1j)

    # Convert centroids to numpy array and store as global variable
    centroids_arr = np.array(centroids) + mu

    x_uniform, y_uniform = distribute_points(
        centroids_arr[:, 0], centroids_arr[:, 1], n_points=n_points
    )
    return [x_uniform.tolist(), y_uniform.tolist()]


def get_centerline_edge_pca(path, edge_percentage=0.3, n_points=100):
    frame = cv2.imread(path, cv2.COLOR_GRAY2BGR)
    _, mask = cv2.threshold(frame, 128, 255, cv2.THRESH_BINARY)

    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    largest_contour = max(contours, key=cv2.contourArea)

    # Distribute points uniformly along largest_contour
    contour_points = largest_contour.reshape(-1, 2)
    x_sorted, y_sorted = contour_points[:, 0], contour_points[:, 1]
    x_uniform, y_uniform = distribute_points(x_sorted, y_sorted, len(largest_contour))
    uniform_contour = np.column_stack((x_uniform, y_uniform))
    sorted_points = PCA(uniform_contour)
    right_point = sorted_points[0]
    left_point = sorted_points[-1]

    # Get first and last edge_percentage of points
    n = int(len(sorted_points) * edge_percentage)
    right_edge_points = sorted_points[:n]
    left_edge_points = sorted_points[-n:]

    # Find where principal axes cross the contours for each edge group
    axis_intersections = []

    for edge_points, main_point in [
        (right_edge_points, right_point),
        (left_edge_points, left_point),
    ]:
        # Apply PCA to edge points to find principal axis
        mu, v1 = get_principal_axis(edge_points)
        # Find all intersections of the principal axis with edge points
        # Use a distance threshold to find points close to the axis
        distances_to_axis = []
        threshold = 5.0  # Adjust this threshold as needed

        for point in edge_points:
            # Calculate distance from point to the principal axis line
            # Distance = ||(point - mu) - ((point - mu) · v1) * v1||
            point_to_mu = point - mu
            projection_length = np.dot(point_to_mu, v1)
            projection = projection_length * v1
            perpendicular = point_to_mu - projection
            distance_to_axis = np.linalg.norm(perpendicular)

            if distance_to_axis <= threshold:
                distances_to_axis.append((point, distance_to_axis))

        # Find the point closest to the first point in edge_points
        if distances_to_axis:
            closest_point = min(
                distances_to_axis, key=lambda x: np.linalg.norm(x[0] - main_point)
            )
            axis_intersections.append(closest_point[0])

    # Redistribute 100 points between the edge points in both directions along the contour
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

        # Redistribute points along this segment
        if len(segment) > 1:
            x_seg, y_seg = distribute_points(segment[:, 0], segment[:, 1], n_points)
            redistributed_segment = np.column_stack((x_seg, y_seg))

            # Reverse the second segment to match orientation
            if corner_idx == 1:
                redistributed_segment = redistributed_segment[::-1]

            edge_segments.append(redistributed_segment)

    # Find centerline by averaging corresponding points between edge segments
    segment1, segment2 = edge_segments
    centerline = (segment1 + segment2) / 2
    return [centerline[:, 0].tolist(), centerline[:, 1].tolist()]


def get_arclength(centerlines, display=False):
    arclengths = []
    for centerline in centerlines:
        x, y = centerline
        dx = np.diff(x)
        dy = np.diff(y)
        arclength = np.sum(np.sqrt(dx**2 + dy**2))
        arclengths.append(arclength)

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
    return angles


def get_centerline_skeletonize(path, n_points=100):
    """
    Extract centerline using skimage skeletonize algorithm.

    Args:
        path: Path to the binary mask image
        n_points: Number of points to return for the centerline

    Returns:
        List containing [x_coords, y_coords] of the centerline points
    """
    # Read image and convert to binary
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return [[], []]

    # Ensure binary image
    _, binary = cv2.threshold(image, 127, 255, cv2.THRESH_BINARY)
    binary_bool = binary > 0

    # Apply skeletonization
    skeleton = skeletonize(binary_bool)

    # Find skeleton points
    skeleton_points = np.where(skeleton)

    if len(skeleton_points[0]) == 0:
        return [[], []]

    # Convert to (x, y) coordinates
    y_coords = skeleton_points[0]
    x_coords = skeleton_points[1]

    # Create ordered path through skeleton points
    # Start from one end and follow the skeleton
    skeleton_coords = np.column_stack((x_coords, y_coords))

    if len(skeleton_coords) < 2:
        return [skeleton_coords[:, 0].tolist(), skeleton_coords[:, 1].tolist()]

    # Order points to create a continuous path
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

    ordered_points = np.array(ordered_points)

    x_uniform, y_uniform = distribute_points(
        ordered_points[:, 0], ordered_points[:, 1], n_points
    )
    return [x_uniform.tolist(), y_uniform.tolist()]


def centerlines_to_df(
    centerlines: Dict[str, List[ArrayLike]], frame_names: Optional[List[str]] = None
) -> Dict[str, pd.DataFrame]:
    d = {object: [] for object in centerlines.keys()}
    for object, object_centerlines in centerlines.items():
        l = []
        if not frame_names:
            frame_names = [i for i in range(len(object_centerlines))]
        for frame, t in zip(frame_names, object_centerlines):
            l.append(
                pd.DataFrame(
                    {
                        "frame": frame,
                        "x": t[0],
                        "y": t[1],
                    }
                )
            )
        d[object] = pd.concat(l).reset_index(drop=True)
    return d
