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
import ToolbarSection from '@/common/components/toolbar/ToolbarSection';
import {Button} from 'react-daisyui';
// import useRestartSession from '@/common/components/session/useRestartSession'; // Assuming this hook handles resetting
import {ChevronLeft} from '@carbon/icons-react';
import RestartSessionButton from '@/common/components/session/RestartSessionButton';
import {
    OBJECT_TOOLBAR_INDEX,
  } from '@/common/components/toolbar/ToolbarConfig';

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function CenterlineToolbar({onTabChange}: Props) {
//   const {restartSession} = useRestartSession(); // Use the hook

//   const handleStartOver = async () => {
//     await restartSession(() => {
//         onTabChange(0); // Go back to the first tab (Objects) after session restarts
//     });
//   };

  const handleBack = () => {
    onTabChange(2); // Go back to More Options tab (index 2)
  };

  return (
    <div className="flex flex-col h-full">
      <ToolbarSection title="Centerline Extraction">
        <p className="text-gray-400 p-4">
          Centerline extraction options will go here.
          {/* Placeholder content */}
        </p>
      </ToolbarSection>

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
