/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { uploadConfirmationModalAtom, sessionAtom, uploadingStateAtom, frameIndexAtom, uploadedVideoDataAtom, currentResolutionAtom } from '@/demo/atoms';
import { spacing } from '@/theme/tokens.stylex';
import { Close, ReflectHorizontal, ReflectVertical } from '@carbon/icons-react';
import stylex from '@stylexjs/stylex';
import { useAtom, useSetAtom } from 'jotai';
import { Modal, Button } from 'react-daisyui';
import { useNavigate } from 'react-router-dom';
import { useRef, useEffect, useState, useCallback } from 'react';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import PrimaryCTAButton from '@/common/components/button/PrimaryCTAButton';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import 'react-image-crop/dist/ReactCrop.css';
// Function to convert dimensions to even numbers and validate
const makeEvenDimensions = (croppedAreaPixels: any, videoData?: any) => {
  if (!croppedAreaPixels) return croppedAreaPixels;

  // Start with even dimension conversion
  let evenDims = {
    ...croppedAreaPixels,
    width: Math.max(2, Math.round(croppedAreaPixels.width / 2) * 2),
    height: Math.max(2, Math.round(croppedAreaPixels.height / 2) * 2),
    x: Math.round(croppedAreaPixels.x / 2) * 2,
    y: Math.round(croppedAreaPixels.y / 2) * 2
  };

  // Apply boundary clamping if video data is available
  if (videoData) {
    // Ensure crop doesn't exceed video boundaries
    evenDims.x = Math.max(0, Math.min(evenDims.x, videoData.width - 2));
    evenDims.y = Math.max(0, Math.min(evenDims.y, videoData.height - 2));
    
    // Adjust dimensions to fit within video boundaries
    evenDims.width = Math.min(evenDims.width, videoData.width - evenDims.x);
    evenDims.height = Math.min(evenDims.height, videoData.height - evenDims.y);
    
    // Ensure dimensions are still even after clamping
    evenDims.width = Math.max(2, Math.round(evenDims.width / 2) * 2);
    evenDims.height = Math.max(2, Math.round(evenDims.height / 2) * 2);
    
    // Final validation that crop is within bounds
    if (evenDims.x + evenDims.width > videoData.width) {
      evenDims.width = videoData.width - evenDims.x;
      evenDims.width = Math.max(2, Math.round(evenDims.width / 2) * 2);
    }
    
    if (evenDims.y + evenDims.height > videoData.height) {
      evenDims.height = videoData.height - evenDims.y;
      evenDims.height = Math.max(2, Math.round(evenDims.height / 2) * 2);
    }
  }

  // Validate dimensions are positive
  if (evenDims.width <= 0 || evenDims.height <= 0) {
    throw new Error('Invalid crop dimensions: width and height must be positive');
  }

  return evenDims;
};

