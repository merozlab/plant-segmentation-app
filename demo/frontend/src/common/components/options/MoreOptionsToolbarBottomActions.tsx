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
import {
  EFFECT_TOOLBAR_INDEX,
  CENTERLINE_TOOLBAR_INDEX, // Import the new index
} from '@/common/components/toolbar/ToolbarConfig';
import {ChevronLeft, ChevronRight} from '@carbon/icons-react'; // Import ChevronRight
import {Button} from 'react-daisyui';
import ToolbarBottomActionsWrapper from '../toolbar/ToolbarBottomActionsWrapper';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { useAtom, useAtomValue } from 'jotai'; // Import useAtomValue and useAtom
import { sessionAtom } from '@/demo/atoms'; // Import sessionAtom
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig'; // Import the endpoint URL
import Logger from '@/common/logger/Logger'; // Import Logger for error handling
import { useState } from 'react'; // Import state to handle button loading state
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom'; // Import our mask readiness state

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function MoreOptionsToolbarBottomActions({onTabChange}: Props) {
  const session = useAtomValue(sessionAtom); // Get the current session
  const [isLoading, setIsLoading] = useState(false); // Add loading state for the button
  const { enqueueMessage, clearMessage } = useMessagesSnackbar();
  const [, setMasksReady] = useAtom(masksReadyAtom); // We only need the setter here

  function handleReturnToEffectsTab() {
    onTabChange(EFFECT_TOOLBAR_INDEX);
  }

  // Make the handler async
  async function handleSwitchToCenterlineTab() {
    if (!session?.id) {
      Logger.error('Cannot call /maskify: No active session ID found.');
      enqueueMessage('noActiveSession');
      return;
    }

    setIsLoading(true);
    // Show the message that mask generation has started
    enqueueMessage('maskGenerationStart');
    
    try {
      // Call the /maskify endpoint asynchronously to generate masks
      const response = await fetch(`${VIDEO_API_ENDPOINT}/maskify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: session.id, zip: false }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Maskify request failed: ${response.status} - ${errorText}`);
      }

      // Set masks as ready if the request was successful
      setMasksReady(true);
      Logger.info('Masks generated successfully.');
      
      // Clear the "in progress" message and show success message
      clearMessage();
      enqueueMessage('maskGenerationSuccess');
      
      // Continue to the next tab after successful mask generation
      onTabChange(CENTERLINE_TOOLBAR_INDEX);
    } catch (error) {
      Logger.error('Error calling /maskify endpoint:', error);
      // Clear the "in progress" message and show error message
      clearMessage();
      enqueueMessage('maskGenerationFailure');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <ToolbarBottomActionsWrapper>
      <Button
        color="ghost"
        onClick={handleReturnToEffectsTab}
        disabled={isLoading}
        className="!px-4 !rounded-full font-medium text-white hover:bg-black"
        startIcon={<ChevronLeft />}>
        Edit effects
      </Button>
      {/* Next button with loading state */}
      <PrimaryCTAButton
        onClick={handleSwitchToCenterlineTab}
        endIcon={isLoading ? null : <ChevronRight />}
        disabled={isLoading}>
        {isLoading ? 'Generating Masks...' : 'Next'}
      </PrimaryCTAButton>
    </ToolbarBottomActionsWrapper>
  );
}
