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
import { SegmentationPoint } from '@/common/tracker/Tracker';
import stylex from '@stylexjs/stylex';
import { useMemo, useEffect, useRef, useState } from 'react';
import useResizeObserver from 'use-resize-observer';
import useVideo from '../editor/useVideo';
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
  points: SegmentationPoint[];
  onRemovePoint: (point: SegmentationPoint) => void;
};

export function PointsLayer({ points, onRemovePoint }: Props) {
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
    console.log('PointsLayer transform state updated:', transformContext.transformState);
  }, [transformContext.transformState]);

  // Get the transform state directly from context
  // This ensures we always have the most up-to-date values
  const { scale = 1 } = transformContext.transformState;

  // Subscribe to transform events to force immediate updates
  useEffect(() => {
    // Custom event name for zoom changes
    const ZOOM_EVENT = 'react-zoom-pan-pinch-zoom-update';

    // Handle any zoom or pan change
    const handleTransformChange = () => {
      console.log('Transform changed, forcing update');
      // Force component re-render
      setForceUpdateCounter(prev => prev + 1);
    };

    // Create a MutationObserver to watch for transform attribute changes
    // This is more reliable than trying to hook into the library's internal events
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

  console.log('Current scale in PointsLayer:', scale);
  const canvasWidth = videoCanvas?.width ?? 1;
  const canvasHeight = videoCanvas?.height ?? 1;

  const sizeMultiplier = useMemo(() => {
    const widthMultiplier = canvasWidth / containerWidth;
    const heightMultiplier = canvasHeight / containerHeight;

    return Math.max(widthMultiplier, heightMultiplier);
  }, [canvasWidth, canvasHeight, containerWidth, containerHeight]);  // This useEffect will run whenever forceUpdateCounter changes
  // It doesn't need to do anything - just the re-render is enough
  useEffect(() => {
    console.log(`PointsLayer forcing update #${forceUpdateCounter}, scale: ${scale}`);
  }, [forceUpdateCounter, scale]);

  // Adjust point size based on the current zoom level
  // When zoomed in (scale > 1), points should appear relatively smaller
  // When zoomed out (scale < 1), points should appear relatively larger
  const pointRadius = useMemo(() => {
    const baseSize = 8;
    const adjustedSize = baseSize / scale;
    console.log(`Calculating pointRadius: ${adjustedSize} * ${sizeMultiplier} = ${adjustedSize * sizeMultiplier}`);
    return adjustedSize * sizeMultiplier;
  }, [scale, sizeMultiplier, forceUpdateCounter]); // Add forceUpdateCounter to force recalculation

  const pointStroke = useMemo(() => {
    const baseStroke = 2;
    const adjustedStroke = baseStroke / scale;
    return adjustedStroke * sizeMultiplier;
  }, [scale, sizeMultiplier, forceUpdateCounter]); // Add forceUpdateCounter to force recalculation

  return (
    <svg
      ref={ref}
      {...stylex.props(styles.container)}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
      {/*
       * This is a debug element to verify the SVG element overlays
       * perfectly with the canvas element.
       */}
      {/*
      <rect
        fill="rgba(255, 255, 0, 0.5)"
        width={decodedVideo?.width}
        height={decodedVideo?.height}
      />
      */}
      {/* Render points */}
      {points.map((point, idx) => {
        const isAdd = point[2] === 1;
        return (
          <g key={idx} className="cursor-pointer">
            <circle
              className="stroke-white hover:stroke-gray-400"
              pointerEvents="visiblePainted"
              cx={point[0]}
              cy={point[1]}
              r={pointRadius}
              fill={isAdd ? '#000000' : '#E6193B'}
              strokeWidth={pointStroke}
              onClick={event => {
                event.stopPropagation();
                onRemovePoint(point);
              }}
            />
            <line
              x1={point[0] - pointRadius / 2}
              y1={point[1]}
              x2={point[0] + pointRadius / 2}
              y2={point[1]}
              strokeWidth={pointStroke}
              stroke="white"
            />
            {isAdd && (
              <line
                x1={point[0]}
                y1={point[1] - pointRadius / 2}
                x2={point[0]}
                y2={point[1] + pointRadius / 2}
                strokeWidth={pointStroke}
                stroke="white"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
