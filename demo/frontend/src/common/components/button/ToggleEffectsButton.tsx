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
import ActionButton from '@/common/components/button/ActionButton'; // Updated import
import { useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import { toolbarTabIndex, isFirstClickMadeAtom } from '@/demo/atoms';
import useVideoEffect from '@/common/components/video/editor/useVideoEffect';
import { EffectIndex } from '@/common/components/video/effects/Effects';
import { WatsonHealth3DMprToggle } from '@carbon/icons-react';

export default function ToggleEffectsButton() {
    const tabIndex = useAtomValue(toolbarTabIndex);
    const isFirstClickMade = useAtomValue(isFirstClickMadeAtom);

    // When tabIndex == 0, enable only if at least one point has been selected
    // For other tabs, use the previous logic (disable during frame extraction or partial streaming)
    const isDisabled = tabIndex === 0 ? !isFirstClickMade : tabIndex < 1;

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
        <ActionButton
            message="Toggle Effects"
            onClick={toggleEffects}
            isDisabled={isDisabled}
            icon={WatsonHealth3DMprToggle}
            activeState={effectMode} // Pass effectMode to control styling
        />
    );
}