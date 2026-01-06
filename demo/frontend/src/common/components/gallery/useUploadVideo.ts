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
import { originalFilePathAtom, originalFilenameAtom, uploadErrorMessageAtom } from '@/demo/atoms';
import { useState } from 'react';


const ACCEPT_VIDEOS = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'application/zip': ['.zip'],
};

// Utility function to convert technical error messages to user-friendly ones
function getVideoErrorMessage(errorMessage: string): string {
  const message = errorMessage.toLowerCase();
  
  // Check for specific backend error messages
  if (message.includes('not valid video file') || message.includes('invalid data')) {
    return 'This file is not a valid video format. Please try an MP4 or MOV file.';
  }
  
  if (message.includes('does not contain a video stream')) {
    return 'This file appears to be corrupted or contains no video content. Please try a different video file.';
  }
  
  if (message.includes('does not contain width or height metadata')) {
    return 'This video file is missing important metadata. Please try re-encoding your video or use a different file.';
  }
  
  if (message.includes('does not contain time duration metadata') || message.includes('does time duration metadata')) {
    return 'This video file is missing duration information. Please try re-encoding your video or use a different file.';
  }
  
  if (message.includes('transcode produced empty video') || message.includes('empty video')) {
    return 'The video could not be processed properly. It may be too short or have an invalid format. Please try a different video.';
  }
  
  if (message.includes('file too large') || message.includes('413')) {
    return `File is too large. Please use a video under ${MAX_FILE_SIZE_IN_MB}MB.`;
  }
  
  if (message.includes('unsupported format') || message.includes('codec')) {
    return 'This video format or codec is not supported. Please try converting to MP4 format.';
  }
  
  if (message.includes('duration') && message.includes('too long')) {
    return 'Video is too long. Please use a shorter video (maximum 30 seconds).';
  }
  
  if (message.includes('network') || message.includes('fetch')) {
    return 'Network error occurred while uploading. Please check your connection and try again.';
  }
  
  if (message.includes('timeout')) {
    return 'Upload timed out. Please try again with a smaller file or check your internet connection.';
  }
  
  // Check for common video encoding issues
  if (message.includes('resolution') || message.includes('dimensions')) {
    return 'Video resolution is not supported. Please try a video with standard dimensions (e.g., 1920x1080).';
  }
  
  if (message.includes('frame rate') || message.includes('fps')) {
    return 'Video frame rate is not supported. Please try a video with standard frame rate (24-60 fps).';
  }
  
  if (message.includes('permission') || message.includes('unauthorized')) {
    return 'You do not have permission to upload files. Please contact support.';
  }
  
  // Generic error messages for common issues
  if (message.includes('upload') && message.includes('fail')) {
    return 'Upload failed. Please check your internet connection and try again.';
  }
  
  if (message.includes('server') && message.includes('error')) {
    return 'Server error occurred. Please try again in a few moments.';
  }
  
  // Default fallback message
  return 'Video upload failed. Please ensure your file is a valid MP4 or MOV video and try again.';
}

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
  const [, setErrorMessage] = useAtom(uploadErrorMessageAtom); // We only need the setter here
  const [, setOriginalFilePath] = useAtom(originalFilePathAtom);
  const [, setOriginalFilename] = useAtom(originalFilenameAtom);
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

      // Extract folder name as filename (get last part of path)
      const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || 'local_folder';
      setOriginalFilename(folderName);

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
          
          // Parse GraphQL error message for user-friendly display
          const userFriendlyMessage = getVideoErrorMessage(error.message || error.toString());
          setErrorMessage(userFriendlyMessage);
          setGlobalErrorMessage?.(userFriendlyMessage);
          onUploadError?.(error);
        },
      });
    } catch (error) {
      Logger.error(error);
      const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      const userFriendlyMessage = getVideoErrorMessage(errorMsg);
      setErrorMessage(userFriendlyMessage);
      setGlobalErrorMessage?.(userFriendlyMessage);
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
        setErrorMessage('File not accepted. Please upload an MP4, MOV, or ZIP file.');
        return;
      }
      if (acceptedFiles.length > 1) {
        setErrorMessage('Too many files. Please upload only one file at a time.');
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
          
          if (!resp.ok) {
            const errorText = await resp.text();
            const userFriendlyMessage = getVideoErrorMessage(`Server error ${resp.status}: ${errorText}`);
            setErrorMessage(userFriendlyMessage);
            onUploadError?.(new Error(userFriendlyMessage));
            return;
          }
          
          const data = await resp.json();
          if (data.status !== 'processing' || !data.id) {
            const userFriendlyMessage = getVideoErrorMessage('Failed to start zip processing');
            setErrorMessage(userFriendlyMessage);
            onUploadError?.(new Error(userFriendlyMessage));
            return;
          }
          videoId = data.id;

          // Extract and store the original filename (without extension) from the zip filename
          const filenameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
          setOriginalFilename(filenameWithoutExt);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'Failed to upload zip';
          const userFriendlyMessage = getVideoErrorMessage(errorMsg);
          setErrorMessage(userFriendlyMessage);
          onUploadError?.(e instanceof Error ? e : new Error(userFriendlyMessage));
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
            const errorMsg = e instanceof Error ? e.message : 'Error checking video status';
            const userFriendlyMessage = getVideoErrorMessage(errorMsg);
            setErrorMessage(userFriendlyMessage);
            onUploadError?.(e instanceof Error ? e : new Error(userFriendlyMessage));
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
          const sanitizedUrl = videoUrl.replace(/\.mp4$/, '').replace(/^\/uploads/, '')
          setOriginalFilePath(sanitizedUrl);
          const videoResp = await fetch(`${finalUrl}`);

          if (!videoResp.ok) {
            throw new Error(`Failed to fetch video: ${videoResp.status} ${videoResp.statusText}`);
          }

          videoBlob = await videoResp.blob();
          if (videoBlob.size === 0) {
            throw new Error("Downloaded video file is empty");
          }
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : 'Failed to download converted video';
          const userFriendlyMessage = getVideoErrorMessage(errorMsg);
          setErrorMessage(userFriendlyMessage);
          setGlobalErrorMessage?.(userFriendlyMessage);
          onUploadError?.(e instanceof Error ? e : new Error(userFriendlyMessage));
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
      // Extract and store the original filename (without extension)
      const filenameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      setOriginalFilename(filenameWithoutExt);

      commit({
        variables: {
          file,
        },
        uploadables: {
          file,
        },
        onCompleted: response => {
          const videoData = response.uploadVideo;
          // If path is already correct, use as is
          onUpload(videoData);
        },
        onError: error => {
          Logger.error(error);
          
          // Parse GraphQL error message for user-friendly display
          const userFriendlyMessage = getVideoErrorMessage(error.message || error.toString());
          setErrorMessage(userFriendlyMessage);
          setGlobalErrorMessage?.(userFriendlyMessage);
          onUploadError?.(error);
        },
      });
    },
    onError: (error: any) => {
      Logger.error(error);
      const userFriendlyMessage = getVideoErrorMessage(error.message || error.toString());
      setErrorMessage(userFriendlyMessage);
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
