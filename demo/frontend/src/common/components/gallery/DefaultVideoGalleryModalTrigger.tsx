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
import useUploadVideo from '@/common/components/gallery/useUploadVideo';
import OptionButton from '@/common/components/options/OptionButton';
import Logger from '@/common/logger/Logger';
import useScreenSize from '@/common/screen/useScreenSize';
import { uploadingStateAtom, uploadErrorMessageAtom, uploadConfirmationModalAtom, uploadedVideoDataAtom, originalUploadedVideoDataAtom } from '@/demo/atoms';
import { Close, CloudUpload } from '@carbon/icons-react';
import { useSetAtom } from 'jotai';
import { MAX_FILE_SIZE_IN_MB, VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';
import { useEffect, useState } from 'react';


export default function DefaultVideoGalleryModalTrigger() {
  const { isMobile } = useScreenSize();
  const setUploadingState = useSetAtom(uploadingStateAtom);
  const setUploadErrorMessage = useSetAtom(uploadErrorMessageAtom);
  const setUploadConfirmationModal = useSetAtom(uploadConfirmationModalAtom);
  const setUploadedVideoData = useSetAtom(uploadedVideoDataAtom);
  const setOriginalUploadedVideoData = useSetAtom(originalUploadedVideoDataAtom);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');

  // Fetch available folders on mount
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        const response = await fetch(`${VIDEO_API_ENDPOINT}/list_local_folders`);
        if (response.ok) {
          const data = await response.json();
          setAvailableFolders(data.folders || []);
        }
      } catch (error) {
        Logger.error('Failed to fetch folders:', error);
      }
    };
    fetchFolders();
  }, []);

  const handleUpload = (videoData: any) => {
    // Clear the original video data from any previous upload
    // This ensures the crop modal shows the NEW video, not the old one
    setOriginalUploadedVideoData(null);

    // Store the raw video data and show crop modal immediately (before processing)
    setUploadedVideoData(videoData);
    setUploadConfirmationModal(true);
    // Keep the uploading state to show loading on trigger
  };

  const {
    getRootProps,
    getInputProps,
    isUploading,
    error,
    processLocalFolder: processLocalFolderOriginal,
    isProcessingFolder
  } = useUploadVideo({
    onUpload: handleUpload,
    onUploadError: (error: Error) => {
      setUploadingState('error');
      Logger.error(error);
    },
    onUploadStart: () => {
      setUploadingState('uploading');
    },
    setGlobalErrorMessage: setUploadErrorMessage,
  });

  // Wrapper to process selected folder
  const processSelectedFolder = () => {
    if (!selectedFolder) {
      setUploadErrorMessage('Please select a folder');
      return;
    }
    // Just use the folder name directly - sap_upload is already in the Docker mount path
    processLocalFolderOriginal(selectedFolder);
  };

  return (
    <div className="flex flex-col gap-4 mb-4 mt-8">
      <div className="cursor-pointer flex flex-col gap-4" {...getRootProps()}>
        <input {...getInputProps()} />
        <OptionButton
          variant="default"
          title={
            error !== null ? (
              'Upload Error'
            ) : isMobile ? (
              <>
                Upload video or ZIP{' '}
                <div className="text-xs opacity-70">
                  24fps MP4 or ZIP of images (max {MAX_FILE_SIZE_IN_MB}MB)
                </div>
              </>
            ) : (
              <>
                Upload video or ZIP{' '}
                <div className="text-xs opacity-70">
                  Click to select: 24fps MP4 or ZIP of images (max {MAX_FILE_SIZE_IN_MB}MB)
                </div>
              </>
            )
          }
          Icon={error !== null ? Close : CloudUpload}
          loadingProps={{ loading: isUploading, label: 'Uploading...' }}
          onClick={() => { }}
        />
      </div>
      
      {/* Folder selection dropdown */}
      <div className="flex flex-col gap-2">
        <div className="text-sm opacity-70 font-medium">Or select a local folder:</div>
        <div className="flex gap-2">
          <select
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm"
            disabled={isUploading || isProcessingFolder || availableFolders.length === 0}
          >
            <option value="">
              {availableFolders.length === 0 ? 'No folders found' : 'Select a folder...'}
            </option>
            {availableFolders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
          <button
            onClick={processSelectedFolder}
            disabled={isUploading || isProcessingFolder || !selectedFolder}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white text-sm font-medium transition-colors"
          >
            {isProcessingFolder ? 'Processing...' : 'Process'}
          </button>
        </div>
        <div className="text-xs opacity-60">
          Folders from C:/Users/Public/sap_upload directory
        </div>
      </div>
    </div>
  );
}