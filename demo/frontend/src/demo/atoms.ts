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
import {
  defaultMessageMap,
  MessagesEventMap,
} from '@/common/components/snackbar/DemoMessagesSnackbarUtils';
import { Effects } from '@/common/components/video/effects/Effects';
import {
  DemoEffect,
  highlightEffects,
} from '@/common/components/video/effects/EffectUtils';
import {
  BaseTracklet,
  SegmentationPoint,
  StreamingState,
} from '@/common/tracker/Tracker';
import type { DataArray } from '@/jscocotools/mask';
import { atom } from 'jotai';

export type VideoData = {
  path: string;
  posterPath: string | null | undefined;
  url: string;
  posterUrl: string;
  width: number;
  height: number;
};

export const frameIndexAtom = atom<number>(0);

export const inputVideoAtom = atom<VideoData | null>(null);

// #####################
// SESSION
// #####################

export type Session = {
  id: string;
  ranPropagation: boolean;
};

export const sessionAtom = atom<Session | null>(null);

// Track whether user has edited masks after propagation completed
export const hasEditedMasksAfterPropagationAtom = atom<boolean>(false);

// #####################
// STREAMING/PLAYBACK
// #####################

export const isVideoLoadingAtom = atom<boolean>(false);

export const streamingStateAtom = atom<StreamingState>('none');

export const isPlayingAtom = atom<boolean>(false);

export const isStreamingAtom = atom<boolean>(false);

// #####################
// OBJECTS
// #####################

export type TrackletMask = {
  mask: DataArray;
  isEmpty: boolean;
};

export type TrackletObject = {
  id: number;
  color: string;
  thumbnail: string | null;
  points: SegmentationPoint[][];
  basePoint: SegmentationPoint[] | null;
  masks: TrackletMask[];
  isInitialized: boolean;
};

const MAX_NUMBER_TRACKLET_OBJECTS = 10;

export const activeTrackletObjectIdAtom = atom<number | null>(0);

export const activeTrackletObjectAtom = atom<BaseTracklet | null>(get => {
  const objectId = get(activeTrackletObjectIdAtom);
  const tracklets = get(trackletObjectsAtom);
  return tracklets.find(obj => obj.id === objectId) ?? null;
});

export const trackletObjectsAtom = atom<BaseTracklet[]>([]);

export const maxTrackletObjectIdAtom = atom<number>(get => {
  const tracklets = get(trackletObjectsAtom);
  return tracklets.reduce((prev, curr) => Math.max(prev, curr.id), 0);
});

export const isTrackletObjectLimitReachedAtom = atom<boolean>(
  get => get(trackletObjectsAtom).length >= MAX_NUMBER_TRACKLET_OBJECTS,
);

export const areTrackletObjectsInitializedAtom = atom<boolean>(get =>
  get(trackletObjectsAtom).every(obj => obj.isInitialized),
);

export const isFirstClickMadeAtom = atom(get => {
  const tracklets = get(trackletObjectsAtom);
  return tracklets.some(tracklet => tracklet.points.length > 0);
});

export const pointsAtom = atom<SegmentationPoint[]>(get => {
  const frameIndex = get(frameIndexAtom);
  const activeTracklet = get(activeTrackletObjectAtom);
  return activeTracklet?.points[frameIndex] ?? [];
});

export const basePointsAtom = atom<SegmentationPoint[]>([]);

// Atom to cache computed centerlines per object per frame
// Structure: { [objectId]: { [frameIndex]: Array<[x, y]> } }
export const centerlinesAtom = atom<Record<number, Record<number, [number, number][]>>>(
  {}
);

export const labelTypeAtom = atom<'positive' | 'negative'>('positive');

export const isAddObjectEnabledAtom = atom<boolean>(get => {
  const session = get(sessionAtom);
  const trackletsInitialized = get(areTrackletObjectsInitializedAtom);
  const isObjectLimitReached = get(isTrackletObjectLimitReachedAtom);

  // Allow adding objects if:
  // 1. Before propagation (ranPropagation is false), OR  
  // 2. After propagation (user can always edit masks after propagation)
  return (
    session != null &&
    trackletsInitialized &&
    !isObjectLimitReached
  );
});

export const codeEditorOpenedAtom = atom<boolean>(false);

export const tutorialVideoEnabledAtom = atom<boolean>(true);

// #####################
// Effects
// #####################

type EffectConfig = {
  name: keyof Effects;
  variant: number;
  numVariants: number;
};

export const activeBackgroundEffectAtom = atom<EffectConfig>({
  name: 'Original',
  variant: 0,
  numVariants: 0,
});

export const activeHighlightEffectAtom = atom<EffectConfig>({
  name: 'Overlay',
  variant: 0,
  numVariants: 0,
});

export const activeHighlightEffectGroupAtom =
  atom<DemoEffect[]>(highlightEffects);

// #####################
// Toolbar
// #####################

export const toolbarTabIndex = atom<number>(0);

// #####################
// Messages snackbar
// #####################

export const messageMapAtom = atom<MessagesEventMap>(defaultMessageMap);

// #####################
// Upload state
// #####################

export const uploadingStateAtom = atom<'default' | 'uploading' | 'error'>(
  'default',
);

export const uploadErrorMessageAtom = atom<string | null>(null);

export const originalFilePathAtom = atom<string | null>(null);

// #####################
// Centerline algorithm
// #####################

export const centerlineAlgorithmAtom = atom<'edge' | 'full' | 'skeletonize'>('edge');

export const centerlinePointsAtom = atom<number>(100);

export const centerlineUnitsAtom = atom<'pixels' | 'meters'>('pixels');

// #####################
// Length Scale
// #####################

export type LengthScalePoint = [number, number];

export const isLengthScaleEnabledAtom = atom<boolean>(false);

export const lengthScaleStartPointAtom = atom<LengthScalePoint | null>(null);

export const lengthScaleEndPointAtom = atom<LengthScalePoint | null>(null);

export const lengthScaleMetersAtom = atom<number>(1);

export const lengthScalePixelsAtom = atom<number | null>(get => {
  const startPoint = get(lengthScaleStartPointAtom);
  const endPoint = get(lengthScaleEndPointAtom);

  if (!startPoint || !endPoint) {
    return null;
  }

  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];
  return Math.sqrt(dx * dx + dy * dy);
});

export const pixelsToMetersRatioAtom = atom<number | null>(get => {
  const pixels = get(lengthScalePixelsAtom);
  const meters = get(lengthScaleMetersAtom);

  if (!pixels || pixels === 0) {
    return null;
  }

  return meters / pixels;
});

export const isLengthScaleSetAtom = atom<boolean>(false);

// #####################
// Mask Download Options
// #####################

export const erodeBorderAtom = atom<boolean>(true);

// #####################
