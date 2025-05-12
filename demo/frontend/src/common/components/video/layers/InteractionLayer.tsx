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
import useVideo from '@/common/components/video/editor/useVideo';
import { getPointInImage } from '@/common/components/video/editor/VideoEditorUtils';
import { SegmentationPoint } from '@/common/tracker/Tracker';
import { labelTypeAtom } from '@/demo/atoms';
import stylex from '@stylexjs/stylex';
import { useAtomValue } from 'jotai';
import { MouseEvent, useRef, useEffect } from 'react';
import { useTransformContext } from 'react-zoom-pan-pinch';

const styles = stylex.create({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  },
});

type Props = {
  onPoint: (point: SegmentationPoint) => void;
};

export default function InteractionLayer({ onPoint }: Props) {
  const video = useVideo();
  // Use labelType to swap positive and negative points. The most important use
  // case is the switch between positive and negative label for left mouse
  // clicks.
  const labelType = useAtomValue(labelTypeAtom);
  const transformContext = useTransformContext();

  // Create a ref to track the latest transform state
  const latestTransformState = useRef(transformContext.transformState);

  // Update our ref whenever the transform state changes
  useEffect(() => {
    latestTransformState.current = transformContext.transformState;
  }, [transformContext.transformState]);

  // Handler function for clicks
  const handleClick = (event: MouseEvent<HTMLDivElement>, isRightClick = false) => {
    const canvas = video?.getCanvas();
    if (canvas == null) return;

    // Always get the most up-to-date transform state directly from the context
    // This ensures we have the latest values even if the effect hasn't run yet
    const currentTransform = transformContext.transformState;

    // Also check our ref as a backup
    const refTransform = latestTransformState.current;

    // Use the context values first, fall back to ref if needed
    const scale = currentTransform.scale || refTransform.scale;
    const positionX = currentTransform.positionX || refTransform.positionX;
    const positionY = currentTransform.positionY || refTransform.positionY;

    const point = getPointInImage(event, canvas, false, {
      transformScale: scale,
      translateX: positionX,
      translateY: positionY,
    });

    onPoint([point[0], point[1], isRightClick ?
      (labelType === 'positive' ? 0 : 1) :
      (labelType === 'positive' ? 1 : 0)]);
  };

  return (
    <div
      {...stylex.props(styles.container)}
      onClick={(event) => handleClick(event)}
      onContextMenu={event => {
        event.preventDefault();
        handleClick(event, true);
      }}
    />
  );
}
