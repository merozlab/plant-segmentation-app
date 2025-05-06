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
// import ClearAllPointsInVideoButton from '@/common/components/annotations/ClearAllPointsInVideoButton';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import CloseSessionButton from '@/common/components/annotations/CloseSessionButton';
import TrackAndPlayButton from '@/common/components/button/TrackAndPlayButton';
import ToolbarBottomActionsWrapper from '@/common/components/toolbar/ToolbarBottomActionsWrapper';
import {
  DOWNLOAD_TOOLBAR_INDEX,
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { streamingStateAtom } from '@/demo/atoms';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { sessionAtom } from '@/demo/atoms';
import { useAtomValue, useAtom } from 'jotai';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom';
import { useState } from 'react';
import { originalFilePathAtom } from '@/demo/atoms';

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function ObjectsToolbarBottomActions({ onTabChange }: Props) {
  const session = useAtomValue(sessionAtom); // Get the current session
  const originalFilePath = useAtomValue(originalFilePathAtom);
  const [, setMasksReady] = useAtom(masksReadyAtom); // We only need the setter here
  const { enqueueMessage, clearMessage } = useMessagesSnackbar();
  const [, setIsLoading] = useState(false);
  const streamingState = useAtomValue(streamingStateAtom);

  const isTrackingEnabled =
    streamingState !== 'none' && streamingState !== 'full';


  async function handleSwitchToMoreOptionsTab() {
    if (!session?.id) {
      // Use the predefined message for no active session
      enqueueMessage('noActiveSession');
      return;
    }

    setIsLoading(true); // Set loading state to true
    // Show mask generation in-progress message
    // enqueueMessage('maskGenerationStart');

    try {
      // Call the /maskify endpoint asynchronously
      const response = await fetch(`${VIDEO_API_ENDPOINT}/maskify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Send zip: false as we only need the server to generate masks, not zip them for download yet
        body: JSON.stringify({ session_id: session.id, original_file_path: originalFilePath }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Maskify request failed: ${response.status} - ${errorText}`);
      }
      else {
        setIsLoading(false); // Set loading state to false
        // Clear the in-progress message
        clearMessage();
        // Show success message
        // Set masks as ready
        setMasksReady(true);
        // Navigate to Download tab
        onTabChange(DOWNLOAD_TOOLBAR_INDEX);
      }
    } catch (error) {
      // Clear the in-progress message
      clearMessage();
      // Show error message
      enqueueMessage('maskGenerationFailure');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ToolbarBottomActionsWrapper>
      {/* <ClearAllPointsInVideoButton
        onRestart={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
      /> */}
      <RestartSessionButton
        onRestartSession={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
      />
      {isTrackingEnabled && <TrackAndPlayButton />}
      {streamingState === 'full' && (
        <CloseSessionButton onSessionClose={handleSwitchToMoreOptionsTab} />
      )}
    </ToolbarBottomActionsWrapper>
  );
}
