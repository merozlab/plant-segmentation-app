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
import { useAtom } from 'jotai'; // Import useAtomValue and useAtom
// import { sessionAtom } from '@/demo/atoms'; // Import sessionAtom
import { useState } from 'react'; // Import state to handle button loading state
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom'; // Import our mask readiness state

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function MoreOptionsToolbarBottomActions({onTabChange}: Props) {
  // const session = useAtomValue(sessionAtom); // Get the current session
  const [isLoading, setIsLoading] = useState(false); // Add loading state for the button
  // const { enqueueMessage, clearMessage } = useMessagesSnackbar();
  const [areMasksReady, ] = useAtom(masksReadyAtom); // We only need the setter here

  function handleReturnToEffectsTab() {
    onTabChange(EFFECT_TOOLBAR_INDEX);
  }

  // Make the handler async
  async function handleSwitchToCenterlineTab() {
    if (areMasksReady) {
      setIsLoading(false);
      onTabChange(CENTERLINE_TOOLBAR_INDEX);
      return;
    }
    else {
      setIsLoading(true);
      // Wait 5 seconds and try again
      setTimeout(() => {
      setIsLoading(false);
      onTabChange(CENTERLINE_TOOLBAR_INDEX);
      }, 5000);
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
        {isLoading ? 'Finishing mask generation...' : 'Next'}
      </PrimaryCTAButton>
    </ToolbarBottomActionsWrapper>
  );
}
