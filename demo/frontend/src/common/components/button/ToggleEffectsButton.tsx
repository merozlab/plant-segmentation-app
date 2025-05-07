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
import { useCallback, useState } from 'react';
import useToolbarTabs from '@/common/components/toolbar/useToolbarTabs';
import useVideoEffect from '@/common/components/video/editor/useVideoEffect';
import { EffectIndex } from '@/common/components/video/effects/Effects';
import { WatsonHealth3DMprToggle } from '@carbon/icons-react';

export default function ToggleEffectsButton() {
    const [tabIndex] = useToolbarTabs();

    // Disable the button during frame extraction 
    // or when we're in a partial streaming state
    const isDisabled = tabIndex < 1;

    const [effectMode, setEffectMode] = useState(0);
    const setEffect = useVideoEffect();
    const toggleEffects = useCallback(() => {
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

    return (
        <Tooltip message="Toggle Effects">
            <button
                disabled={isDisabled}
                className={`group !rounded-full !w-8 !h-8 flex items-center justify-center ${isDisabled
                    ? '!bg-gray-400 !text-graydark-700 cursor-not-allowed'
                    : effectMode === 0
                        ? 'bg-white text-green-700 hover:bg-green-200'
                        : effectMode === 1
                            ? 'bg-white text-black hover:bg-gray-200'
                            : 'bg-white text-blue-700 hover:bg-blue-200'
                    }`}
                onClick={toggleEffects}>
                <WatsonHealth3DMprToggle
                    size={18}
                    className={
                        isDisabled
                            ? 'text-graydark-600'
                            : effectMode === 0
                                ? 'text-gray-800 group-hover:text-gray-900'
                                : effectMode === 1
                                    ? 'text-black group-hover:text-green-700'
                                    : 'text-blue-700 group-hover:text-blue-900'
                    }
                />
            </button>
        </Tooltip>
    );
}