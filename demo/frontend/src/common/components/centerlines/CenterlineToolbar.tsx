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
import ToolbarObjectContainer from '@/common/components/annotations/ToolbarObjectContainer';
import ObjectThumbnail from '@/common/components/annotations/ObjectThumbnail';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { Button } from 'react-daisyui';
import { ChevronLeft, Download } from '@carbon/icons-react';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import {
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { trackletObjectsAtom, sessionAtom, frameIndexAtom } from '@/demo/atoms';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState, useEffect } from 'react';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import useVideo from '@/common/components/video/editor/useVideo';

type Props = {
  onTabChange: (newIndex: number) => void;
};

// Interface for tracking base points
interface ObjectBasePoint {
  objectId: number;
  basePoint: [number, number] | null;
  name: string;
}

export default function CenterlineToolbar({ onTabChange }: Props) {
  const trackletObjects = useAtomValue(trackletObjectsAtom);
  const session = useAtomValue(sessionAtom);
  const video = useVideo();
  const { enqueueMessage } = useMessagesSnackbar();
  const setFrameIndex = useSetAtom(frameIndexAtom);

  // State for tracking base points for each object
  const [objectBasePoints, setObjectBasePoints] = useState<ObjectBasePoint[]>([]);
  // State to track if the "Get Centerlines" button should be enabled
  const [allPointsSelected, setAllPointsSelected] = useState(false);
  // Loading state for the button
  const [isLoading, setIsLoading] = useState(false);
  // Currently active object for base point selection
  const [activeObjectIndex, setActiveObjectIndex] = useState<number>(0);
  // State to control whether to show the interaction layer
  // const [showInteractionLayer, setShowInteractionLayer] = useState(true);

  // Initialize object base points when tracklet objects change
  useEffect(() => {
    if (trackletObjects.length > 0) {
      const initialBasePoints = trackletObjects.map(obj => ({
        objectId: obj.id,
        basePoint: null,
        name: `Object ${obj.id + 1}`
      }));
      setObjectBasePoints(initialBasePoints);
    }
  }, [trackletObjects]);

  // Reset video to first frame and pause when this component mounts
  useEffect(() => {
    if (video) {
      video.frame = 0;
      setFrameIndex(0);
      video.pause();
    }

    return () => {
    };
  }, [video, setFrameIndex]);

  // Check if all objects have base points set
  useEffect(() => {
    const allSelected = objectBasePoints.length > 0 &&
      objectBasePoints.every(point => point.basePoint !== null);
    setAllPointsSelected(allSelected);
  }, [objectBasePoints]);

  const handleBack = () => {
    onTabChange(2); // Go back to More Options tab (index 2)
  };

  // Handle clicking on a specific object to make it active
  const handleObjectClick = (objectId: number) => {
    const objectIndex = objectBasePoints.findIndex(obj => obj.objectId === objectId);
    if (objectIndex !== -1) {
      setActiveObjectIndex(objectIndex);
    }
  };

  const handleGetCenterlines = async () => {
    if (!session?.id) {
      enqueueMessage('noActiveSession');
      return;
    }

    try {
      setIsLoading(true);

      // Prepare data for the API call
      const baseCoords = objectBasePoints
        .filter(point => point.basePoint !== null)
        .map(point => point.basePoint);

      // Send request to the backend
      const response = await fetch(`${VIDEO_API_ENDPOINT}/centerline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: session.id,
          base_coords: baseCoords
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Handle the successful response - it will be a CSV file download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.href = url;
      a.download = `${session.id}_centerlines.csv`;
      a.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      enqueueMessage('centerlineSuccess');
    } catch (error) {
      console.error('Error fetching centerlines:', error);
      enqueueMessage('centerlineError');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Add the interaction layer to capture point clicks */}

      <p className="text-gray-400 mb-4">
        Select base points for each object to calculate centerlines.
        Click on the video canvas to set the base point for each plant.
      </p>

      <div className="grow w-full overflow-y-auto">
        {objectBasePoints.map((obj, index) => {
          const tracklet = trackletObjects.find(t => t.id === obj.objectId);
          const color = tracklet?.color || '#ffffff';
          const isActive = index === activeObjectIndex;

          return (
            <ToolbarObjectContainer
              key={obj.objectId}
              isActive={isActive}
              title={obj.name}
              subtitle={obj.basePoint
                ? `Base point set at (${Math.round(obj.basePoint[0])}, ${Math.round(obj.basePoint[1])})`
                : isActive
                  ? 'Click on the video frame to set the base point for this object'
                  : 'Waiting for base point selection'
              }
              isMobile={false}
              onClick={() => handleObjectClick(obj.objectId)}
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
                      ? '👉 Currently selecting'
                      : '⚠️ Waiting for selection'
                  }
                </div>
              </div>
            </ToolbarObjectContainer>
          );
        })}
      </div>

      <div className="mt-6 text-center">
        <Button
          color="primary"
          disabled={!allPointsSelected || isLoading}
          loading={isLoading}
          onClick={handleGetCenterlines}
          startIcon={<Download />}
          className="w-full">
          {isLoading ? 'Processing...' : 'Get Centerlines'}
        </Button>
        <p className="text-sm text-gray-500 mt-2">
          {allPointsSelected ?
            'Ready to extract centerlines!' :
            'Set base points for all objects first'}
        </p>
      </div>

      {/* Spacer to push buttons to the bottom */}
      <div className="flex-grow"></div>

      {/* Bottom Navigation Buttons */}
      <div className="flex justify-between p-4 border-t border-graydark-600">
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
      </div>
    </div>
  );
}