// Function to crop video using backend API
const cropVideoOnBackend = async (videoPath: string, cropSettings: any, videoData?: any): Promise<string> => {
  const { croppedAreaPixels, flipHorizontal, flipVertical } = cropSettings;

  if (!croppedAreaPixels) {
    throw new Error('No crop area specified');
  }

  const evenCroppedArea = makeEvenDimensions(croppedAreaPixels, videoData);

  const requestBody = {
    video_path: videoPath,
    crop_x: evenCroppedArea.x,
    crop_y: evenCroppedArea.y,
    crop_width: evenCroppedArea.width,
    crop_height: evenCroppedArea.height,
    flip_horizontal: flipHorizontal || false,
    flip_vertical: flipVertical || false
  };

  const response = await fetch('http://localhost:7264/crop_video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    // Try to extract detailed error message from response
    let errorMessage = `Backend crop failed: ${response.status} ${response.statusText}`;
    try {
      const errorText = await response.text();
      if (errorText && errorText.length > 0) {
        errorMessage = errorText;
      }
    } catch (e) {
      // If we can't parse the error response, use the default message
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();

  if (result.status === 'success') {
    return result.output_path; // Should return path like "/uploads/cropped_video_123.mp4"
  } else {
    throw new Error(result.message || 'Backend crop failed');
  }
};

// Function to process video with crop and flip data using backend
const processVideoWithCrop = async (videoData: any, cropSettings: any) => {

  try {
    // Convert crop dimensions to even numbers and validate
    const evenCroppedAreaPixels = makeEvenDimensions(cropSettings.croppedAreaPixels, videoData);

    // If no changes were made (default crop, no flip), return original video
    if (!evenCroppedAreaPixels &&
      !cropSettings.flipHorizontal &&
      !cropSettings.flipVertical &&
      cropSettings.crop.x === 0 &&
      cropSettings.crop.y === 0 &&
      cropSettings.crop.width === 100 &&
      cropSettings.crop.height === 100) {
      return videoData;
    }

    // Actually crop the video if crop area is specified
    if (evenCroppedAreaPixels) {
      const croppedVideoPath = await cropVideoOnBackend(videoData.path, {
        croppedAreaPixels: evenCroppedAreaPixels,
        flipHorizontal: cropSettings.flipHorizontal,
        flipVertical: cropSettings.flipVertical
      }, videoData);

      // Return new video data with cropped path
      return {
        ...videoData,
        path: croppedVideoPath,
        url: `http://localhost:7263${croppedVideoPath}`, // Update URL for frontend display
        isCropped: true,
      };
    }

    // Fallback: return original video data
    return videoData;
  } catch (error) {
    console.error('Error processing video with crop:', error);
    // Re-throw the error so it can be caught by handleContinue
    throw error;
  }
};

const styles = stylex.create({
  container: {
    position: 'relative',
    color: '#fff',
    boxShadow: '0 0 100px 50px #000',
    borderRadius: 16,
    border: '2px solid transparent',
    background:
      'linear-gradient(#1A1C1F, #1A1C1F) padding-box, linear-gradient(to right bottom, #FB73A5,#595FEF,#94EAE2,#FCCB6B) border-box',
    maxWidth: '60vw',
    maxHeight: '90vh',
    overflow: 'hidden',
  },
  closeButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: spacing[3],
    zIndex: 10,
    cursor: 'pointer',
    ':hover': {
      opacity: 0.7,
    },
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  title: {
    fontSize: '1rem',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cropperContainer: {
    marginBottom: spacing[4],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    position: 'relative',
  },
  cropIndicator: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: spacing[2],
    borderRadius: 4,
    fontSize: '0.875rem',
    fontWeight: 'bold',
    zIndex: 20,
  },
});


type Props = {};

export default function DemoVideoGallery({ }: Props) {
  const modalRef = useRef<HTMLDialogElement | null>(null);
  const [isOpen, setIsOpen] = useAtom(uploadConfirmationModalAtom);
  const [videoData, setVideoData] = useAtom(uploadedVideoDataAtom);
  const navigate = useNavigate();
  const setFrameIndex = useSetAtom(frameIndexAtom);
  const setUploadingState = useSetAtom(uploadingStateAtom);
  const setSession = useSetAtom(sessionAtom);

  // Cropping state
  const [crop, setCrop] = useState<Crop>({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);
  const [isReuploading, setIsReuploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Resolution state
  const [currentResolution, setCurrentResolution] = useAtom(currentResolutionAtom);

  // Fetch current resolution from backend when component mounts and when modal opens
  useEffect(() => {
    const fetchCurrentResolution = async () => {
      try {
        const response = await fetch(`${VIDEO_API_ENDPOINT}/current_resolution`);
        if (response.ok) {
          const data = await response.json();
          setCurrentResolution(data.resolution);
        }
      } catch (error) {
        console.error('Failed to fetch current resolution:', error);
      }
    };

    // Fetch on mount and when modal opens
    if (isOpen) {
      fetchCurrentResolution();
    }
  }, [setCurrentResolution, isOpen]);


  const onCropComplete = useCallback((crop: PixelCrop, percentCrop: Crop) => {

    // Calculate crop coordinates relative to original video dimensions
    // The crop coordinates should be based on the actual pixel coordinates from react-image-crop
    if (videoData) {
      // Use the pixel crop directly - it's already calculated relative to the current display
      // We need to scale it to match the original video dimensions
      const videoElement = document.querySelector('video');
      if (videoElement) {
        const displayWidth = videoElement.clientWidth;
        const displayHeight = videoElement.clientHeight;

        // Calculate scale factors from displayed size to original video size
        const scaleX = videoData.width / displayWidth;
        const scaleY = videoData.height / displayHeight;

        // Calculate scaled crop with proper boundary clamping
        let scaledX = Math.floor(crop.x * scaleX);
        let scaledY = Math.floor(crop.y * scaleY);
        let scaledWidth = Math.round(crop.width * scaleX);
        let scaledHeight = Math.round(crop.height * scaleY);
        
        // Ensure crop coordinates don't exceed video boundaries
        // Clamp position to valid range
        scaledX = Math.max(0, Math.min(scaledX, videoData.width - 1));
        scaledY = Math.max(0, Math.min(scaledY, videoData.height - 1));
        
        // Clamp dimensions to fit within video boundaries from current position
        scaledWidth = Math.min(scaledWidth, videoData.width - scaledX);
        scaledHeight = Math.min(scaledHeight, videoData.height - scaledY);
        
        // Ensure minimum dimensions
        scaledWidth = Math.max(2, scaledWidth);
        scaledHeight = Math.max(2, scaledHeight);

        const scaledCrop = {
          x: scaledX,
          y: scaledY,
          width: scaledWidth,
          height: scaledHeight,
          unit: 'px' as const
        };

        setCompletedCrop(scaledCrop);
      } else {
        // Fallback to percentage-based calculation with boundary clamping
        let fallbackX = Math.floor((percentCrop.x / 100) * videoData.width);
        let fallbackY = Math.floor((percentCrop.y / 100) * videoData.height);
        let fallbackWidth = Math.round((percentCrop.width / 100) * videoData.width);
        let fallbackHeight = Math.round((percentCrop.height / 100) * videoData.height);
        
        // Apply boundary clamping for fallback calculation
        fallbackX = Math.max(0, Math.min(fallbackX, videoData.width - 1));
        fallbackY = Math.max(0, Math.min(fallbackY, videoData.height - 1));
        fallbackWidth = Math.min(fallbackWidth, videoData.width - fallbackX);
        fallbackHeight = Math.min(fallbackHeight, videoData.height - fallbackY);
        fallbackWidth = Math.max(2, fallbackWidth);
        fallbackHeight = Math.max(2, fallbackHeight);
        
        const fallbackCrop = {
          x: fallbackX,
          y: fallbackY,
          width: fallbackWidth,
          height: fallbackHeight,
          unit: 'px' as const
        };
        setCompletedCrop(fallbackCrop);
      }
    } else {
      setCompletedCrop(crop);
    }
  }, [videoData]);

  // Calculate if crop will be resized and determine indicator color
  const getCropIndicatorInfo = useCallback(() => {
    let width, height;

    if (!completedCrop && videoData) {
      // If no crop is set, use full video dimensions
      width = videoData.width;
      height = videoData.height;
    } else if (completedCrop) {
      // Use the completed crop dimensions (these are already in original video coordinates)
      width = completedCrop.width;
      height = completedCrop.height;
    } else {
      return { width: 0, height: 0, willResize: false, color: '#fff', resizedWidth: 0, resizedHeight: 0 };
    }

    const willResize = width > currentResolution || height > currentResolution;
    const color = willResize ? '#ff4444' : '#44ff44';

    // Calculate resized dimensions using aspect ratio preserving resize to fit within current resolution
    let resizedWidth = width;
    let resizedHeight = height;

    if (willResize) {
      // Calculate scale factor to fit within current resolution while preserving aspect ratio
      const scaleX = currentResolution / width;
      const scaleY = currentResolution / height;
      const scale = Math.min(scaleX, scaleY); // Use the smaller scale to ensure it fits

      resizedWidth = Math.round(width * scale);
      resizedHeight = Math.round(height * scale);
    }

    return { width, height, willResize, color, resizedWidth, resizedHeight };
  }, [completedCrop, videoData, currentResolution]);

  const cropInfo = getCropIndicatorInfo();

  useEffect(() => {
    const modal = modalRef.current;
    if (modal) {
      if (isOpen) {
        modal.style.display = 'grid';
        modal.showModal();
      } else {
        modal.close();
        modal.style.display = 'none';
      }
    }
  }, [isOpen]);

  // Reset crop settings when modal opens
  useEffect(() => {
    if (isOpen) {
      setCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
      setCompletedCrop(null);
      setFlipHorizontal(false);
      setFlipVertical(false);
      setIsReuploading(false);
      setErrorMessage(null); // Clear any previous error messages
    }
  }, [isOpen]);

  // Reopen modal when new video data is available during reupload
  useEffect(() => {
    if (videoData && isReuploading) {
      // Reopen the modal with the new video
      setIsOpen(true);
      setIsReuploading(false);
      setUploadingState('default');
    }
  }, [videoData, isReuploading, setUploadingState]);

  const handleClose = () => {
    setIsOpen(false);
    // Reset uploading state when modal is closed
    setUploadingState('default');
  };

  const handleReupload = () => {
    // Set reuploading state first
    setIsReuploading(true);
    setUploadingState('uploading');

    // Trigger file input click to open file chooser
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
      
      // Close modal after a short delay to allow file chooser to open
      setTimeout(() => {
        setIsOpen(false);
      }, 100);
    }
  };

  // Function to handle horizontal flip without adjusting crop
  const handleFlipHorizontal = useCallback(() => {
    setFlipHorizontal(!flipHorizontal);
  }, [flipHorizontal]);

  // Function to handle vertical flip without adjusting crop
  const handleFlipVertical = useCallback(() => {
    setFlipVertical(!flipVertical);
  }, [flipVertical]);

  const handleContinue = async () => {
    setErrorMessage(null); // Clear any previous errors
    
    if (videoData) {
      setUploadingState('uploading');

      try {
        // Process the video with crop and flip data
        const processedVideoData = await processVideoWithCrop(videoData, {
          crop,
          flipHorizontal,
          flipVertical,
          croppedAreaPixels: completedCrop
        });

        // Close modal and navigate on success
        setIsOpen(false);
        navigate(
          { pathname: location.pathname, search: location.search },
          { state: { video: processedVideoData } },
        );
        setFrameIndex(0);
        setUploadingState('default');
        setSession(null);
        setVideoData(null);
      } catch (error) {
        console.error('Error processing video:', error);
        setUploadingState('default');
        
        // Show error message in modal instead of closing it
        if (error instanceof Error) {
          setErrorMessage(error.message);
          console.error('Detailed crop error:', error.message);
        } else {
          setErrorMessage('An unknown error occurred during video processing');
        }
      }
    }
  };

  const videoTransform = `scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`;

  return (
    <>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <Modal ref={modalRef} {...stylex.props(styles.container)}>
      <div onClick={handleClose} {...stylex.props(styles.closeButton)}>
        <Close size={28} />
      </div>
      <Modal.Body style={{ height: '100%' }}>
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.header)}>
            <div {...stylex.props(styles.title)}>
              Crop and adjust your video
            </div>
          </div>

          {/* Error message display */}
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg relative">
              <button
                onClick={() => setErrorMessage(null)}
                className="absolute top-2 right-2 text-red-300 hover:text-red-100 text-xs"
              >
                ✕
              </button>
              <div className="text-red-300 text-sm font-medium">
                ❌ Error processing video
              </div>
              <div className="text-red-200 text-xs mt-1 pr-6">
                {errorMessage}
              </div>
            </div>
          )}

          {videoData && (
            <div {...stylex.props(styles.cropperContainer)}>
              <ReactCrop
                crop={crop}
                onChange={(newCrop) => setCrop(newCrop)}
                onComplete={(c, percentCrop) => onCropComplete(c, percentCrop)}
              >
                <video
                  src={videoData.url}
                  style={{
                    transform: videoTransform,
                    maxWidth: '80vw',
                    maxHeight: '60vh',
                    objectFit: 'contain',
                    display: 'block'
                  }}
                  controls={false}
                  muted
                  autoPlay
                  loop
                />
              </ReactCrop>

              {/* Crop size indicator */}
              <div {...stylex.props(styles.cropIndicator)} style={{ color: cropInfo.color }}>
                <div>{cropInfo.width}×{cropInfo.height}px</div>
                {cropInfo.willResize && (
                  <div style={{ fontSize: '0.75rem', marginTop: '2px', opacity: 0.9 }}>
                    Will be resized to {cropInfo.resizedWidth}×{cropInfo.resizedHeight}px
                  </div>
                )}
              </div>

            </div>
          )}

          <div className="flex w-full gap-4 justify-between">
            <div className="flex gap-4">
              <Button
                onClick={handleFlipHorizontal}
                startIcon={<ReflectHorizontal size={20} />}
                color="ghost"
                className="!px-4 !rounded-full font-medium text-white hover:bg-black"
              >
                Reflect Horizontal
              </Button>
              <Button
                onClick={handleFlipVertical}
                startIcon={<ReflectVertical size={20} />}
                color="ghost"
                className="!px-4 !rounded-full font-medium text-white hover:bg-black"
              >
                Reflect Vertical
              </Button>
            </div>
            <div className="flex gap-4">
              <Button
                onClick={handleReupload}
                color="ghost"
                className="!px-4 !rounded-full font-medium text-white hover:bg-black"
              >
                Choose different video
              </Button>
              <PrimaryCTAButton onClick={handleContinue}>
                Continue
              </PrimaryCTAButton>
            </div>
          </div>
        </div>
      </Modal.Body>
    </Modal>
    </>
  );
}