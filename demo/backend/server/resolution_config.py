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
RESOLUTION_CONFIGS = {
    "tiny": {
        "resolutions": [512, 1024],
        "default_resolution": 512,
        "max_resolution": 1024,
        "memory_multiplier": 1.0,  # Base memory usage
        "description": "Fastest processing, good for basic tasks"
    },
    "small": {
        "resolutions": [512, 1024],
        "default_resolution": 1024,
        "max_resolution": 1024,
        "memory_multiplier": 1.5,
        "description": "Balanced performance, recommended for most tasks"
    },
    "base_plus": {
        "resolutions": [1024, 1536],
        "default_resolution": 1024,
        "max_resolution": 1536,
        "memory_multiplier": 2.5,
        "description": "Higher quality, good for detailed work"
    },
    "large": {
        "resolutions": [1024, 1536, 2048],
        "default_resolution": 1024,
        "max_resolution": 2048,
        "memory_multiplier": 4.0,
        "description": "Highest quality, best for precision tasks"
    }
}

# Base memory requirements per frame (in MB) at 1024x1024 resolution
BASE_MEMORY_REQUIREMENTS = {
    "tiny": 1.5,
    "small": 2.5,
    "base_plus": 4.0,
    "large": 6.0
}

# Approximate GPU memory needed for different resolutions (in MB)
GPU_MEMORY_BASELINE = 2000  # Base GPU memory overhead

# Preset configurations combining model size and resolution
PRESET_CONFIGS = {
    "fast": {
        "model_size": "small",
        "resolution": 512,
        "name": "Fast",
        "description": "Quick processing, best for previews and long videos",
        "technical_detail": "Small model @ 512px"
    },
    "balanced": {
        "model_size": "base_plus",
        "resolution": 1536,
        "name": "Balanced",
        "description": "High quality with good performance, great for longer videos",
        "technical_detail": "Base Plus model @ 1536px"
    },
    "high_quality": {
        "model_size": "large",
        "resolution": 2048,
        "name": "High Quality (Recommended)",
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


def get_memory_per_frame(model_size: str, resolution: int) -> float:
    """Calculate memory requirements per frame for given model size and resolution."""
    base_memory = BASE_MEMORY_REQUIREMENTS.get(model_size, 2.5)
    config = RESOLUTION_CONFIGS.get(model_size, RESOLUTION_CONFIGS["small"])
    
    # Scale memory based on resolution (quadratic scaling)
    resolution_scale = (resolution / 1024) ** 2
    
    return base_memory * resolution_scale * config["memory_multiplier"]


def get_max_frames(model_size: str, resolution: int, available_memory_mb: int = 10000) -> int:
    """Estimate maximum frames that can be processed given memory constraints."""
    memory_per_frame = get_memory_per_frame(model_size, resolution)
    available_for_frames = available_memory_mb - GPU_MEMORY_BASELINE
    
    if available_for_frames <= 0:
        return 10  # Minimum viable frame count
    
    max_frames = int(available_for_frames / memory_per_frame)
    return max(10, min(max_frames, 1000))  # Clamp between 10 and 1000


def get_config_path(model_size: str, resolution: int) -> str:
    """Get the config file path for a given model size and resolution."""
    # Map model size to config file prefix
    config_prefixes = {
        "tiny": "sam2.1_hiera_t",
        "small": "sam2.1_hiera_s",
        "base_plus": "sam2.1_hiera_b+",
        "large": "sam2.1_hiera_l"
    }

    prefix = config_prefixes.get(model_size, "sam2.1_hiera_s")

    # Special case for small @ 512
    if model_size == "small" and resolution == 512:
        return f"configs/sam2.1/{prefix}_512.yaml"
    # For non-standard resolutions, use resolution-specific config
    elif resolution != 1024:
        return f"configs/sam2.1/{prefix}_{resolution}.yaml"
    else:
        return f"configs/sam2.1/{prefix}.yaml"


def get_checkpoint_path(model_size: str) -> str:
    """Get checkpoint file path for a model size."""
    checkpoint_map = {
        "tiny": "sam2.1_hiera_tiny.pt",
        "small": "sam2.1_hiera_small.pt",
        "base_plus": "sam2.1_hiera_base_plus.pt", 
        "large": "sam2.1_hiera_large.pt"
    }
    
    return checkpoint_map.get(model_size, "sam2.1_hiera_small.pt")


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