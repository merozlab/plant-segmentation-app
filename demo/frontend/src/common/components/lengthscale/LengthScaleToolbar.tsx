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
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { Button } from 'react-daisyui';
import { ChevronLeft, ChevronRight } from '@carbon/icons-react';
import PrimaryCTAButton from '@/common/components/button/PrimaryCTAButton';
import {
    OBJECT_TOOLBAR_INDEX,
    DOWNLOAD_TOOLBAR_INDEX,
} from '@/common/components/toolbar/ToolbarConfig';
import {
    isLengthScaleEnabledAtom,
    lengthScaleStartPointAtom,
    lengthScaleEndPointAtom,
    lengthScaleMetersAtom,
    lengthScalePixelsAtom,
    pixelsToMetersRatioAtom,
    isLengthScaleSetAtom,
    sessionAtom,
    originalFilePathAtom,
} from '@/demo/atoms';
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import ToolbarHeaderWrapper from '@/common/components/toolbar/ToolbarHeaderWrapper';
import { useMemo, useState, useCallback, useEffect } from 'react';

type Props = {
    onTabChange: (newIndex: number) => void;
};

export default function LengthScaleToolbar({ onTabChange }: Props) {
    const [isLengthScaleEnabled, setIsLengthScaleEnabled] = useAtom(isLengthScaleEnabledAtom);
    const [lengthScaleStartPoint, setLengthScaleStartPoint] = useAtom(lengthScaleStartPointAtom);
    const [lengthScaleEndPoint, setLengthScaleEndPoint] = useAtom(lengthScaleEndPointAtom);
    const [lengthScaleMeters, setLengthScaleMeters] = useAtom(lengthScaleMetersAtom);
    const [isLengthScaleSet, setIsLengthScaleSet] = useAtom(isLengthScaleSetAtom);
    const lengthScalePixels = useAtomValue(lengthScalePixelsAtom);
    const pixelsToMetersRatio = useAtomValue(pixelsToMetersRatioAtom);
    const session = useAtomValue(sessionAtom);
    const originalFilePath = useAtomValue(originalFilePathAtom);
    const setMasksReady = useSetAtom(masksReadyAtom);
    const { enqueueMessage, clearMessage } = useMessagesSnackbar();
    const [isLoading, setIsLoading] = useState(false);

    // Local state for the input to handle typing better
    const [inputValue, setInputValue] = useState(lengthScaleMeters.toString());

    // Handle input change without immediately constraining the value
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setInputValue(newValue);

        // Only update the atom if the value is a valid positive number
        const numValue = parseFloat(newValue);
        if (!isNaN(numValue) && numValue > 0) {
            setLengthScaleMeters(Math.max(0.001, numValue));
        }
    };

    // Handle input blur to ensure we have a valid value
    const handleInputBlur = () => {
        const numValue = parseFloat(inputValue);
        if (isNaN(numValue) || numValue <= 0) {
            // Reset to minimum valid value if invalid
            const validValue = 0.001;
            setInputValue(validValue.toString());
            setLengthScaleMeters(validValue);
        } else {
            // Ensure minimum value
            const constrainedValue = Math.max(0.001, numValue);
            setInputValue(constrainedValue.toString());
            setLengthScaleMeters(constrainedValue);
        }
    };

    // Automatically enable length scale mode when the toolbar is mounted
    useEffect(() => {
        if (!isLengthScaleEnabled) {
            setIsLengthScaleEnabled(true);
            enqueueMessage('lengthScaleEnabled');
        }
    }, [isLengthScaleEnabled, setIsLengthScaleEnabled, enqueueMessage]); // Add dependencies

    const isLineDrawn = lengthScaleStartPoint && lengthScaleEndPoint;
    const canSetLengthScale = isLineDrawn && lengthScaleMeters > 0 && !isLengthScaleSet;
    const hasStartedProcess = lengthScaleStartPoint || lengthScaleEndPoint;
    const canProceedToNext = !hasStartedProcess || isLengthScaleSet; // Can proceed if not started OR completed

    const handleBack = () => {
        // If length scale is not set but points are drawn, warn the user
        if (isLineDrawn && !isLengthScaleSet) {
            const confirmed = window.confirm(
                'You have started setting a length scale but haven\'t saved it yet. Going back will lose your progress. Are you sure?'
            );
            if (!confirmed) {
                return;
            }
        }

        // Reset the length scale state when going back if not set
        if (!isLengthScaleSet) {
            setIsLengthScaleEnabled(false);
            setLengthScaleStartPoint(null);
            setLengthScaleEndPoint(null);
            setIsLengthScaleSet(false);
        }
        onTabChange(OBJECT_TOOLBAR_INDEX);
    };

    const handleNext = useCallback(async () => {
        if (!session?.id) {
            enqueueMessage('noActiveSession');
            return;
        }

        // If no length scale is set and user hasn't started the process, show warning message
        if (!isLengthScaleSet && !hasStartedProcess) {
            enqueueMessage('proceedingWithoutLengthScale');
        }

        setIsLoading(true);

        try {
            // Call the /maskify endpoint to generate masks
            const response = await fetch(`${VIDEO_API_ENDPOINT}/maskify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ session_id: session.id, safe_folder_name: originalFilePath }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Maskify request failed: ${response.status} - ${errorText}`);
            }

            clearMessage();
            setMasksReady(true);
            onTabChange(DOWNLOAD_TOOLBAR_INDEX);
        } catch (error) {
            clearMessage();
            enqueueMessage('maskGenerationFailure');
        } finally {
            setIsLoading(false);
        }
    }, [session, originalFilePath, onTabChange, enqueueMessage, clearMessage, setMasksReady, isLengthScaleSet, hasStartedProcess]);

    const handleClearLengthScale = () => {
        setLengthScaleStartPoint(null);
        setLengthScaleEndPoint(null);
        setIsLengthScaleEnabled(false);
        setIsLengthScaleSet(false);
    };

    const handleSetLengthScale = () => {
        if (isLineDrawn && lengthScaleMeters > 0) {
            setIsLengthScaleSet(true);
            enqueueMessage('lengthScaleSet');
        }
    };

    const statusText = useMemo(() => {
        if (!lengthScaleStartPoint) {
            return 'Click on the video to set the first point, or skip to proceed with pixel measurements';
        }
        if (!lengthScaleEndPoint) {
            return 'Click on the video to set the second point, or clear to cancel';
        }
        if (!isLengthScaleSet) {
            return 'Enter the real-world length and click "Set Length Scale", or clear to cancel';
        }
        return 'Length scale set successfully - ready to proceed';
    }, [lengthScaleStartPoint, lengthScaleEndPoint, isLengthScaleSet]);

    return (
        <div className="flex flex-col h-full">
            <ToolbarHeaderWrapper
                title="Set Length Scale (Optional)"
                description="Click on the video to define a measurement reference, or skip to use pixel measurements"
                className="pb-4"
            />

            {/* Status and Instructions */}
            <div className="p-5 md:p-8 border-b border-graydark-600">
                <div className="flex flex-col gap-3">
                    <div className={`text-sm ${isLengthScaleSet ? 'text-green-400' : isLineDrawn ? 'text-yellow-400' : 'text-blue-400'}`}>
                        {isLengthScaleSet ? '✓ ' : isLineDrawn ? '• ' : '• '}
                        {statusText}
                    </div>

                    {isLineDrawn && (
                        <div className="text-xs text-gray-400">
                            Line length: {lengthScalePixels?.toFixed(1)} pixels
                        </div>
                    )}
                </div>
            </div>

            {/* Length Input */}
            {isLineDrawn && (
                <div className="p-5 md:p-8 border-b border-graydark-600">
                    <div className="flex flex-col gap-2">
                        <label className="text-white text-sm font-medium">
                            Real-world length (meters)
                        </label>
                        <input
                            type="number"
                            value={inputValue}
                            onChange={handleInputChange}
                            onBlur={handleInputBlur}
                            min={0.001}
                            step={0.001}
                            className="input input-bordered w-full max-w-xs bg-graydark-700 text-white border-graydark-500 focus:border-primary"
                        />
                        <span className="text-gray-400 text-xs">
                            How long is this line in real life?
                        </span>
                        {pixelsToMetersRatio && (
                            <div className="text-xs text-green-400 mt-2">
                                Conversion ratio: {(1 / pixelsToMetersRatio).toFixed(2)} pixels/meter
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Action Buttons Row */}
            {hasStartedProcess && (
                <div className="p-5 md:p-8 border-b border-graydark-600">
                    <div className="flex gap-3">
                        {!isLengthScaleSet && (
                            <Button
                                color="primary"
                                onClick={handleSetLengthScale}
                                disabled={!canSetLengthScale}
                                className="flex-1"
                            >
                                Set Length Scale
                            </Button>
                        )}
                        <Button
                            color="ghost"
                            onClick={handleClearLengthScale}
                            className={`border border-graydark-500 hover:border-graydark-400 ${isLengthScaleSet ? 'flex-1' : 'flex-1'}`}
                        >
                            Clear length scale
                        </Button>
                    </div>
                </div>
            )}

            {/* Skip Length Scale Info */}
            {!hasStartedProcess && (
                <div className="p-5 md:p-8 border-b border-graydark-600">
                    <div className="bg-graydark-700 p-3 rounded-lg">
                        <div className="text-xs text-gray-300 mb-1">
                            <strong>Skip length scale:</strong>
                        </div>
                        <div className="text-xs text-gray-400">
                            You can proceed without setting a length scale. Centerlines will be calculated in pixels instead of meters.
                        </div>
                    </div>
                </div>
            )}

            {/* Spacer to push buttons to the bottom */}
            <div className="flex-grow"></div>

            {/* Bottom Navigation Buttons */}
            <div className="flex justify-between p-4 border-t border-graydark-600">
                <Button
                    color="ghost"
                    onClick={handleBack}
                    disabled={isLoading}
                    className="!px-4 !rounded-full font-medium text-white hover:bg-black"
                    startIcon={<ChevronLeft />}>
                    Objects
                </Button>
                <PrimaryCTAButton
                    onClick={handleNext}
                    disabled={isLoading || !canProceedToNext}
                    endIcon={<ChevronRight />}>
                    {isLoading ? 'Creating masks...' : 'Download'}
                </PrimaryCTAButton>
            </div>
        </div>
    );
}
