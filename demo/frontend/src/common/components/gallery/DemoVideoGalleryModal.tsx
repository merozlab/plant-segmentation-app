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
import {uploadConfirmationModalAtom, sessionAtom, uploadingStateAtom, frameIndexAtom, uploadedVideoDataAtom, selectedResolutionAtom} from '@/demo/atoms';
import {spacing} from '@/theme/tokens.stylex';
import {Close, Rotate, RotateClockwise} from '@carbon/icons-react';
import stylex from '@stylexjs/stylex';
import {useAtom, useSetAtom} from 'jotai';
import {Modal} from 'react-daisyui';
import {useNavigate} from 'react-router-dom';
import {useRef, useEffect, useState, useCallback} from 'react';
import ReactCrop, { Crop, PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
// Function to convert dimensions to even numbers
const makeEvenDimensions = (croppedAreaPixels: any) => {
  if (!croppedAreaPixels) return croppedAreaPixels;
  
  return {
    ...croppedAreaPixels,
    width: Math.round(croppedAreaPixels.width / 2) * 2,
    height: Math.round(croppedAreaPixels.height / 2) * 2,
    x: Math.round(croppedAreaPixels.x / 2) * 2,
    y: Math.round(croppedAreaPixels.y / 2) * 2
  };
};


// Function to crop video using backend API
const cropVideoOnBackend = async (videoPath: string, cropSettings: any): Promise<string> => {
  const { croppedAreaPixels, flipHorizontal, flipVertical } = cropSettings;
  
  if (!croppedAreaPixels) {
    throw new Error('No crop area specified');
  }
  
  const evenCroppedArea = makeEvenDimensions(croppedAreaPixels);
  
  const requestBody = {
    video_path: videoPath,
    crop_x: evenCroppedArea.x,
    crop_y: evenCroppedArea.y,
    crop_width: evenCroppedArea.width,
    crop_height: evenCroppedArea.height,
    flip_horizontal: flipHorizontal || false,
    flip_vertical: flipVertical || false
  };
  
  console.log('Sending crop request to backend:', requestBody);
  
  const response = await fetch('http://localhost:7264/crop_video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    throw new Error(`Backend crop failed: ${response.status} ${response.statusText}`);
  }
  
  const result = await response.json();
  
  if (result.status === 'success') {
    console.log('Video cropped successfully:', result.output_path);
    return result.output_path; // Should return path like "/uploads/cropped_video_123.mp4"
  } else {
    throw new Error(result.message || 'Backend crop failed');
  }
};

// Function to process video with crop and flip data using backend
const processVideoWithCrop = async (videoData: any, cropSettings: any) => {
  console.log('Processing video with crop settings:', cropSettings);
  
  // Convert crop dimensions to even numbers
  const evenCroppedAreaPixels = makeEvenDimensions(cropSettings.croppedAreaPixels);
  console.log('Original crop dimensions:', cropSettings.croppedAreaPixels);
  console.log('Even crop dimensions:', evenCroppedAreaPixels);
  
  // If no changes were made (default crop, no flip), return original video
  if (!evenCroppedAreaPixels && 
      !cropSettings.flipHorizontal && 
      !cropSettings.flipVertical && 
      cropSettings.crop.x === 0 && 
      cropSettings.crop.y === 0 && 
      cropSettings.crop.width === 100 && 
      cropSettings.crop.height === 100 && 
      cropSettings.zoom === 1) {
    console.log('No changes made, returning original video');
    return videoData;
  }
  
  // Actually crop the video if crop area is specified
  if (evenCroppedAreaPixels) {
    try {
      console.log('Cropping video using backend...');
      const croppedVideoPath = await cropVideoOnBackend(videoData.path, {
        croppedAreaPixels: evenCroppedAreaPixels,
        flipHorizontal: cropSettings.flipHorizontal,
        flipVertical: cropSettings.flipVertical,
        zoom: cropSettings.zoom
      });
      
      // Return new video data with cropped path
      return {
        ...videoData,
        path: croppedVideoPath,
        url: `http://localhost:7263${croppedVideoPath}`, // Update URL for frontend display
        isCropped: true,
      };
    } catch (error) {
      console.error('Error cropping video:', error);
      // Fall back to original video with metadata if cropping fails
    }
  }
  
  // Fallback: return original video data
  return videoData;
};

const styles = stylex.create({
  container: {
    position: 'relative',
    minWidth: '85vw',
    minHeight: '85vh',
    overflow: 'hidden',
    color: '#fff',
    boxShadow: '0 0 100px 50px #000',
    borderRadius: 16,
    border: '2px solid transparent',
    background:
      'linear-gradient(#1A1C1F, #1A1C1F) padding-box, linear-gradient(to right bottom, #FB73A5,#595FEF,#94EAE2,#FCCB6B) border-box',
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
    height: '100%',
    padding: spacing[4],
  },
  header: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cropperContainer: {
    position: 'relative',
    height: '60vh',
    backgroundColor: '#000',
    marginBottom: spacing[4],
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  flipButton: {
    padding: spacing[2],
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: spacing[2],
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
  },
  buttonContainer: {
    display: 'flex',
    gap: spacing[4],
    justifyContent: 'center',
  },
  button: {
    padding: `${spacing[3]} ${spacing[6]}`,
    borderRadius: 8,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    border: 'none',
    minWidth: '120px',
  },
  reuploadButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
  },
  continueButton: {
    backgroundColor: '#0064E0',
    color: '#fff',
    ':hover': {
      backgroundColor: '#0056cc',
    },
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

export default function DemoVideoGalleryModal({}: Props) {
  const modalRef = useRef<HTMLDialogElement | null>(null);
  const [isOpen, setIsOpen] = useAtom(uploadConfirmationModalAtom);
  const [videoData, setVideoData] = useAtom(uploadedVideoDataAtom);
  const [selectedResolution] = useAtom(selectedResolutionAtom);
  const navigate = useNavigate();
  const setFrameIndex = useSetAtom(frameIndexAtom);
  const setUploadingState = useSetAtom(uploadingStateAtom);
  const setSession = useSetAtom(sessionAtom);
  
  
  // Cropping state
  const [crop, setCrop] = useState<Crop>({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [zoom, setZoom] = useState(1);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);

  console.log('DemoVideoGalleryModal render - isOpen:', isOpen, 'videoData:', videoData);
  console.log('DEBUG DemoVideoGalleryModal render - selectedResolution:', selectedResolution);

  const onCropComplete = useCallback((crop: PixelCrop, percentCrop: Crop) => {
    console.log('DemoVideoGalleryModal - crop completed:', crop);
    console.log('DemoVideoGalleryModal - percent crop:', percentCrop);
    
    // Calculate crop coordinates relative to original video dimensions
    if (videoData) {
      const scaledCrop = {
        x: Math.round((percentCrop.x / 100) * videoData.width),
        y: Math.round((percentCrop.y / 100) * videoData.height),
        width: Math.round((percentCrop.width / 100) * videoData.width),
        height: Math.round((percentCrop.height / 100) * videoData.height),
        unit: 'px' as const
      };
      console.log('DemoVideoGalleryModal - scaled crop for original video:', scaledCrop);
      setCompletedCrop(scaledCrop);
    } else {
      setCompletedCrop(crop);
    }
  }, [videoData]);

  // Calculate if crop will be resized and determine indicator color
  const getCropIndicatorInfo = () => {
    console.log('DEBUG getCropIndicatorInfo - selectedResolution:', selectedResolution);
    console.log('DEBUG getCropIndicatorInfo - completedCrop:', completedCrop);
    console.log('DEBUG getCropIndicatorInfo - videoData:', videoData);
    
    let width, height;
    
    if (!completedCrop && videoData) {
      // If no crop is set, use full video dimensions
      width = videoData.width;
      height = videoData.height;
      console.log('DEBUG getCropIndicatorInfo - using full video dimensions:', width, 'x', height);
    } else if (completedCrop) {
      width = completedCrop.width;
      height = completedCrop.height;
      console.log('DEBUG getCropIndicatorInfo - using completed crop dimensions:', width, 'x', height);
    } else {
      console.log('DEBUG getCropIndicatorInfo - no crop or video data, returning defaults');
      return { width: 0, height: 0, willResize: false, color: '#fff', resizedWidth: 0, resizedHeight: 0 };
    }
    
    const willResize = width > selectedResolution || height > selectedResolution;
    console.log('DEBUG getCropIndicatorInfo - willResize:', willResize, '(width:', width, '> selectedResolution:', selectedResolution, 'OR height:', height, '> selectedResolution:', selectedResolution, ')');
    
    const color = willResize ? '#ff4444' : '#44ff44';
    
    // Calculate the resized dimensions while preserving aspect ratio
    let resizedWidth = width;
    let resizedHeight = height;
    
    if (willResize) {
      const aspectRatio = width / height;
      console.log('DEBUG getCropIndicatorInfo - aspectRatio:', aspectRatio);
      
      if (width > height) {
        // Landscape: limit by width
        resizedWidth = selectedResolution;
        resizedHeight = Math.round(selectedResolution / aspectRatio);
        console.log('DEBUG getCropIndicatorInfo - landscape resize: width =', resizedWidth, ', height =', resizedHeight);
      } else {
        // Portrait or square: limit by height
        resizedHeight = selectedResolution;
        resizedWidth = Math.round(selectedResolution * aspectRatio);
        console.log('DEBUG getCropIndicatorInfo - portrait resize: width =', resizedWidth, ', height =', resizedHeight);
      }
    }
    
    console.log('DEBUG getCropIndicatorInfo - final result:', { width, height, willResize, color, resizedWidth, resizedHeight });
    return { width, height, willResize, color, resizedWidth, resizedHeight };
  };

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
      setZoom(1);
      setFlipHorizontal(false);
      setFlipVertical(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    console.log('DemoVideoGalleryModal - handleClose called');
    setIsOpen(false);
  };

  const handleReupload = () => {
    console.log('DemoVideoGalleryModal - handleReupload called');
    setIsOpen(false);
    // Reset state and allow user to upload another file
    setVideoData(null);
    setUploadingState('default');
    setSession(null);
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
    console.log('DemoVideoGalleryModal - handleContinue called');
    setIsOpen(false);
    if (videoData) {
      setUploadingState('uploading');
      
      try {
        // Process the video with crop and flip data
        const processedVideoData = await processVideoWithCrop(videoData, {
          crop,
          zoom,
          flipHorizontal,
          flipVertical,
          croppedAreaPixels: completedCrop
        });
        
        console.log('Processed video data:', processedVideoData);
        
        // Navigate with the processed video data (cropped or original)
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
        setUploadingState('error');
      }
    }
  };

  const videoTransform = `scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`;

  return (
    <Modal ref={modalRef} {...stylex.props(styles.container)}>
      <div onClick={handleClose} {...stylex.props(styles.closeButton)}>
        <Close size={28} />
      </div>
      <Modal.Body>
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.header)}>
            <div {...stylex.props(styles.title)}>
              Crop and adjust your video
            </div>
          </div>
          
          {videoData && (
            <div {...stylex.props(styles.cropperContainer)}>
              <ReactCrop
                crop={crop}
                onChange={(newCrop) => setCrop(newCrop)}
                onComplete={(c, percentCrop) => onCropComplete(c, percentCrop)}
                style={{
                  width: '100%',
                  height: '100%'
                }}
              >
                <video
                  src={videoData.url}
                  style={{
                    transform: `${videoTransform} scale(${zoom})`,
                    width: '100%',
                    height: '100%',
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
                    Will be resized to {cropInfo.resizedWidth}×{cropInfo.resizedHeight}
                  </div>
                )}
              </div>
              
              <style>
                {`
                  .ReactCrop__child-wrapper {
                    width: 100% !important;
                    height: 100% !important;
                    position: relative !important;
                  }
                `}
              </style>
            </div>
          )}

          <div {...stylex.props(styles.controls)}>
            <button
              onClick={handleFlipHorizontal}
              {...stylex.props(styles.flipButton)}
            >
              <Rotate size={20} />
              Flip Horizontal
            </button>
            <button
              onClick={handleFlipVertical}
              {...stylex.props(styles.flipButton)}
            >
              <RotateClockwise size={20} />
              Flip Vertical
            </button>
            <label {...stylex.props(styles.flipButton)}>
              Zoom: {zoom.toFixed(1)}x
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                style={{ marginLeft: '8px', width: '100px' }}
              />
            </label>
          </div>

          <div {...stylex.props(styles.buttonContainer)}>
            <button
              onClick={handleReupload}
              {...stylex.props(styles.button, styles.reuploadButton)}
            >
              Reupload
            </button>
            <button
              onClick={handleContinue}
              {...stylex.props(styles.button, styles.continueButton)}
            >
              Continue
            </button>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}