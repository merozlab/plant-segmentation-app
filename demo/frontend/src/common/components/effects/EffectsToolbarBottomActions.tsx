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
import PrimaryCTAButton from '@/common/components/button/PrimaryCTAButton';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import ToolbarBottomActionsWrapper from '@/common/components/toolbar/ToolbarBottomActionsWrapper';
import {
  MORE_OPTIONS_TOOLBAR_INDEX,
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { sessionAtom } from '@/demo/atoms';
import { useAtomValue, useAtom } from 'jotai';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import { ChevronRight } from '@carbon/icons-react';
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom';


type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function EffectsToolbarBottomActions({ onTabChange }: Props) {
  const session = useAtomValue(sessionAtom); // Get the current session
  const [, setMasksReady] = useAtom(masksReadyAtom); // We only need the setter here

  async function handleSwitchToMoreOptionsTab() {
    if (!session?.id) {
      // Decide if navigation should still happen or show an error
      // For now, let's navigate anyway but log the error
      console.log('Session ID is not available');
      onTabChange(MORE_OPTIONS_TOOLBAR_INDEX);
      return;
    }

    try {
      // Call the /maskify endpoint asynchronously
      const response = await fetch(`${VIDEO_API_ENDPOINT}/maskify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Send zip: false as we only need the server to generate masks, not zip them for download yet
        body: JSON.stringify({ session_id: session.id, zip: false }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Maskify request failed: ${response.status} - ${errorText}`);
      }
      else {
        setMasksReady(true);
      }
    } catch (error) {
      console.log('Error calling /maskify endpoint:', error);
      // Handle error appropriately - maybe show a message to the user
      // For now, just log the error and continue navigation
    } 
    onTabChange(MORE_OPTIONS_TOOLBAR_INDEX);
  }

  return (
    <ToolbarBottomActionsWrapper>
      <RestartSessionButton
        onRestartSession={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
      />
      <PrimaryCTAButton
        onClick={handleSwitchToMoreOptionsTab}
        endIcon={<ChevronRight />}>
        Next
      </PrimaryCTAButton>
    </ToolbarBottomActionsWrapper>
  );
}
