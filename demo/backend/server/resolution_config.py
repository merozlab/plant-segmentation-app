# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Resolution configuration for SAM2 models.
Maps model sizes to their supported resolutions and resource requirements.
"""

import os
from typing import Dict, List, Tuple, Optional

# Resolution configurations for each model size
# Only configurations used by the 3 presets: Fast (small@1024), Balanced (base_plus@1536), High Quality (large@2048)
RESOLUTION_CONFIGS = {
    "small": {
        "resolutions": [1024],
        "default_resolution": 1024,
        "max_resolution": 1024,
        "memory_multiplier": 3.0,  # With async loading, reduced from aggressive 8.5x
        "description": "Fast processing with good quality"
    },
    "base_plus": {
        "resolutions": [1536],
        "default_resolution": 1536,
        "max_resolution": 1536,
        "memory_multiplier": 3.5,  # With async loading, reduced from 4.0x
        "description": "High quality with good performance"
    },
    "large": {
        "resolutions": [2048],
        "default_resolution": 2048,
        "max_resolution": 2048,
        "memory_multiplier": 5.0,  # With async loading, reduced from 6.0x
        "description": "Highest quality, optimized for RTX 3080/5090"
    }
}

# Base memory requirements per frame (in MB) at 1024x1024 resolution
BASE_MEMORY_REQUIREMENTS = {
    "small": 2.5,
    "base_plus": 4.0,
    "large": 6.0
}

# Approximate GPU memory needed for different resolutions (in MB)
# Legacy constants - kept for reference
# The 85% memory rule in get_max_frames() replaces GPU_MEMORY_BASELINE approach
GPU_MEMORY_BASELINE = 2000  # Base GPU memory overhead

# Preset configurations combining model size and resolution
PRESET_CONFIGS = {
    "fast": {
        "model_size": "small",
        "resolution": 1024,
        "name": "Fast",
        "description": "Quick processing with good quality, great for most videos",
        "technical_detail": "Small model @ 1024px"
    },
    "balanced": {
        "model_size": "base_plus",
        "resolution": 1536,
        "name": "Balanced (Recommended)",
        "description": "High quality with good performance, great for longer videos",
        "technical_detail": "Base Plus model @ 1536px"
    },
    "high_quality": {
        "model_size": "large",
        "resolution": 2048,
        "name": "High Quality",
        "description": "Maximum accuracy and detail preservation, optimized for RTX 3080/5090",
        "technical_detail": "Large model @ 2048px"
    }
}


def get_model_resolutions(model_size: str) -> List[int]:
    """Get supported resolutions for a model size."""
    config = RESOLUTION_CONFIGS.get(model_size, RESOLUTION_CONFIGS["small"])
    return config["resolutions"]


def get_default_resolution(model_size: str) -> int:
    """Get default resolution for a model size."""
    config = RESOLUTION_CONFIGS.get(model_size, RESOLUTION_CONFIGS["small"])
    return config["default_resolution"]


def get_max_resolution(model_size: str) -> int:
    """Get maximum resolution for a model size."""
    config = RESOLUTION_CONFIGS.get(model_size, RESOLUTION_CONFIGS["small"])
    return config["max_resolution"]


def get_memory_per_frame_from_dimensions(width: int, height: int) -> float:
    """
    Calculate memory per frame based on actual video dimensions.
    Matches predictor.py:213 formula: bytes_per_frame = width * height * 3 * 10

    The 10x multiplier accounts for SAM2 overhead (video decoding, preprocessing,
    embeddings, tracking state).

    Args:
        width: Video frame width in pixels
        height: Video frame height in pixels

    Returns:
        Memory required per frame in MB
    """
    bytes_per_frame = width * height * 3 * 10
    return bytes_per_frame / (1024 ** 2)  # Convert to MB


def get_memory_per_frame(model_size: str, resolution: int) -> float:
    """
    Calculate memory requirements per frame for given model size and resolution.

    Uses actual video dimension-based calculation matching predictor.py:
    - Assumes square resolution (width = height = resolution)
    - Formula: (width * height * 3 * 10) / (1024^2) MB per frame

    Args:
        model_size: Model size identifier ("small", "base_plus", "large")
        resolution: Target resolution in pixels (1024, 1536, 2048)

    Returns:
        Memory per frame in MB
    """
    # For presets, resolution is both width and height (square aspect ratio)
    return get_memory_per_frame_from_dimensions(resolution, resolution)


def get_max_frames(model_size: str, resolution: int, available_memory_mb: int = None) -> int:
    """
    Estimate maximum frames that can be processed given available memory.

    Uses 85% of available system memory for video frames, matching predictor.py:222.
    Provides conservative estimate to maintain system stability.

    Args:
        model_size: Model size identifier
        resolution: Target resolution in pixels
        available_memory_mb: Available system RAM in MB (if None, uses psutil)

    Returns:
        Maximum recommended frame count (clamped between 10-1000)
    """
    if available_memory_mb is None:
        import psutil
        available_memory_mb = psutil.virtual_memory().available / (1024 ** 2)

    memory_per_frame = get_memory_per_frame(model_size, resolution)

    # Use 85% of available memory, no baseline subtraction
    max_allowed_mb = available_memory_mb * 0.85

    if max_allowed_mb <= 0:
        return 10  # Minimum viable frame count

    max_frames = int(max_allowed_mb / memory_per_frame)
    return max(10, min(max_frames, 1000))  # Clamp between 10 and 1000


def get_config_path(model_size: str, resolution: int) -> str:
    """Get the config file path for a given model size and resolution."""
    # Map model size and resolution to config files for the 3 presets
    config_map = {
        ("small", 1024): "configs/sam2.1/sam2.1_hiera_s.yaml",
        ("base_plus", 1536): "configs/sam2.1/sam2.1_hiera_b+_1536.yaml",
        ("large", 2048): "configs/sam2.1/sam2.1_hiera_l_2048.yaml",
    }

    config_path = config_map.get((model_size, resolution))
    if config_path:
        return config_path

    # Fallback (should not happen with preset system)
    return "configs/sam2.1/sam2.1_hiera_l_2048.yaml"


def get_checkpoint_path(model_size: str) -> str:
    """Get checkpoint file path for a model size."""
    checkpoint_map = {
        "small": "sam2.1_hiera_small.pt",
        "base_plus": "sam2.1_hiera_base_plus.pt",
        "large": "sam2.1_hiera_large.pt"
    }

    return checkpoint_map.get(model_size, "sam2.1_hiera_large.pt")


def validate_resolution(model_size: str, resolution: int) -> bool:
    """Validate that a resolution is supported for a model size."""
    supported_resolutions = get_model_resolutions(model_size)
    return resolution in supported_resolutions


def get_model_info(model_size: str) -> Dict:
    """Get comprehensive information about a model size."""
    config = RESOLUTION_CONFIGS.get(model_size, RESOLUTION_CONFIGS["small"])
    
    return {
        "model_size": model_size,
        "resolutions": config["resolutions"],
        "default_resolution": config["default_resolution"],
        "max_resolution": config["max_resolution"],
        "description": config["description"],
        "memory_multiplier": config["memory_multiplier"],
        "checkpoint": get_checkpoint_path(model_size)
    }


def get_all_model_info() -> Dict[str, Dict]:
    """Get information about all available models."""
    return {
        model_size: get_model_info(model_size)
        for model_size in RESOLUTION_CONFIGS.keys()
    }


def get_resolution_from_env() -> Optional[int]:
    """Get resolution from environment variable if set."""
    resolution_str = os.getenv("SAM2_RESOLUTION")
    if resolution_str:
        try:
            return int(resolution_str)
        except ValueError:
            pass
    return None


def get_optimal_resolution(model_size: str, available_memory_mb: int = 10000) -> int:
    """Get optimal resolution based on model size and available memory."""
    supported_resolutions = get_model_resolutions(model_size)

    # Try resolutions from highest to lowest
    for resolution in sorted(supported_resolutions, reverse=True):
        estimated_frames = get_max_frames(model_size, resolution, available_memory_mb)
        # If we can process at least 50 frames, this resolution is viable
        if estimated_frames >= 50:
            return resolution

    # Fall back to minimum resolution
    return min(supported_resolutions)


def get_preset_config(preset_name: str) -> Optional[Dict]:
    """Get configuration for a preset."""
    return PRESET_CONFIGS.get(preset_name, PRESET_CONFIGS["balanced"])


def get_all_presets() -> Dict[str, Dict]:
    """Get all available preset configurations."""
    return PRESET_CONFIGS