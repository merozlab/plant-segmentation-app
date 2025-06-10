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
import { Archive } from '@carbon/icons-react';
import OptionButton from './OptionButton';
import useDownloadVideo from './useDownloadVideo';
import { useAtom, useAtomValue } from 'jotai';
import { masksReadyAtom } from './masksReadyAtom';
import { erodeBorderAtom } from '@/demo/atoms';
import Tooltip from '@/common/components/Tooltip';

export default function DownloadFramesOption() {
  const { download, state } = useDownloadVideo();
  const masksReady = useAtomValue(masksReadyAtom); // Get the mask readiness state
  const [erodeBorder, setErodeBorder] = useAtom(erodeBorderAtom);

  // Conditionally render with tooltip if masks aren't ready
  const buttonElement = (
    <div className="flex flex-col gap-2">
      <OptionButton
        title="Download Masks"
        Icon={Archive}
        isDisabled={!masksReady}
        loadingProps={{
          loading: state === 'started' || state === 'encoding',
          label: 'Extracting frames...',
        }}
        onClick={() => download(true, 'frames')}
      />
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="erodeBorder"
          checked={erodeBorder}
          onChange={(e) => setErodeBorder(e.target.checked)}
          className="checkbox checkbox-primary checkbox-sm"
          disabled={!masksReady}
        />
        <label htmlFor="erodeBorder" className="text-sm text-white cursor-pointer">
          Erode border
        </label>
      </div>
    </div>
  );

  // If masks aren't ready, wrap in a tooltip explaining why it's disabled
  if (!masksReady) {
    return (
      <Tooltip message="Click 'Next' to generate masks first">
        {buttonElement}
      </Tooltip>
    );
  }

  // Otherwise just return the button
  return buttonElement;
}
