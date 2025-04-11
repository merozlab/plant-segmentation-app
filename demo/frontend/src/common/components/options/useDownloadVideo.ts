/**
 * Copyright (c) Meta Platforms, Inc.   const [downloadingState, setDownloadingState] =
    useState<DownloadingState>('default');
  const [progress, setProgress] = useState<number>(0);
  const [, setModalVisible] = useAtom(frameExtractionModalVisibleAtom);
  const [, setModalProgress] = useAtom(frameExtractionProgressAtom);
  const [, setFrameExtractionInProgress] = useAtom(isFrameExtractionInProgressAtom);
  const { enqueueMessage, clearMessage } = useMessagesSnackbar();

  const video = useVideo();liates.
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
import {getFileName} from '@/common/components/options/ShareUtils';
import {
  EncodingCompletedEvent,
  EncodingStateUpdateEvent,
} from '@/common/components/video/VideoWorkerBridge';
import useMessagesSnackbar from '@/common/components/snackbar/useMessagesSnackbar';
import useVideo from '@/common/components/video/editor/useVideo';
import {MP4ArrayBuffer} from 'mp4box';
import {useState} from 'react';
import {atom, useAtom} from 'jotai';

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
  const [, ] = useAtom(frameExtractionModalVisibleAtom);
  const [, setModalProgress] = useAtom(frameExtractionProgressAtom);
  const [, setFrameExtractionInProgress] = useAtom(isFrameExtractionInProgressAtom);
  const { enqueueMessage, clearMessage } = useMessagesSnackbar();

  const video = useVideo();

  async function download(shouldSave = true, format: DownloadFormat = 'video'): Promise<MP4ArrayBuffer> {
    return new Promise(resolve => {
      function onEncodingStateUpdate(event: EncodingStateUpdateEvent) {
        setDownloadingState('encoding');
        setProgress(event.progress);
      }

      function onEncodingComplete(event: EncodingCompletedEvent) {
        const file = event.file;

        if (shouldSave) {
          if (format === 'video') {
            saveVideo(file, getFileName());
            video?.removeEventListener('encodingCompleted', onEncodingComplete);
            video?.removeEventListener('encodingStateUpdate', onEncodingStateUpdate);
            setDownloadingState('completed');
            resolve(file);
          } else if (format === 'frames') {
            // Keep the loading state active during frame extraction
            // Will be set to completed inside the saveVideoAsFrames function
            saveVideoAsFrames(file, getFileName()).finally(() => {
              video?.removeEventListener('encodingCompleted', onEncodingComplete);
              video?.removeEventListener('encodingStateUpdate', onEncodingStateUpdate);
              setDownloadingState('completed');
              resolve(file);
            });
          }
        } else {
          video?.removeEventListener('encodingCompleted', onEncodingComplete);
          video?.removeEventListener('encodingStateUpdate', onEncodingStateUpdate);
          setDownloadingState('completed');
          resolve(file);
        }
      }

      video?.addEventListener('encodingStateUpdate', onEncodingStateUpdate);
      video?.addEventListener('encodingCompleted', onEncodingComplete);

      if (downloadingState === 'default' || downloadingState === 'completed') {
        setDownloadingState('started');
        video?.pause();
        video?.encode();
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

  async function saveVideoAsFrames(file: MP4ArrayBuffer, fileName: string) {
    console.log("Starting frame extraction process");
    
    // Mark frame extraction as in progress to disable UI elements
    setFrameExtractionInProgress(true);
    
    // Show a warning message using the snackbar
    enqueueMessage(
      "⚠️ Please keep this wondow open while frames are being extracted. This may take a few minutes.",
      { 
        expire: false,
        showClose: false,
        type: 'warning',
        duration: 0 
      }
    );
    
    try {
      // Create a video element specifically for frame extraction
      const videoEl = document.createElement('video');
      videoEl.playsInline = true;
      videoEl.muted = true;
      
      // Convert file to blob and create URL
      const blob = new Blob([file]);
      const url = URL.createObjectURL(blob);
      videoEl.src = url;
      
      // Wait for video to load
      await new Promise<void>(resolve => {
        videoEl.onloadeddata = () => resolve();
        videoEl.load();
      });
      
      // Load JSZip library
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      
      // Get video dimensions from the video element
      const width = videoEl.videoWidth;
      const height = videoEl.videoHeight;
      
      // First check if we have access to the video object for frame count
      if (!video) {
        throw new Error("No video context available");
      }
      
      // Get total frames from video object
      const totalFrames = video.numberOfFrames;
      
      if (!width || !height || !totalFrames) {
        throw new Error("No video dimensions or frames available");
      }
      
      console.log(`Video dimensions: ${width}x${height}, total frames: ${totalFrames}`);
      
      // Store current frame to restore later
      const originalFrame = video.frame;
      
      // Create a canvas to render frames
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) {
        throw new Error("Could not get canvas context");
      }
      
      // Extract all frames in small batches to avoid memory issues
      const frameCount = totalFrames;
      let framesProcessed = 0;
      
      // Process frames more directly with fewer async operations
      const batchSize = 5;
      for (let batchStart = 0; batchStart < frameCount; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, frameCount);
        console.log(`Processing batch ${batchStart} to ${batchEnd-1}`);
        
        // Process batch
        for (let i = batchStart; i < batchEnd; i++) {
          // Go to specific frame to capture it
          video.pause();
          video.frame = i;
          
          // We need to wait a moment for the frame to be rendered
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Use the canvas element to capture the current frame
          const videoCanvas = video.getCanvas();
          if (!videoCanvas) {
            console.error(`Cannot access video canvas for frame ${i}`);
            continue;
          }
          
          // Draw from the video canvas to our canvas
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(videoCanvas, 0, 0, width, height);
          
          // Convert to blob and add to zip
          const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
          });
          
          if (blob) {
            const frameName = `frame_${i.toString().padStart(5, '0')}.jpg`;
            zip.file(frameName, blob);
            console.log(`Added ${frameName} to ZIP (${blob.size} bytes)`);
            framesProcessed++;
          } else {
            console.error(`Failed to create blob for frame ${i}`);
          }
          
          // Update progress in both places
          const progressValue = Math.round((framesProcessed / frameCount) * 90);
          setProgress(progressValue);
          setModalProgress(progressValue);
        }
        
        // No need to wait for batch completion here as we're using await directly
      }
      
      console.log(`All ${framesProcessed} frames processed. Generating ZIP file...`);
      setProgress(95);
      
      // Restore original frame
      video.frame = originalFrame;
      
      // Generate and download ZIP
      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'STORE' // Using STORE for faster processing
      });
      
      console.log(`ZIP file created. Size: ${zipBlob.size} bytes`);
      
      if (zipBlob.size < 1000) { // A proper ZIP with frames should be much larger
        throw new Error(`Generated ZIP file appears empty: ${zipBlob.size} bytes`);
      }
      
      setProgress(100);
      
      // Download the ZIP file
      const zipUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.href = zipUrl;
      a.download = `${fileName.replace('.mp4', '')}_frames.zip`;
      a.click();
      
      // Clear the warning message and show success message
      clearMessage();
      enqueueMessage(
        "✅ Frame extraction complete! Your ZIP file is downloading.",
        { type: 'info', expire: true, duration: 5000 }
      );
      
      // Mark frame extraction as complete to re-enable UI
      setFrameExtractionInProgress(false);
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(zipUrl);
      }, 100); // Give the browser a moment to start the download
      
      return;
    } catch (error) {
      // Clear the warning message and show error message
      clearMessage();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      enqueueMessage(
        `❌ Error extracting frames: ${errorMessage}`,
        { type: 'warning', expire: true, duration: 7000 }
      );
      
      // Mark frame extraction as complete even on error
      setFrameExtractionInProgress(false);
      
      console.error("Error in frame extraction:", error);
      throw error;
    }
  }

  return {download, progress, state: downloadingState};
}
