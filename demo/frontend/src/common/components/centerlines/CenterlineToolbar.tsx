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
// import ToolbarObjectContainer from '@/common/components/annotations/ToolbarObjectContainer';
// import ObjectThumbnail from '@/common/components/annotations/ObjectThumbnail';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { Button } from 'react-daisyui';
import { ChevronLeft, Download, ChevronDown, ChevronUp, Information } from '@carbon/icons-react';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import {
  DOWNLOAD_TOOLBAR_INDEX,
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { sessionAtom, trackletObjectsAtom, centerlinesAtom, originalFilePathAtom, centerlineAlgorithmAtom, centerlinePointsAtom, centerlineUnitsAtom, pixelsToMetersRatioAtom, centerlineEdgePercentageAtom } from '@/demo/atoms';
import { useAtomValue, useAtom, useSetAtom } from 'jotai';
// import useVideo from '@/common/components/video/editor/useVideo';
import ToolbarHeaderWrapper from '@/common/components/toolbar/ToolbarHeaderWrapper';
import OptionButton from '@/common/components/options/OptionButton';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import { useState, useCallback, useRef, useEffect } from 'react';
import ToolbarBottomActionsWrapper from '../toolbar/ToolbarBottomActionsWrapper';
type Props = {
  onTabChange: (newIndex: number) => void;
};


export default function CenterlineToolbar({ onTabChange }: Props) {
  const session = useAtomValue(sessionAtom);
  const trackletObjects = useAtomValue(trackletObjectsAtom);
  const originalFilePath = useAtomValue(originalFilePathAtom);
  const pixelsToMetersRatio = useAtomValue(pixelsToMetersRatioAtom);
  const setCenterlinesMap = useSetAtom(centerlinesAtom);
  const [centerlineAlgorithm, setCenterlineAlgorithm] = useAtom(centerlineAlgorithmAtom);
  const [centerlinePoints, setCenterlinePoints] = useAtom(centerlinePointsAtom);
  const [centerlineEdgePercentage, setCenterlineEdgePercentage] = useAtom(centerlineEdgePercentageAtom);
  const [centerlineUnits, setCenterlineUnits] = useAtom(centerlineUnitsAtom);
  const { enqueueMessage } = useMessagesSnackbar();
  const [isLoading, setIsLoading] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [localEdgePercentage, setLocalEdgePercentage] = useState<string>('');
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debounceEdgePercentageTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUserTypingRef = useRef<boolean>(false);

  const handleBack = () => {
    onTabChange(DOWNLOAD_TOOLBAR_INDEX); // Go back to More Options tab (index 2)
  };

  // Function to fetch centerlines with the selected algorithm
  const fetchCenterlinesPCA = useCallback(async (algorithm: 'edge' | 'full' | 'skeletonize') => {
    if (!session?.id) {
      console.error('Missing session for centerline PCA');
      return;
    }
    try {
      setIsLoading(true);
      const requestBody: any = {
        session_id: session.id,
        safe_folder_name: originalFilePath,
        pca_algorithm: algorithm,
        n_points: centerlinePoints
      };

      // Add edge_percentage if algorithm is 'edge'
      if (algorithm === 'edge' && centerlineEdgePercentage !== null) {
        requestBody.edge_percentage = centerlineEdgePercentage;
      }

      // Only add n_points if it's not null
      if (centerlinePoints !== null) {
        requestBody.n_points = centerlinePoints;
      }

      const resp = await fetch(`${VIDEO_API_ENDPOINT}/centerlines_pca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!resp.ok) throw new Error(resp.statusText);
      const data: Record<string, [number[], number[]][]> = await resp.json();
      const mapping: Record<number, Record<number, [number, number][]>> = {};
      Object.entries(data).forEach(([objName, frames]) => {
        const idx = parseInt(objName.split('_')[1], 10) - 1;
        const tracklet = trackletObjects[idx];
        if (!tracklet) return;
        const objMap: Record<number, [number, number][]> = {};
        frames.forEach(([xs, ys], fi) => {
          objMap[fi] = xs.map((x, i) => [x, ys[i]]);
        });
        mapping[tracklet.id] = objMap;
      });
      setCenterlinesMap(mapping);
    } catch (e) {
      console.error('Error fetching centerlines PCA:', e);
      enqueueMessage('centerlineDownloadError');
    } finally {
      setIsLoading(false);
    }
  }, [session?.id, originalFilePath, trackletObjects, setCenterlinesMap, enqueueMessage, centerlinePoints, centerlineEdgePercentage]);

  // Handle algorithm change
  const handleAlgorithmChange = useCallback(async (newAlgorithm: 'edge' | 'full' | 'skeletonize') => {
    setCenterlineAlgorithm(newAlgorithm);
    await fetchCenterlinesPCA(newAlgorithm);
  }, [setCenterlineAlgorithm, fetchCenterlinesPCA]);

  // Handle points change with debouncing
  const handlePointsChange = useCallback((newPoints: number | null) => {
    setCenterlinePoints(newPoints);

    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout to fetch centerlines after user stops typing
    debounceTimeoutRef.current = setTimeout(() => {
      fetchCenterlinesPCA(centerlineAlgorithm);
    }, 2000);
  }, [setCenterlinePoints, fetchCenterlinesPCA, centerlineAlgorithm]);

  // Handle edge percentage change with debouncing
  const handleEdgePercentageChange = useCallback((inputValue: string) => {
    isUserTypingRef.current = true;
    setLocalEdgePercentage(inputValue);

    // Clear existing timeout
    if (debounceEdgePercentageTimeoutRef.current) {
      clearTimeout(debounceEdgePercentageTimeoutRef.current);
    }

    // Set new timeout to update atom and fetch centerlines after user stops typing
    debounceEdgePercentageTimeoutRef.current = setTimeout(() => {
      isUserTypingRef.current = false;
      if (inputValue === '') {
        setCenterlineEdgePercentage(null);
      } else {
        const numValue = parseInt(inputValue);
        if (!isNaN(numValue)) {
          setCenterlineEdgePercentage(numValue / 100);
        }
      }
      fetchCenterlinesPCA(centerlineAlgorithm);
    }, 2000);
  }, [setCenterlineEdgePercentage, fetchCenterlinesPCA, centerlineAlgorithm]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (debounceEdgePercentageTimeoutRef.current) {
        clearTimeout(debounceEdgePercentageTimeoutRef.current);
      }
      isUserTypingRef.current = false;
    };
  }, []);

  // Initialize local edge percentage from atom (only when not user typing)
  useEffect(() => {
    if (!isUserTypingRef.current) {
      if (centerlineEdgePercentage !== null) {
        setLocalEdgePercentage(Math.round(centerlineEdgePercentage * 100).toString());
      } else {
        setLocalEdgePercentage('');
      }
    }
  }, [centerlineEdgePercentage]);


  // Auto-switch to pixels when no length scale is available
  useEffect(() => {
    if (!pixelsToMetersRatio && centerlineUnits === 'meters') {
      setCenterlineUnits('pixels');
    }
  }, [pixelsToMetersRatio, centerlineUnits, setCenterlineUnits]);

  async function handleGetCenterlines() {
    if (!session) {
      console.error('Session ID is null in handleGetCenterlines');
      return;
    }
    try {

      const zipResponse = await fetch(`${VIDEO_API_ENDPOINT}/centerlines_zip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: session.id,
          units: centerlineUnits,
          pixels_to_meters_ratio: pixelsToMetersRatio
        }),
      });

      if (zipResponse.ok) {
        // Create a download link for the zip file
        const blob = await zipResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        // Use appropriate filename based on units
        const filename = centerlineUnits === 'meters'
          ? `${session.id}_centerlines_meters.zip`
          : `${session.id}_centerlines.zip`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        enqueueMessage('centerlineDownloadSuccess');
      } else {
        // Check if it's a specific error related to meter conversion
        if (zipResponse.status === 400 || zipResponse.status === 500) {
          const errorText = await zipResponse.text();
          if (errorText.includes('pixels_to_meters_ratio') || errorText.includes('meters')) {
            enqueueMessage('centerlineConversionError');
          } else {
            enqueueMessage('centerlineDownloadError');
          }
        } else {
          enqueueMessage('centerlineDownloadError');
        }
        throw new Error(`Error downloading centerlines: ${zipResponse.status}`);
      }
    } catch (error) {
      console.error('Failed to get centerlines:', error);
      enqueueMessage('centerlineDownloadError');
    } finally {
      // setIsLoading(false);
    }
  }


  return (
    <div className="flex flex-col h-full">
      {/* Add the interaction layer to capture point clicks */}

      <ToolbarHeaderWrapper
        title="Centerline Extraction"
        description="Choose algorithm and extract centerline"
        className="pb-4"
      />
      <div className='overflow-y-auto'>
        {/* Algorithm Selection */}
        <div className="p-5 md:p-8 md:pb-0">
          <div className="flex flex-col gap-3">
            <label className="text-white text-sm font-medium">Algorithm Selection</label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="centerlineAlgorithm"
                value="edge"
                checked={centerlineAlgorithm === 'edge'}
                onChange={() => handleAlgorithmChange('edge')}
                className="radio radio-primary"
                disabled={isLoading}
              />
              <div className="flex flex-col">
                <span className="text-white font-medium">Edge PCA</span>
                <span className="text-gray-400 text-sm">Finds edge points using PCA on each side, traces the contour from edge points and averages</span>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="centerlineAlgorithm"
                value="skeletonize"
                checked={centerlineAlgorithm === 'skeletonize'}
                onChange={() => handleAlgorithmChange('skeletonize')}
                className="radio radio-primary"
                disabled={isLoading}
              />
              <div className="flex flex-col">
                <span className="text-white font-medium">Skeletonize</span>
                <span className="text-gray-400 text-sm">Morphological skeleton extraction using scikit-image</span>
              </div>
            </label>
          </div>
          {isLoading && (
            <div className="mt-4 text-center">
              <div className="loading loading-spinner loading-sm"></div>
              <span className="ml-2 text-gray-400">Updating centerlines...</span>
            </div>
          )}
        </div>

        {/* Advanced Options Section */}
        <div className="p-5 md:p-8 md:pb-0">
          <button
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="flex items-center justify-between w-full text-left text-white hover:text-gray-300 transition-colors"
          >
            <span className="text-sm font-medium">Advanced Options</span>
            {isAdvancedOpen ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {isAdvancedOpen && (
            <div className="mt-4 space-y-6">
              {/* Number of Points */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-white text-sm font-medium">Number of points</label>
                  <div
                    className="tooltip tooltip-top"
                    data-tip="Specifies how many points to generate along the centerline. Auto setting chooses a number of points according to mask length."
                  >
                    <Information className="w-4 h-4 text-gray-400 hover:text-white cursor-help" />
                  </div>
                </div>
                <input
                  type="number"
                  value={centerlinePoints || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      handlePointsChange(null);
                    } else {
                      const numValue = parseInt(value);
                      if (!isNaN(numValue)) {
                        handlePointsChange(numValue);
                      }
                    }
                  }}
                  onBlur={(e) => {
                    // Apply minimum constraint when user finishes editing
                    const value = e.target.value;
                    if (value !== '' && !isNaN(parseInt(value))) {
                      const constrainedValue = Math.max(50, Math.min(500, parseInt(value)));
                      if (constrainedValue !== parseInt(value)) {
                        handlePointsChange(constrainedValue);
                      }
                    }
                  }}
                  min={50}
                  max={500}
                  placeholder="Default: auto"
                  className="input input-bordered w-full max-w-xs bg-graydark-700 text-white border-graydark-500 focus:border-primary"
                  disabled={isLoading}
                />
                <span className="text-gray-400 text-xs">Leave empty for automatic selection (minimum 50 if specified)</span>
              </div>

              {/* Edge Percentage - Only show when Edge PCA algorithm is selected */}
              {centerlineAlgorithm === 'edge' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-white text-sm font-medium">Edge percentage</label>
                    <div
                      className="tooltip tooltip-top"
                      data-tip="Percentage of contour points to use for edge detection. Lower values focus on the tips, higher values include more of the contour."
                    >
                      <Information className="w-4 h-4 text-gray-400 hover:text-white cursor-help" />
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={localEdgePercentage}
                      onChange={(e) => {
                        const value = e.target.value;
                        handleEdgePercentageChange(value);
                      }}
                      onBlur={(e) => {
                        // Apply constraints when user finishes editing
                        const value = e.target.value;
                        if (value !== '' && !isNaN(parseInt(value))) {
                          const constrainedValue = Math.max(1, Math.min(50, parseInt(value)));
                          if (constrainedValue !== parseInt(value)) {
                            handleEdgePercentageChange(constrainedValue.toString());
                          }
                        }
                        // Reset typing flag after blur
                        setTimeout(() => {
                          isUserTypingRef.current = false;
                        }, 100);
                      }}
                      min={1}
                      max={50}
                      step={1}
                      placeholder="Default: auto"
                      className="input input-bordered w-full max-w-xs bg-graydark-700 text-white border-graydark-500 focus:border-primary pr-8"
                      disabled={isLoading}
                    />
                    <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">%</span>
                  </div>
                  <span className="text-gray-400 text-xs">Leave empty for automatic selection (1% - 50% if specified)</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Unit Selection */}
        <div className="p-5 md:py-4 md:px-8">
          <div className="flex flex-col gap-3">
            <label className="text-white text-sm font-medium">Download Units</label>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="centerlineUnits"
                  value="pixels"
                  checked={centerlineUnits === 'pixels'}
                  onChange={() => setCenterlineUnits('pixels')}
                  className="radio radio-primary"
                  disabled={isLoading}
                />
                <span className="text-white font-medium">Pixels</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="centerlineUnits"
                  value="meters"
                  checked={centerlineUnits === 'meters'}
                  onChange={() => setCenterlineUnits('meters')}
                  className="radio radio-primary"
                  disabled={isLoading || !pixelsToMetersRatio}
                />
                <span className={`font-medium ${!pixelsToMetersRatio ? 'text-gray-500' : 'text-white'}`}>Meters</span>
              </label>
            </div>
          </div>
        </div>

        {/* <div className="grow p-5 false overflow-y-auto">
        {trackletObjects.map((obj, index) => {
          const tracklet = trackletObjects.find(t => t.id === obj.id);
          const color = tracklet?.color || '#ffffff';
          const isActive = index === activeTrackletId;

          return (
            <ToolbarObjectContainer
              key={obj.id}
              isActive={isActive}
              title={`Object ${index + 1}`}
              subtitle={obj.basePoint
                ? `Base point set at (${Math.round(obj.basePoint[0])}, ${Math.round(obj.basePoint[1])})`
                : isActive
                  ? 'Click on the video frame to set the base point for this object'
                  : 'Waiting for base point selection'
              }
              isMobile={false}
              onClick={() => setActiveTrackletObjectId(obj.id)}
              thumbnail={
                <ObjectThumbnail
                  thumbnail={tracklet?.thumbnail || null}
                  color={color}
                />
              }
            >
              <div className="mt-2 ml-2">
                <div className={`text-sm ${obj.basePoint ? 'text-green-400' : isActive ? 'text-blue-400' : 'text-yellow-400'}`}>
                  {obj.basePoint
                    ? '✓ Base point set'
                    : isActive
                      ? 'Currently selecting'
                      : 'Waiting for selection'
                  }
                </div>
              </div>
            </ToolbarObjectContainer>
          );
        })}
      </div> */}

        <div className="p-5 md:px-8 md:pt-4 flex flex-col gap-4">
          <OptionButton
            title="Get Centerlines"
            Icon={Download}
            isDisabled={isLoading}
            loadingProps={{
              loading: isLoading,
              label: 'Processing...',
            }}
            onClick={handleGetCenterlines}
          />
        </div>

        {/* Spacer to push buttons to the bottom */}
        <div className="flex-grow"></div>
      </div>
      {/* Bottom Navigation Buttons */}
      <ToolbarBottomActionsWrapper>

        <Button
          color="ghost"
          onClick={handleBack}
          className="!px-4 !rounded-full font-medium text-white hover:bg-black"
          startIcon={<ChevronLeft />}>
          Mask download
        </Button>
        <RestartSessionButton
          onRestartSession={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
        />
      </ToolbarBottomActionsWrapper>
    </div>
  );
}
