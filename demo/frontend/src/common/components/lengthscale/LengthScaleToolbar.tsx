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

import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { Button } from 'react-daisyui';
import { ChevronRight, Download } from '@carbon/icons-react';
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
    originalFilenameAtom,
} from '@/demo/atoms';
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import ToolbarHeaderWrapper from '@/common/components/toolbar/ToolbarHeaderWrapper';
import ToolbarBottomActionsWrapper from '../toolbar/ToolbarBottomActionsWrapper';
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
    const originalFilename = useAtomValue(originalFilenameAtom);
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
            setLengthScaleMeters(numValue);
        }
    };

    // Handle input blur to ensure we have a valid value
    const handleInputBlur = () => {
        const numValue = parseFloat(inputValue);
        if (isNaN(numValue) || numValue <= 0) {
            setInputValue('1');
            setLengthScaleMeters(1);
        } else {
            setInputValue(numValue.toString());
            setLengthScaleMeters(numValue);
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

    const handleDownloadConversion = () => {
        if (!pixelsToMetersRatio) {
            return;
        }

        // Create the text content
        const textContent = [
            'Pixel to Meter Conversion',
            '=========================',
            '',
            `Pixels measured: ${lengthScalePixels?.toFixed(2)} px`,
            `Real-world length: ${lengthScaleMeters} m`,
            '',
            `Conversion ratio: ${pixelsToMetersRatio.toFixed(6)} meters/pixel`,
            `Inverse ratio: ${(1 / pixelsToMetersRatio).toFixed(2)} pixels/meter`,
            '',
            `Generated: ${new Date().toISOString()}`,
        ].join('\n');

        // Create blob and download
        const blob = new Blob([textContent], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        // Generate filename with format: {filename}_{datetime}_conversion.txt
        const datetime = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: YYYY-MM-DDTHH-MM-SS
        const baseFilename = originalFilename || session?.id || 'video'; // Fallback to sessionId or 'video' if no original filename
        const filename = `${baseFilename}_${datetime}_conversion.txt`;
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
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

            {/* Length Conversion Interface */}
            {isLineDrawn && (
                <div className="pt-5 px-5 md:pt-8 md:px-8">
                    <div className="flex flex-col gap-4">

                        <div className="flex items-center gap-3">
                            {/* Pixels Input (Disabled) */}
                            <div className="flex-1">
                                <label className="text-gray-400 text-xs font-medium mb-1 block">
                                    Pixels
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={lengthScalePixels?.toFixed(1) || '0'}
                                        disabled
                                        className="input input-bordered w-full bg-graydark-800 text-black border-graydark-600 cursor-not-allowed"
                                    />
                                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-500">
                                        px
                                    </div>
                                </div>
                            </div>

                            {/* Equals Symbol */}
                            <div className="text-gray-400 text-lg font-bold pt-6">
                                =
                            </div>

                            {/* Meters Input (Editable) */}
                            <div className="flex-1">
                                <label className="text-white text-xs font-medium mb-1 block">
                                    Real-world length
                                </label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={inputValue}
                                        onChange={handleInputChange}
                                        onBlur={handleInputBlur}
                                        step="any"
                                        placeholder="1"
                                        className="input input-bordered w-full bg-graydark-700 text-white border-graydark-500 focus:border-primary"
                                    />
                                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-400">
                                        m
                                    </div>
                                </div>
                            </div>


                        </div>

                    </div>
                </div>
            )}

            {/* Action Buttons Row */}
            {hasStartedProcess && (
                <div className="pt-5 px-5 md:pt-8 md:px-8">
                    <div className="flex gap-3">
                        {!isLengthScaleSet && pixelsToMetersRatio && (
                            <Button
                                color="primary"
                                onClick={handleSetLengthScale}
                                disabled={!canSetLengthScale}
                                className="flex-3"
                            >
                                Set Length Scale {(1 / pixelsToMetersRatio).toFixed(2)} pixels/meter
                            </Button>
                        )}
                        <Button
                            color="ghost"
                            onClick={handleClearLengthScale}
                            className={`border border-graydark-500 hover:border-graydark-400 ${isLengthScaleSet ? 'flex-1' : 'flex-1'}`}
                        >
                            Clear
                        </Button>
                    </div>
                </div>
            )}

            {/* Download Conversion Button - Only show when length scale is set */}
            {isLengthScaleSet && pixelsToMetersRatio && (
                <div className="px-5 md:px-8 pt-3">
                    <Button
                        color="ghost"
                        onClick={handleDownloadConversion}
                        className="w-full border border-graydark-500 hover:border-graydark-400"
                        startIcon={<Download />}
                    >
                        Download Conversion (.txt)
                    </Button>
                </div>
            )}

            {/* Status and Instructions */}
            <div className="pt-5 px-5 md:pt-8 md:px-8">
                <div className="flex flex-col gap-3">
                    <div className={`text-sm ${isLengthScaleSet ? 'text-green-400' : isLineDrawn ? 'text-yellow-400' : 'text-blue-400'}`}>
                        {isLengthScaleSet ? '✓ ' : isLineDrawn ? '• ' : '• '}
                        {statusText}
                    </div>
                </div>
            </div>

            {/* Skip Length Scale Info */}
            {!hasStartedProcess && (
                <div className="p-5 md:p-8">
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
            <ToolbarBottomActionsWrapper>
                <RestartSessionButton
                    onRestartSession={() => onTabChange(OBJECT_TOOLBAR_INDEX)}
                />
                <PrimaryCTAButton
                    onClick={handleNext}
                    disabled={isLoading || !canProceedToNext}
                    endIcon={<ChevronRight />}>
                    {isLoading ? 'Creating masks...' : 'Download'}
                </PrimaryCTAButton>
            </ToolbarBottomActionsWrapper>
        </div>
    );
}
