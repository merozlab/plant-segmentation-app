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
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import CloseSessionButton from '@/common/components/annotations/CloseSessionButton';
import RepropagateMasksButton from '@/common/components/annotations/RepropagateMasksButton';
import TrackAndPlayButton from '@/common/components/button/TrackAndPlayButton';
import ToolbarBottomActionsWrapper from '@/common/components/toolbar/ToolbarBottomActionsWrapper';
import {
  LENGTH_SCALE_TOOLBAR_INDEX,
  OBJECT_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import { streamingStateAtom, hasEditedMasksAfterPropagationAtom } from '@/demo/atoms';
import { useAtomValue } from 'jotai';

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function ObjectsToolbarBottomActions({ onTabChange }: Props) {
  const streamingState = useAtomValue(streamingStateAtom);
  const hasEditedMasksAfterPropagation = useAtomValue(hasEditedMasksAfterPropagationAtom);

  const isTrackingEnabled =
    streamingState !== 'none' && streamingState !== 'full' && !hasEditedMasksAfterPropagation;

  // After propagation completes, show "Good to go" by default
  const showGoodToGo = streamingState === 'full' && !hasEditedMasksAfterPropagation;

  // After user edits masks post-propagation, show both "Good to go" and "Re-propagate" 
  const showPostEditOptions = hasEditedMasksAfterPropagation;

  return (
    <ToolbarBottomActionsWrapper>
      <RestartSessionButton
        onRestartSession={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
      />

      {/* Show track button during initial phase */}
      {isTrackingEnabled && <TrackAndPlayButton />}

      {/* Show "Good to go" immediately after propagation */}
      {showGoodToGo && (
        <CloseSessionButton onSessionClose={() => onTabChange(LENGTH_SCALE_TOOLBAR_INDEX)} cta={true} />
      )}

      {/* Show both options after user edits masks post-propagation */}
      {showPostEditOptions && (
        <div className="flex gap-3">
          <CloseSessionButton onSessionClose={() => onTabChange(LENGTH_SCALE_TOOLBAR_INDEX)} cta={false} />
          <RepropagateMasksButton />
        </div>
      )}
    </ToolbarBottomActionsWrapper>
  );
}
