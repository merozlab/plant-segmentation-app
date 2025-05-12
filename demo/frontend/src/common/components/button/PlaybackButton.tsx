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
import Tooltip from '@/common/components/Tooltip';
import { isFrameExtractionInProgressAtom } from '@/common/components/options/useDownloadVideo';
import useVideo from '@/common/components/video/editor/useVideo';
import { isPlayingAtom, streamingStateAtom } from '@/demo/atoms'; // toolbarTabIndex
import { PauseFilled, PlayFilledAlt } from '@carbon/icons-react';
import { useAtomValue } from 'jotai';
import { useCallback } from 'react';

export default function PlaybackButton() {
  // const tabIndex = useAtomValue(toolbarTabIndex);
  const streamingState = useAtomValue(streamingStateAtom);
  const isPlaying = useAtomValue(isPlayingAtom);
  const isFrameExtractionInProgress = useAtomValue(isFrameExtractionInProgressAtom);
  const video = useVideo();

  // Disable the button during frame extraction 
  // or when we're in a partial streaming state
  const isDisabled =
    isFrameExtractionInProgress ||
    (streamingState === 'requesting' || streamingState === 'aborting');

  const handlePlay = useCallback(() => {
    video?.play();
  }, [video]);

  const handlePause = useCallback(() => {
    video?.pause();
  }, [video]);

  const handleClick = useCallback(() => {
    if (isDisabled) {
      return;
    }
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [isDisabled, isPlaying, handlePlay, handlePause]);

  return (
    <Tooltip message={`${isPlaying ? 'Pause' : 'Play'}`}>
      <button
        disabled={isDisabled}
        className={`group !rounded-full !w-10 !h-10 flex items-center justify-center ${getButtonStyles(isDisabled)}`}
        onClick={handleClick}>
        {isPlaying ? (
          <PauseFilled size={18} />
        ) : (
          <PlayFilledAlt
            size={18}
            className={!isDisabled ? 'group-hover:text-green-500' : ''}
          />
        )}
      </button>
    </Tooltip>
  );
}

function getButtonStyles(isDisabled: boolean): string {
  if (isDisabled) {
    return '!bg-gray-600 !text-graydark-700';
  }
  return `!text-black bg-white`;
}
