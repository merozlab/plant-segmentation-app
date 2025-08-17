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
import { EnqueueOption } from '@/common/components/snackbar/useMessagesSnackbar';

export type MessageOptions = EnqueueOption & {
  repeat?: boolean;
};

type MessageEvent = {
  text: string;
  shown: boolean;
  action?: Element;
  options?: MessageOptions;
};

export interface MessagesEventMap {
  startSession: MessageEvent;
  firstClick: MessageEvent;
  pointClick: MessageEvent;
  addObjectClick: MessageEvent;
  trackAndPlayClick: MessageEvent;
  trackAndPlayComplete: MessageEvent;
  trackAndPlayThrottlingWarning: MessageEvent;
  effectsMessage: MessageEvent;
  maskGenerationStart: MessageEvent;
  maskGenerationSuccess: MessageEvent;
  maskGenerationFailure: MessageEvent;
  noActiveSession: MessageEvent;
  centerlineSuccess: MessageEvent;
  centerlineError: MessageEvent;
  centerlineInstructions: MessageEvent;
  basePointSet: MessageEvent;
  selectNextBasePoint: MessageEvent;
  allBasePointsSet: MessageEvent;
  basepointsError: MessageEvent;
  // download success and error for centerlines CSV
  centerlineDownloadSuccess: MessageEvent;
  centerlineDownloadError: MessageEvent;
  centerlineConversionError: MessageEvent;
  // length scale messages
  lengthScaleEnabled: MessageEvent;
  lengthScaleSet: MessageEvent;
  proceedingWithoutLengthScale: MessageEvent;
  videoCropError: MessageEvent;
}

export const defaultMessageMap: MessagesEventMap = {
  startSession: {
    text: 'Starting session',
    shown: false,
    options: { type: 'loading', showClose: false, repeat: true, duration: 2000 },
  },
  firstClick: {
    text: '!!!!! Tip: Click on any object in the video to get started.',
    shown: false,
    options: { expire: false, repeat: false },
  },
  pointClick: {
    text: 'Tip: Not what you expected? Add a few more clicks until the full object you want is selected.',
    shown: false,
    options: { expire: false, repeat: false },
  },
  addObjectClick: {
    text: 'Tip: Add a new object by clicking on it in the video.',
    shown: false,
    options: { expire: false, repeat: false },
  },
  trackAndPlayClick: {
    text: 'Hang tight while your objects are tracked! Stop tracking at any point to adjust your selections if the tracking doesn’t look right.',
    shown: false,
    options: { expire: false, repeat: false },
  },
  trackAndPlayComplete: {
    text: 'Tip: You can fix tracking issues by going back to the frames where tracking is not quite right and adding or removing clicks.',
    shown: false,
    options: { expire: false, repeat: false },
  },
  trackAndPlayThrottlingWarning: {
    text: 'Looks like you have clicked the tracking button a bit too often! To keep things running smoothly, we have temporarily disabled the button.',
    shown: false,
    options: { repeat: true },
  },
  effectsMessage: {
    text: 'Tip: If you aren’t sure where to get started, click “Surprise Me” to apply a surprise effect to your video.',
    shown: false,
    options: { expire: false, repeat: false },
  },
  maskGenerationStart: {
    text: 'Generating masks on the server. Please keep this window open...',
    shown: false,
    options: { expire: false, showClose: false, type: 'info', duration: 0, repeat: true },
  },
  maskGenerationSuccess: {
    text: '✓ Masks generated successfully!',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: true },
  },
  maskGenerationFailure: {
    text: '✗ Failed to generate masks. Please try again.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 7000, repeat: true },
  },
  // Show when centerlines CSV zip has downloaded successfully
  centerlineDownloadSuccess: {
    text: '✓ Centerlines CSV downloaded successfully.',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: false },
  },
  // Show when centerlines CSV zip download fails
  centerlineDownloadError: {
    text: '✗ Failed to download centerlines CSV.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 7000, repeat: false },
  },
  // Show when meter conversion fails
  centerlineConversionError: {
    text: '✗ Failed to convert centerlines to meters. Check length scale setting.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 7000, repeat: false },
  },
  noActiveSession: {
    text: '✗ No active session found. Please try again.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 5000, repeat: true },
  },
  centerlineSuccess: {
    text: '✓ Centerlines generated successfully!',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: true },
  },
  centerlineError: {
    text: '✗ Failed to generate centerlines. Please try again.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 7000, repeat: true },
  },
  centerlineInstructions: {
    text: 'Select base points for each plant object by clicking on the video frame. We recommend selecting the base (bottom) of the plant stem.',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: true },
  },
  basePointSet: {
    text: '✓ Base point set successfully!',
    shown: false,
    options: { type: 'info', expire: true, duration: 3000, repeat: true },
  },
  selectNextBasePoint: {
    text: 'Now select a base point for the next object.',
    shown: false,
    options: { type: 'info', expire: true, duration: 4000, repeat: true },
  },
  allBasePointsSet: {
    text: '✓ All base points are set! You can now extract centerlines.',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: true },
  },
  basepointsError: {
    text: '✗ Failed to set base point. Please try again.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 7000, repeat: true },
  },
  lengthScaleEnabled: {
    text: 'Click two points in the video to draw a length scale reference line.',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: false },
  },
  lengthScaleSet: {
    text: '✓ Length scale has been set successfully.',
    shown: false,
    options: { type: 'info', expire: true, duration: 3000, repeat: false },
  },
  proceedingWithoutLengthScale: {
    text: 'Proceeding without length scale - centerlines will be calculated in pixels.',
    shown: false,
    options: { type: 'info', expire: true, duration: 5000, repeat: false },
  },
  videoCropError: {
    text: '✗ Video crop operation failed. Please check the error details.',
    shown: false,
    options: { type: 'warning', expire: true, duration: 7000, repeat: true },
  }
};
