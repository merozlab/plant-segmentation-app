/**
 * Copyright (c) Meta Platforms, Inc.
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
import { getFileName } from '@/common/components/options/ShareUtils';
import {
  EncodingCompletedEvent,
  EncodingStateUpdateEvent,
} from '@/common/components/video/VideoWorkerBridge';
import useMessagesSnackbar from '@/common/components/snackbar/useMessagesSnackbar';
import useVideo from '@/common/components/video/editor/useVideo';
import { MP4ArrayBuffer } from 'mp4box';
import { useState } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai'; // Import useAtomValue
import { sessionAtom, erodeBorderAtom } from '@/demo/atoms'; // Import sessionAtom and erodeBorderAtom
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig'; // Import the constant

type DownloadingState = 'default' | 'started' | 'encoding' | 'completed';
type DownloadFormat = 'video' | 'frames';

// Global atoms for frame extraction modal
export const frameExtractionModalVisibleAtom = atom(false);
export const frameExtractionProgressAtom = atom(0);
// Global atom to track if frame extraction is in progress
export const isFrameExtractionInProgressAtom = atom(false);

type State = {
  state: DownloadingState;
  progress: number;
  download: (shouldSave?: boolean, format?: DownloadFormat) => Promise<MP4ArrayBuffer>;
};

export default function useDownloadVideo(): State {
  const [downloadingState, setDownloadingState] =
    useState<DownloadingState>('default');
  const [progress, setProgress] = useState<number>(0);
  const [] = useAtom(frameExtractionModalVisibleAtom); // Keep setModalVisible if needed elsewhere
  const [, setModalProgress] = useAtom(frameExtractionProgressAtom);
  const [, setFrameExtractionInProgress] = useAtom(isFrameExtractionInProgressAtom);
  const { enqueueMessage, clearMessage } = useMessagesSnackbar();
  const session = useAtomValue(sessionAtom); // Get session state
  const erodeBorder = useAtomValue(erodeBorderAtom); // Get erode border state

  const video = useVideo();

  async function download(shouldSave = true, format: DownloadFormat = 'video'): Promise<MP4ArrayBuffer> {
    // For frame downloads, we don't need video encoding at all
    if (format === 'frames') {
      return new Promise(async (resolve) => {
        if (downloadingState === 'default' || downloadingState === 'completed') {
          setDownloadingState('started');
          
          try {
            await saveVideoAsFrames();
            setDownloadingState('completed');
            // Return empty buffer since we don't actually encode video for frames
            resolve(new ArrayBuffer(0) as MP4ArrayBuffer);
          } catch (error) {
            setDownloadingState('default');
            enqueueMessage(
              '❌ Error downloading frames. Please try again.',
              { type: 'warning', expire: true, duration: 5000 }
            );
            console.error('Frame download error:', error);
            resolve(new ArrayBuffer(0) as MP4ArrayBuffer);
          }
        }
      });
    }

    // For video downloads, check WebCodecs support first
    if (typeof VideoEncoder === 'undefined') {
      enqueueMessage(
        '❌ Video encoding is not supported in your browser. Please try downloading frames instead.',
        { type: 'warning', expire: true, duration: 7000 }
      );
      return Promise.resolve(new ArrayBuffer(0) as MP4ArrayBuffer);
    }

    // Original video encoding logic
    return new Promise(resolve => {
      function onEncodingStateUpdate(event: EncodingStateUpdateEvent) {
        setDownloadingState('encoding');
        setProgress(event.progress);
      }

      function onEncodingComplete(event: EncodingCompletedEvent) {
        const file = event.file;

        if (shouldSave) {
          saveVideo(file, getFileName());
          video?.removeEventListener('encodingCompleted', onEncodingComplete);
          video?.removeEventListener('encodingStateUpdate', onEncodingStateUpdate);
          setDownloadingState('completed');
          resolve(file);
        } else {
          video?.removeEventListener('encodingCompleted', onEncodingComplete);
          video?.removeEventListener('encodingStateUpdate', onEncodingStateUpdate);
          setDownloadingState('completed');
          resolve(file);
        }
      }

      function onEncodingError() {
        video?.removeEventListener('encodingCompleted', onEncodingComplete);
        video?.removeEventListener('encodingStateUpdate', onEncodingStateUpdate);
        video?.removeEventListener('error', onEncodingError);
        setDownloadingState('default');
        enqueueMessage(
          '❌ Video encoding failed. This may be due to browser limitations or video resolution. Try downloading frames instead.',
          { type: 'warning', expire: true, duration: 7000 }
        );
        resolve(new ArrayBuffer(0) as MP4ArrayBuffer);
      }

      video?.addEventListener('encodingStateUpdate', onEncodingStateUpdate);
      video?.addEventListener('encodingCompleted', onEncodingComplete);
      video?.addEventListener('error', onEncodingError);

      if (downloadingState === 'default' || downloadingState === 'completed') {
        setDownloadingState('started');
        video?.pause();
        
        try {
          video?.encode();
        } catch (error) {
          console.error('Video encoding error:', error);
          onEncodingError();
        }
      }
    });
  }

  function saveVideo(file: MP4ArrayBuffer, fileName: string) {
    const blob = new Blob([file]);
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    document.body.appendChild(a);
    a.setAttribute('href', url);
    a.setAttribute('download', fileName);
    a.setAttribute('target', '_self');
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async function saveVideoAsFrames() {

    if (!session?.id) {
      enqueueMessage('❌ Error: No active session found.', { type: 'warning' });
      setFrameExtractionInProgress(false);
      return;
    }

    const sessionId = session.id;

    // Mark process as in progress
    setFrameExtractionInProgress(true);
    setProgress(10); // Initial progress
    setModalProgress(10);

    // Show a message using the snackbar
    enqueueMessage(
      "⏳ Generating masks on the server. Please keep this window open...",
      {
        expire: false,
        showClose: false,
        type: 'info',
        duration: 0
      }
    );

    try {
      // Call the /zip endpoint using the constant
      const response = await fetch(`${VIDEO_API_ENDPOINT}/zip`, { // Use the imported constant
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          erode: erodeBorder
        }),
      });

      setProgress(70); // Progress after fetch call initiated
      setModalProgress(70);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      // Get the zip file as a blob
      const zipBlob = await response.blob();
      setProgress(90);
      setModalProgress(90);

      if (zipBlob.size < 100) { // Basic check if the zip seems valid
        throw new Error(`Received ZIP file appears empty or invalid: ${zipBlob.size} bytes`);
      }

      // Create download link for the zip file
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.href = zipUrl;
      // Use session ID for the filename, matching backend logic
      a.download = `${sessionId}_masks.zip`;
      a.click();

      setProgress(100);
      setModalProgress(100);

      // Clear the processing message and show success
      clearMessage();
      enqueueMessage(
        "✅ Masks generated! Your ZIP file is downloading.",
        { type: 'info', expire: true, duration: 5000 }
      );

      // Mark process as complete
      setFrameExtractionInProgress(false);

      // Clean up the URL object after a short delay
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(zipUrl);
      }, 100);

    } catch (error) {
      // Clear the processing message and show error
      clearMessage();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during mask generation/download';
      enqueueMessage(
        `❌ Error generating/downloading masks: ${errorMessage}`,
        { type: 'warning', expire: true, duration: 7000 }
      );

      // Mark process as complete even on error
      setFrameExtractionInProgress(false);
      setProgress(0); // Reset progress on error
      setModalProgress(0);

      console.error("Error in saveVideoAsFrames (maskify call):", error);
      // Optionally re-throw or handle further if needed
    }
  }

  return { download, progress, state: downloadingState };
}
