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
import { useMemo, useState, useEffect } from 'react';
import useResizeObserver from 'use-resize-observer';
import useVideo from '../editor/useVideo';
import { useAtomValue } from 'jotai';
import { activeTrackletObjectIdAtom, trackletObjectsAtom } from '@/demo/atoms';
import React from 'react';
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

export function BasePointsLayer({ points, onRemovePoint }: Props) {
  const video = useVideo();
  const videoCanvas = useMemo(() => video?.getCanvas(), [video]);
  const [forceUpdateCounter, setForceUpdateCounter] = useState(0);

  // Get active tracklet ID and all tracklets
  const activeTrackletId = useAtomValue(activeTrackletObjectIdAtom);
  const tracklets = useAtomValue(trackletObjectsAtom);

  const {
    ref,
    width: containerWidth = 1,
    height: containerHeight = 1,
  } = useResizeObserver<SVGElement>();

  // Get the transform context for zoom state
  const canvasWidth = videoCanvas?.width ?? 1;
  const canvasHeight = videoCanvas?.height ?? 1;

  // Get transform context for zoom state
  const transformContext = useTransformContext();
  const { scale = 1 } = transformContext.transformState;

  // Subscribe to transform events to force immediate updates
  useEffect(() => {
    // Custom event name for zoom changes
    const ZOOM_EVENT = 'react-zoom-pan-pinch-zoom-update';

    // Handle any zoom or pan change
    const handleTransformChange = () => {
      console.log('BasePointsLayer: Transform changed, forcing update');
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

  const sizeMultiplier = useMemo(() => {
    const widthMultiplier = canvasWidth / containerWidth;
    const heightMultiplier = canvasHeight / containerHeight;

    return Math.max(widthMultiplier, heightMultiplier);
  }, [canvasWidth, canvasHeight, containerWidth, containerHeight]);  // This useEffect will run whenever forceUpdateCounter changes
  // It doesn't need to do anything - just the re-render is enough
  useEffect(() => {
    console.log(`BasePointsLayer forcing update #${forceUpdateCounter}, scale: ${scale}`);
  }, [forceUpdateCounter, scale]);

  // Adjust sizes based on zoom level (scale)
  const pointRadius = useMemo(() => {
    const baseSize = 4;
    const adjustedSize = baseSize / scale;
    console.log(`BasePointsLayer calculating pointRadius: ${adjustedSize} * ${sizeMultiplier} = ${adjustedSize * sizeMultiplier}`);
    return adjustedSize * sizeMultiplier;
  }, [scale, sizeMultiplier, forceUpdateCounter]); // Add forceUpdateCounter to force recalculation

  // Define stroke widths - regular for normal points, larger for active tracklet points
  const regularStrokeWidth = useMemo(() => {
    const baseSize = 2;
    const adjustedSize = baseSize / scale;
    return adjustedSize * sizeMultiplier;
  }, [scale, sizeMultiplier, forceUpdateCounter]); // Add forceUpdateCounter to force recalculation

  const activeStrokeWidth = useMemo(() => {
    const baseSize = 4;
    const adjustedSize = baseSize / scale;
    return adjustedSize * sizeMultiplier;
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
        // Check if this point belongs to the active tracklet
        // For BasePointsLayer, we compare coordinates with the basePoint of each tracklet
        let isActiveTrackletPoint = false;
        console.log('Active tracklet ID:', activeTrackletId);
        console.log('Tracklets:', tracklets);
        console.log('Point:', point);
        console.log('BasePoint:', tracklets.map(tracklet => tracklet.basePoint));
        // Find tracklet with matching basePoint
        for (const tracklet of tracklets) {
          if (tracklet.id === activeTrackletId && tracklet.basePoint && tracklet.basePoint.length > 0) {
            const basePoint = tracklet.basePoint[0];

            // Safely extract coordinates with proper type checking
            const baseX = basePoint && Array.isArray(basePoint) ? Number(basePoint[0]) : null;
            const baseY = basePoint && Array.isArray(basePoint) ? Number(basePoint[1]) : null;
            const pointX = Number(point[0]);
            const pointY = Number(point[1]);

            // Check if the coordinates match the current point
            if (baseX !== null && baseY !== null &&
              !isNaN(baseX) && !isNaN(baseY) &&
              !isNaN(pointX) && !isNaN(pointY) &&
              Math.abs(baseX - pointX) < 0.5 &&
              Math.abs(baseY - pointY) < 0.5) {
              isActiveTrackletPoint = true;
              break;
            }
          }
        }

        // All points are red, but active points have thicker stroke
        const strokeWidth = isActiveTrackletPoint ? activeStrokeWidth : regularStrokeWidth;
        console.log('Point:', point, 'isActiveTrackletPoint:', isActiveTrackletPoint);
        return (
          <g key={idx} className="cursor-pointer">
            <circle
              className="hover:stroke-gray-400"
              style={{ stroke: 'red' }}
              pointerEvents="visiblePainted"
              cx={Number(point[0])}
              cy={Number(point[1])}
              r={pointRadius}
              fill="rgba(0,0,0,0)"
              strokeWidth={strokeWidth}
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                onRemovePoint(point);
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
