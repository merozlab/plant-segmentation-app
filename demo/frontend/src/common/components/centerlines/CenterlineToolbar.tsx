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
// import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { Button } from 'react-daisyui';
import { ChevronLeft, Download } from '@carbon/icons-react';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import {
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { trackletObjectsAtom, activeTrackletObjectIdAtom, sessionAtom, frameIndexAtom } from '@/demo/atoms';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import {  useEffect } from 'react';
// import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import useVideo from '@/common/components/video/editor/useVideo';
import ToolbarHeaderWrapper from '@/common/components/toolbar/ToolbarHeaderWrapper';

type Props = {
  onTabChange: (newIndex: number) => void;
};


export default function CenterlineToolbar({ onTabChange }: Props) {
  const session = useAtomValue(sessionAtom);
  console.log(session?.id)
  const video = useVideo();
  // const { enqueueMessage } = useMessagesSnackbar();
  const setFrameIndex = useSetAtom(frameIndexAtom);
  const [activeTrackletId, setActiveTrackletObjectId] = useAtom(
    activeTrackletObjectIdAtom,
  );
  const [trackletObjects] = useAtom(trackletObjectsAtom);

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
  // Set active tracklet id to 0 on mount
  useEffect(() => {
    setActiveTrackletObjectId(0);
  }, []);
  const handleBack = () => {
    onTabChange(2); // Go back to More Options tab (index 2)
  };

  const allPointsSelected = trackletObjects.every(obj => obj.basePoint);
  const isLoading = false; // Replace with actual loading state
  function handleGetCenterlines() {
    if (session) {
      console.error('Session ID in handlegetcenterlines:', session.id);
      return;
    } else {
      console.error('Session ID is null in handlegetcenterlines');
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Add the interaction layer to capture point clicks */}

    <ToolbarHeaderWrapper
      title="Centerline Extraction"
      description="Set base points for each object to extract centerlines."
      className="pb-4"
    />

      <div className="grow w-full overflow-y-auto">
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
