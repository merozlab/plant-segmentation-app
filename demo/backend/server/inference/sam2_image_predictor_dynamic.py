# Copyright (c) Meta Platforms, Inc. and affiliates.
# All rights reserved.
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Enhanced SAM2ImagePredictor with dynamic feature size calculation for variable resolutions.
"""

import logging
from typing import List, Optional, Tuple, Union

import numpy as np
import torch
from PIL.Image import Image

from sam2.modeling.sam2_base import SAM2Base
from sam2.utils.transforms import SAM2Transforms
from sam2.sam2_image_predictor import SAM2ImagePredictor


class SAM2ImagePredictorDynamic(SAM2ImagePredictor):
    """
    Enhanced SAM2ImagePredictor that automatically calculates feature sizes 
    based on the model's image size configuration.
    """
    
    def __init__(
        self,
        sam_model: SAM2Base,
        mask_threshold=0.0,
        max_hole_area=0.0,
        max_sprinkle_area=0.0,
        **kwargs,
    ) -> None:
        """
        Initialize the dynamic predictor.
        
        Arguments:
          sam_model (SAM2Base): The model to use for mask prediction.
          mask_threshold (float): The threshold to use when converting mask logits
            to binary masks. Masks are thresholded at 0 by default.
          max_hole_area (int): If max_hole_area > 0, we fill small holes in up to
            the maximum area of max_hole_area in low_res_masks.
          max_sprinkle_area (int): If max_sprinkle_area > 0, we remove small sprinkles up to
            the maximum area of max_sprinkle_area in low_res_masks.
        """
        super().__init__(
            sam_model=sam_model,
            mask_threshold=mask_threshold,
            max_hole_area=max_hole_area,
            max_sprinkle_area=max_sprinkle_area,
            **kwargs
        )
        
        # Calculate dynamic feature sizes based on image size
        self._bb_feat_sizes = self._calculate_dynamic_feature_sizes()
        
        logging.info(f"Dynamic SAM2ImagePredictor initialized with image_size={self.model.image_size}")
        logging.info(f"Calculated feature sizes: {self._bb_feat_sizes}")
    
    def _calculate_dynamic_feature_sizes(self) -> List[Tuple[int, int]]:
        """
        Calculate feature sizes based on the model's image size.
        
        Based on the GitHub issue discussion, feature sizes should be calculated as:
        hires_size = image_size // 4
        feature_sizes = [[hires_size // (2**k)]*2 for k in range(3)]
        
        Returns:
            List of tuples representing (height, width) for each feature level.
        """
        image_size = self.model.image_size
        
        # Calculate high-resolution feature size (image_size / 4)
        hires_size = image_size // 4
        
        # Calculate feature sizes for 3 levels (divide by 2^k for k=0,1,2)
        feature_sizes = []
        for k in range(3):
            size = hires_size // (2**k)
            feature_sizes.append((size, size))
        
        return feature_sizes
    
    def get_model_info(self) -> dict:
        """
        Get information about the current model configuration.
        
        Returns:
            Dict containing model information including image size and feature sizes.
        """
        return {
            "image_size": self.model.image_size,
            "feature_sizes": self._bb_feat_sizes,
            "mask_threshold": self.mask_threshold,
            "model_type": type(self.model).__name__
        }
    
    def validate_image_size(self, image: Union[np.ndarray, Image]) -> bool:
        """
        Validate that the input image can be processed by the current model.
        
        Arguments:
            image: Input image to validate
            
        Returns:
            True if image can be processed, False otherwise
        """
        if isinstance(image, Image):
            width, height = image.size
        elif isinstance(image, np.ndarray):
            if len(image.shape) == 3:
                height, width = image.shape[:2]
            else:
                return False
        else:
            return False
        
        # Check if image is not too small relative to model size
        min_size = self.model.image_size // 8  # Allow down to 1/8th of model size
        if width < min_size or height < min_size:
            logging.warning(f"Image size {width}x{height} is too small for model size {self.model.image_size}")
            return False
        
        return True
    
    @torch.no_grad()
    def set_image(
        self,
        image: Union[np.ndarray, Image],
    ) -> None:
        """
        Calculates the image embeddings for the provided image, allowing
        masks to be predicted with the 'predict' method.
        
        Enhanced to validate image size compatibility.
        
        Arguments:
          image (np.ndarray or PIL Image): The input image to embed in RGB format.
        """
        if not self.validate_image_size(image):
            raise ValueError(f"Image size is not compatible with model image size {self.model.image_size}")
        
        # Call parent method
        super().set_image(image)
        
        logging.debug(f"Image set successfully for model with image_size={self.model.image_size}")


def create_sam2_image_predictor(
    sam_model: SAM2Base,
    use_dynamic_features: bool = True,
    **kwargs
) -> Union[SAM2ImagePredictor, SAM2ImagePredictorDynamic]:
    """
    Factory function to create the appropriate SAM2ImagePredictor.
    
    Arguments:
        sam_model: The SAM2 model instance
        use_dynamic_features: Whether to use dynamic feature size calculation
        **kwargs: Additional arguments passed to the predictor
        
    Returns:
        SAM2ImagePredictor instance (dynamic or standard)
    """
    if use_dynamic_features:
        return SAM2ImagePredictorDynamic(sam_model, **kwargs)
    else:
        return SAM2ImagePredictor(sam_model, **kwargs)