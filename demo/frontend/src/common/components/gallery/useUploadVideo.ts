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
import { useUploadVideoMutation } from '@/common/components/gallery/__generated__/useUploadVideoMutation.graphql';
import Logger from '@/common/logger/Logger';
import { VideoData } from '@/demo/atoms';
import { FileRejection, FileWithPath, useDropzone } from 'react-dropzone';
import { graphql, useMutation } from 'react-relay';
import { useAtom } from 'jotai';
import {
  VIDEO_API_ENDPOINT,
  MAX_FILE_SIZE_IN_MB,
  MAX_ZIP_FILE_SIZE_MB,
  MAX_VIDEO_UPLOAD_SIZE,
  MAX_ZIP_UPLOAD_SIZE
} from '@/demo/DemoConfig'; // Import the constants
import { originalFilePathAtom, uploadErrorMessageAtom } from '@/demo/atoms';
import { useState } from 'react';


const ACCEPT_VIDEOS = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'application/zip': ['.zip'],
};

type Props = {
  onUpload: (video: VideoData) => void;
  onUploadStart?: () => void;
  onUploadError?: (error: Error) => void;
  setGlobalErrorMessage?: (message: string | null) => void;
};

export default function useUploadVideo({
  onUpload,
  onUploadStart,
  onUploadError,
  setGlobalErrorMessage,
}: Props) {
  // const originalFilePath = useAtomValue(originalFilePathAtom);
  const [, setErrorMessage] = useAtom(uploadErrorMessageAtom); // We only need the setter here
  const [originalFilePath, setOriginalFilePath] = useAtom(originalFilePathAtom);
  const [isProcessingFolder, setIsProcessingFolder] = useState<boolean>(false);
  const [folderPath, setFolderPath] = useState<string>('');

  const [commit, isMutationInFlight] = useMutation<useUploadVideoMutation>(
    graphql`
      mutation useUploadVideoMutation($file: Upload!) {
        uploadVideo(file: $file) {
          id
          height
          width
          url
          path
          posterPath
          posterUrl
        }
      }
    `,
  );

  // Function to process a local folder
  const processLocalFolder = async (folderPath: string) => {
    if (!folderPath.trim()) {
      setErrorMessage("Please enter a valid folder path");
      return;
    }

    setIsProcessingFolder(true);
    onUploadStart?.();

    try {
      // Call the backend endpoint
      const response = await fetch(`${VIDEO_API_ENDPOINT}/process_local_folder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folderPath }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 'processing' || !data.id) {
        throw new Error('Failed to start processing folder');
      }

      const videoId = data.id;

      // Poll for completion
      let pollAttempts = 0;
      let videoUrl = null;

      while (pollAttempts < 120) {  // Increased to 10 minutes total
        await new Promise(res => setTimeout(res, 5000));
        const statusResp = await fetch(`${VIDEO_API_ENDPOINT}/api/video_status/${videoId}`);
        if (!statusResp.ok) throw new Error('Failed to check processing status');

        const statusData = await statusResp.json();

        if (statusData.status === 'ready' && statusData.video && statusData.video.url) {
          videoUrl = statusData.video.url;
          break;
        } else if (statusData.status === 'error') {
          throw new Error(statusData.message || 'Failed to process folder');
        }

        pollAttempts++;
      }

      if (!videoUrl) {
        throw new Error('Processing timed out');
      }

      // Fetch the video file as a Blob
      let videoBlob;
      try {
        // Make sure videoUrl is properly formatted
        const finalUrl = videoUrl.startsWith('/') ? `${VIDEO_API_ENDPOINT}${videoUrl}` : `${VIDEO_API_ENDPOINT}/${videoUrl}`;

        // Path for startSession should include /uploads prefix
        const sanitizedUrl = videoUrl.replace(/\.mp4$/, '');
        // Make sure the path starts with /uploads for startSession
        let pathForSession = sanitizedUrl;
        if (!pathForSession.startsWith('/uploads')) {
          pathForSession = `/uploads${pathForSession.startsWith('/') ? '' : '/'}${pathForSession}`;
        }
        setOriginalFilePath(pathForSession);

        const videoResp = await fetch(finalUrl);
        if (!videoResp.ok) {
          throw new Error(`Failed to fetch video: ${videoResp.status} ${videoResp.statusText}`);
        }

        videoBlob = await videoResp.blob();
        if (videoBlob.size === 0) {
          throw new Error("Downloaded video file is empty");
        }
      } catch (e) {
        const errorMsg = 'Failed to download converted video.';
        setErrorMessage(errorMsg);
        setGlobalErrorMessage?.(errorMsg);
        onUploadError?.(e instanceof Error ? e : new Error(errorMsg));
        return;
      }

      // Create a File object from the Blob
      const videoFile = new File([videoBlob], `${videoId}.mp4`, { type: 'video/mp4' });

      // Now upload the video file to the GraphQL endpoint
      commit({
        variables: {
          file: videoFile,
        },
        uploadables: {
          file: videoFile,
        },
        onCompleted: response => {
          // Make sure path starts with /uploads if it doesn't already
          const videoData = response.uploadVideo;
          onUpload(videoData);
        },
        onError: error => {
          Logger.error(error);
          const errorMsg = 'Upload failed.';
          setErrorMessage(errorMsg);
          setGlobalErrorMessage?.(errorMsg);
          onUploadError?.(error);
        },
      });
    } catch (error) {
      Logger.error(error);
      const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      setErrorMessage(errorMsg);
      setGlobalErrorMessage?.(errorMsg);
      onUploadError?.(error instanceof Error ? error : new Error(errorMsg));
    } finally {
      setIsProcessingFolder(false);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    accept: ACCEPT_VIDEOS,
    multiple: false,
    maxFiles: 1,
    onDrop: async (
      acceptedFiles: FileWithPath[],
      fileRejections: FileRejection[],
    ) => {
      console.log('useUploadVideo - onDrop called with:', { acceptedFiles, fileRejections });
      setErrorMessage(null);

      // Check if any of the files (only 1 file allowed) is rejected. The
      // rejected file has an error (e.g., 'file-too-large'). Rendering an
      // appropriate message.
      if (fileRejections.length > 0 && fileRejections[0].errors.length > 0) {
        const code = fileRejections[0].errors[0].code;
        if (code === 'file-too-large') {
          const file = fileRejections[0].file;
          const isZip = file.type === 'application/zip' || file.name.endsWith('.zip');
          setErrorMessage(
            `File too large. Try a ${isZip ? 'zip' : 'video'} under ${isZip ? MAX_ZIP_FILE_SIZE_MB : MAX_FILE_SIZE_IN_MB} MB`,
          );
          return;
        }
      }

      if (acceptedFiles.length === 0) {
        setErrorMessage('File not accepted. Please try again.');
        return;
      }
      if (acceptedFiles.length > 1) {
        setErrorMessage('Too many files. Please try again with 1 file.');
        return;
      }

      onUploadStart?.();
      const file = acceptedFiles[0];
      const isZip = file.type === 'application/zip' || file.name.endsWith('.zip');
      const maxSize = isZip ? MAX_ZIP_UPLOAD_SIZE : MAX_VIDEO_UPLOAD_SIZE;

      if (file.size > maxSize) {
        setErrorMessage(`File too large. Try a ${isZip ? 'zip' : 'video'} under ${isZip ? MAX_ZIP_FILE_SIZE_MB : MAX_FILE_SIZE_IN_MB} MB`);
        onUploadError?.(new Error('File too large'));
        return;
      }

      if (isZip) {
        // Send zip to REST endpoint
        const formData = new FormData();
        formData.append('file', file);
        let videoId = null;

        try {
          const resp = await fetch(`${VIDEO_API_ENDPOINT}/upload_zip`, {
            method: 'POST',
            body: formData,
          });
          const data = await resp.json();
          if (data.status !== 'processing' || !data.id) {
            setErrorMessage('Failed to start zip processing.');
            onUploadError?.(new Error('Failed to start zip processing.'));
            return;
          }
          videoId = data.id;
        } catch (e) {
          setErrorMessage('Failed to upload zip.');
          onUploadError?.(e instanceof Error ? e : new Error('Failed to upload zip.'));
          return;
        }

        // Poll for video processing completion
        let pollAttempts = 0;
        let videoUrl = null;
        while (pollAttempts < 120) { // up to 10 minutes (5s * 120)
          try {
            await new Promise(res => setTimeout(res, 5000)); // Wait 5 seconds between polls
            const statusResp = await fetch(`${VIDEO_API_ENDPOINT}/api/video_status/${videoId}`);
            const statusData = await statusResp.json();

            if (statusData.status === 'ready' && statusData.video && statusData.video.url) {
              videoUrl = statusData.video.url;
              break;
            } else if (statusData.status === 'error') {
              // Extract specific error message if available and display it to the user
              const errorMessage = statusData.message || 'Failed to process zip.';
              setErrorMessage(errorMessage);
              setGlobalErrorMessage?.(errorMessage);
              console.error("Zip processing error:", errorMessage);
              onUploadError?.(new Error(errorMessage));
              return;
            }
          } catch (e) {
            setErrorMessage('Error checking video status.');
            onUploadError?.(e instanceof Error ? e : new Error('Error checking video status.'));
            return;
          }
          pollAttempts++;
        }

        if (!videoUrl) {
          const errorMsg = 'Timed out waiting for video conversion.';
          setErrorMessage(errorMsg);
          setGlobalErrorMessage?.(errorMsg);
          onUploadError?.(new Error(errorMsg));
          return;
        }

        // Fetch the video file as a Blob
        let videoBlob;
        try {
          // Make sure videoUrl is properly formatted
          const finalUrl = videoUrl.startsWith('/') ? `${VIDEO_API_ENDPOINT}${videoUrl}` : `${VIDEO_API_ENDPOINT}/${videoUrl}`;
          console.log("Final video URL:", finalUrl);
          const sanitizedUrl = videoUrl.replace(/\.mp4$/, '').replace(/^\/uploads/, '')
          console.log("Sanitized video URL:", sanitizedUrl);
          setOriginalFilePath(sanitizedUrl);
          console.log("originalFilePath:", originalFilePath);
          const videoResp = await fetch(`${finalUrl}`);

          if (!videoResp.ok) {
            throw new Error(`Failed to fetch video: ${videoResp.status} ${videoResp.statusText}`);
          }

          videoBlob = await videoResp.blob();
          if (videoBlob.size === 0) {
            throw new Error("Downloaded video file is empty");
          }
        } catch (e) {
          const errorMsg = 'Failed to download converted video.';
          setErrorMessage(errorMsg);
          setGlobalErrorMessage?.(errorMsg);
          onUploadError?.(e instanceof Error ? e : new Error(errorMsg));
          return;
        }

        // Create a File object from the Blob
        const videoFile = new File([videoBlob], `${videoId}.mp4`, { type: 'video/mp4' });

        // Now upload the video file to the GraphQL endpoint
        commit({
          variables: {
            file: videoFile,
          },
          uploadables: {
            file: videoFile,
          },
          onCompleted: response => {
            const videoData = response.uploadVideo;
            onUpload(videoData);
          },
          onError: error => {
            Logger.error(error);
            onUploadError?.(error);
            setErrorMessage('Upload failed.');
          },
        });
        return;
      }

      // Not a zip file, upload as normal
      commit({
        variables: {
          file,
        },
        uploadables: {
          file,
        },
        onCompleted: response => {
          console.log('useUploadVideo - GraphQL upload completed:', response);
          const videoData = response.uploadVideo;
          // If path is already correct, use as is
          onUpload(videoData);
        },
        onError: error => {
          console.log('useUploadVideo - GraphQL upload error:', error);
          Logger.error(error);
          onUploadError?.(error);
          setErrorMessage('Upload failed.');
        },
      });
    },
    onError: (error: any) => {
      Logger.error(error);
      setErrorMessage('File not supported.');
    },
    maxSize: MAX_ZIP_UPLOAD_SIZE, // Use the larger size limit to allow ZIP files
  });

  // Get the current error from the errorMessage atom
  const [error] = useAtom(uploadErrorMessageAtom);

  return {
    getRootProps,
    getInputProps,
    isUploading: isMutationInFlight || isProcessingFolder,
    error,
    // Add folder processing functionality
    folderPath,
    setFolderPath,
    processLocalFolder,
    isProcessingFolder
  };
}
