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
import { ChevronLeft, Download } from '@carbon/icons-react';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import {
  DOWNLOAD_TOOLBAR_INDEX,
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { sessionAtom } from '@/demo/atoms';
import { useAtomValue } from 'jotai';
// import useVideo from '@/common/components/video/editor/useVideo';
import ToolbarHeaderWrapper from '@/common/components/toolbar/ToolbarHeaderWrapper';
import OptionButton from '@/common/components/options/OptionButton';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
type Props = {
  onTabChange: (newIndex: number) => void;
};


export default function CenterlineToolbar({ onTabChange }: Props) {
  const session = useAtomValue(sessionAtom);
  const { enqueueMessage } = useMessagesSnackbar();

  const handleBack = () => {
    onTabChange(DOWNLOAD_TOOLBAR_INDEX); // Go back to More Options tab (index 2)
  };

  const isLoading = false; // Replace with actual loading state
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
          session_id: session.id
        }),
      });

      if (zipResponse.ok) {
        // Create a download link for the zip file
        const blob = await zipResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `${session.id}_centerlines.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        enqueueMessage('centerlineDownloadSuccess');
      } else {
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
        description="Set base points for each object to extract centerlines."
        className="pb-4"
      />

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

      <div className="p-5 md:p-8 flex flex-col gap-4">
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
