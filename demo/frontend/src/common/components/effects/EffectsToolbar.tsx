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
import EffectsToolbarBottomActions from '@/common/components/effects/EffectsToolbarBottomActions';
import EffectsToolbarHeader from '@/common/components/effects/EffectsToolbarHeader';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import useVideoEffect from '@/common/components/video/editor/useVideoEffect';
import { EffectIndex } from '@/common/components/video/effects/Effects';
import ToolbarSection from '@/common/components/toolbar/ToolbarSection';
// import {Image, Erase, FilterRemove} from '@carbon/icons-react';
import { FilterRemove } from '@carbon/icons-react';
// import ToolbarActionIcon from '@/common/components/toolbar/ToolbarActionIcon';
import { useEffect, useRef, useCallback, useState } from 'react';
import { Button } from 'react-daisyui';

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function EffectsToolbar({ onTabChange }: Props) {
  const isEffectsMessageShown = useRef(false);
  const { enqueueMessage } = useMessagesSnackbar();
  const setEffect = useVideoEffect();

  // State to track the current effect mode (0 = default, 1 = full erase, 2 = background only erase)
  const [effectMode, setEffectMode] = useState(0);

  // Toggle between three modes:
  // 0 - Default (Original background, Overlay foreground)
  // 1 - Full erase (EraseBackground + EraseForeground) 
  // 2 - Background only erase (EraseBackground + Original foreground)
  const handleApplyEraseEffects = useCallback(() => {
    // Cycle through the three modes
    const nextMode = (effectMode + 1) % 3;

    // Apply effects based on the next mode
    switch (nextMode) {
      case 0: // Reset to default
        setEffect('Original', EffectIndex.BACKGROUND, { variant: 0 });
        setEffect('Overlay', EffectIndex.HIGHLIGHT, { variant: 0 });
        break;

      case 1: // Background only erase
        setEffect('EraseBackground', EffectIndex.BACKGROUND, { variant: 0 });
        setEffect('Cutout', EffectIndex.HIGHLIGHT, { variant: 0 });
        // setEffect('EraseForeground', EffectIndex.HIGHLIGHT, { variant: 0 });
        break;

      case 2: // Full erase mode
        setEffect('EraseBackground', EffectIndex.BACKGROUND, { variant: 0 });
        setEffect('EraseForeground', EffectIndex.HIGHLIGHT, { variant: 0 });
        break;
    }

    // Update the mode state
    setEffectMode(nextMode);
  }, [setEffect, effectMode]);

  useEffect(() => {
    // Apply overlay effect to objects
    setEffect('Overlay', EffectIndex.HIGHLIGHT);

    // Apply black background
    // setEffect('EraseBackground', EffectIndex.BACKGROUND);

    if (!isEffectsMessageShown.current) {
      isEffectsMessageShown.current = true;
      enqueueMessage('effectsMessage');
    }
  }, [enqueueMessage, setEffect]);

  return (
    <div className="flex flex-col h-full">
      <EffectsToolbarHeader />
      <div className="grow overflow-y-auto">
        {/* Fixed Objects Effect: White Mask */}
        {/* <ToolbarSection title="Selected Objects" borderBottom={true}>
          <ToolbarActionIcon
            variant="toggle"
            icon={Image}
            title="White Mask"
            isActive={true}
            isDisabled={true}
            onClick={() => {}} // No action needed, already applied
          />
          {/* Other effects disabled */}
        {/*<ToolbarActionIcon
            variant="toggle" 
            icon={Erase}
            title="Other Effects (Disabled)"
            isActive={false}
            isDisabled={true}
            onClick={() => {}}
          />
        </ToolbarSection> */}

        {/* Fixed Background Effect: Black */}
        {/* <ToolbarSection title="Background" borderBottom={true}>
          <ToolbarActionIcon
            variant="toggle"
            icon={Erase}
            title="Black Background"
            isActive={true}
            isDisabled={true}
            onClick={() => {}} // No action needed, already applied
          /> */}
        {/* Other effects disabled */}
        {/*<ToolbarActionIcon
            variant="toggle"
            icon={Image}
            title="Other Effects (Disabled)"
            isActive={false}
            isDisabled={true}
            onClick={() => {}}
          />
        </ToolbarSection> */}

        {/* Custom Effects Button */}
        <ToolbarSection title="Create Masks" borderBottom={false}>
          <Button
            color="ghost"
            size="md"
            className={`col-span-4 my-2 font-medium'bg-black hover:bg-gray-900 text-white !rounded-lg`}
            startIcon={<FilterRemove size={24} />}
            onClick={handleApplyEraseEffects}>
            {effectMode === 0 ? 'Erase Background' :
              effectMode === 1 ? 'Masks Only' : 'Masks Overlay'}
          </Button>
        </ToolbarSection>
      </div>
      <EffectsToolbarBottomActions onTabChange={onTabChange} />
    </div>
  );
}
