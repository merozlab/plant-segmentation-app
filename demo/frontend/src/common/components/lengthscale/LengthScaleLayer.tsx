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
import { LengthScalePoint } from '@/demo/atoms';
import stylex from '@stylexjs/stylex';
import { useMemo, useEffect, useRef, useState } from 'react';
import useResizeObserver from 'use-resize-observer';
import useVideo from '../video/editor/useVideo';
import { useTransformContext } from 'react-zoom-pan-pinch';

const styles = stylex.create({
    container: {
        position: 'absolute',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
    },
});

type Props = {
    startPoint: LengthScalePoint | null;
    endPoint: LengthScalePoint | null;
    onRemovePoint: (point: LengthScalePoint) => void;
};

export function LengthScaleLayer({ startPoint, endPoint, onRemovePoint }: Props) {
    const video = useVideo();
    const videoCanvas = useMemo(() => video?.getCanvas(), [video]);
    const [forceUpdateCounter, setForceUpdateCounter] = useState(0);

    const {
        ref,
        width: containerWidth = 1,
        height: containerHeight = 1,
    } = useResizeObserver<SVGElement>();
    const transformContext = useTransformContext();

    // Create a ref to track the latest transform state
    const latestTransformState = useRef(transformContext.transformState);

    // Update our ref whenever the transform state changes
    useEffect(() => {
        latestTransformState.current = transformContext.transformState;
    }, [transformContext.transformState]);

    // Get the transform state directly from context
    const { scale = 1 } = transformContext.transformState;

    // Subscribe to transform events to force immediate updates (same as PointsLayer)
    useEffect(() => {
        // Custom event name for zoom changes
        const ZOOM_EVENT = 'react-zoom-pan-pinch-zoom-update';

        // Handle any zoom or pan change
        const handleTransformChange = () => {
            // Force component re-render
            setForceUpdateCounter(prev => prev + 1);
        };

        // Create a MutationObserver to watch for transform attribute changes
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' &&
                    (mutation.attributeName === 'style' || mutation.attributeName === 'transform')) {
                    handleTransformChange();
                }
            }
        });

        // Find the transform element
        const transformElement = document.querySelector('.react-transform-component');
        if (transformElement) {
            // Observe style and transform attribute changes
            observer.observe(transformElement, {
                attributes: true,
                attributeFilter: ['style', 'transform']
            });

            // Also listen for wheel events directly
            transformElement.addEventListener('wheel', handleTransformChange);
            transformElement.addEventListener('touchmove', handleTransformChange);
            // Additional event listeners for buttons
            document.addEventListener(ZOOM_EVENT, handleTransformChange);
        }

        return () => {
            // Clean up all observers and listeners
            observer.disconnect();

            if (transformElement) {
                transformElement.removeEventListener('wheel', handleTransformChange);
                transformElement.removeEventListener('touchmove', handleTransformChange);
            }

            document.removeEventListener(ZOOM_EVENT, handleTransformChange);
        };
    }, []);

    const canvasWidth = videoCanvas?.width ?? 1;
    const canvasHeight = videoCanvas?.height ?? 1;

    const sizeMultiplier = useMemo(() => {
        const widthMultiplier = canvasWidth / containerWidth;
        const heightMultiplier = canvasHeight / containerHeight;

        return Math.max(widthMultiplier, heightMultiplier);
    }, [canvasWidth, canvasHeight, containerWidth, containerHeight]);

    // This useEffect will run whenever forceUpdateCounter changes
    useEffect(() => {
    }, [forceUpdateCounter, scale]);

    // Adjust point size based on the current zoom level
    const pointRadius = useMemo(() => {
        const baseSize = 6;
        const adjustedSize = baseSize / scale;
        return adjustedSize * sizeMultiplier;
    }, [scale, sizeMultiplier, forceUpdateCounter]);

    const strokeWidth = useMemo(() => {
        const baseStroke = 2;
        const adjustedStroke = baseStroke / scale;
        return adjustedStroke * sizeMultiplier;
    }, [scale, sizeMultiplier, forceUpdateCounter]);

    const lineStrokeWidth = useMemo(() => {
        const baseStroke = 3;
        const adjustedStroke = baseStroke / scale;
        return adjustedStroke * sizeMultiplier;
    }, [scale, sizeMultiplier, forceUpdateCounter]);

    // Handle point click for removal
    const handlePointClick = (point: LengthScalePoint, event: React.MouseEvent) => {
        event.stopPropagation();
        onRemovePoint(point);
    };

    // Render the line if both points exist
    const renderLine = () => {
        if (!startPoint || !endPoint) return null;

        return (
            <g>
                <line
                    x1={startPoint[0]}
                    y1={startPoint[1]}
                    x2={endPoint[0]}
                    y2={endPoint[1]}
                    stroke="#10b981"
                    strokeWidth={lineStrokeWidth}
                    strokeDasharray={`${5 * sizeMultiplier},${5 * sizeMultiplier}`}
                />
                <circle
                    cx={startPoint[0]}
                    cy={startPoint[1]}
                    r={pointRadius}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth={strokeWidth}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                    onClick={(e) => handlePointClick(startPoint, e)}
                />
                <circle
                    cx={endPoint[0]}
                    cy={endPoint[1]}
                    r={pointRadius}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth={strokeWidth}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                    onClick={(e) => handlePointClick(endPoint, e)}
                />
            </g>
        );
    };

    // Render individual points
    const renderPoints = () => {
        const points = [];

        if (startPoint && !endPoint) {
            points.push(
                <circle
                    key="start"
                    cx={startPoint[0]}
                    cy={startPoint[1]}
                    r={pointRadius}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth={strokeWidth}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                    onClick={(e) => handlePointClick(startPoint, e)}
                />
            );
        }

        return points;
    };

    return (
        <svg
            ref={ref}
            {...stylex.props(styles.container)}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
            {/* Debug rect to verify SVG overlay (uncomment if needed) */}
            {/* <rect
                fill="rgba(255, 0, 255, 0.3)"
                width={canvasWidth}
                height={canvasHeight}
            /> */}
            {renderLine()}
            {renderPoints()}
        </svg>
    );
}
