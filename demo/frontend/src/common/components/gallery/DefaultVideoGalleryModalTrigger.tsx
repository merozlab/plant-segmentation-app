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
import { sessionAtom, uploadingStateAtom, uploadErrorMessageAtom } from '@/demo/atoms';
import { Close, CloudUpload } from '@carbon/icons-react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { IS_LOCAL_DEPLOYMENT, UPLOADS_DIRECTORY } from '@/demo/DemoConfig';

export default function DefaultVideoGalleryModalTrigger() {
  const navigate = useNavigate();
  const { isMobile } = useScreenSize();
  const setUploadingState = useSetAtom(uploadingStateAtom);
  const setSession = useSetAtom(sessionAtom);
  const setUploadErrorMessage = useSetAtom(uploadErrorMessageAtom);

  const handleUpload = (videoData: any) => {
    navigate(
      { pathname: location.pathname, search: location.search },
      { state: { video: videoData } },
    );
    setUploadingState('default');
    setSession(null);
  };

  // Use the enhanced useUploadVideo hook with local folder processing
  const {
    getRootProps,
    getInputProps,
    isUploading,
    error,
    folderPath,
    setFolderPath,
    processLocalFolder,
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

  // Simplified folder submission handler
  const handleFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processLocalFolder(folderPath);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="cursor-pointer flex flex-col gap-4" {...getRootProps()}>
        <input {...getInputProps()} />
        <OptionButton
          variant="default"
          title={
            error !== null ? (
              'Upload Error'
            ) : isMobile ? (
              <>
                Upload video or ZIP of images{' '}
                <div className="text-xs opacity-70">
                  MP4 (max 140MB) or ZIP of images (max 1GB)
                </div>
              </>
            ) : (
              <>
                Upload video or ZIP of images{' '}
                <div className="text-xs opacity-70">
                  MP4 (max 140MB) or ZIP of images (max 1GB)
                </div>
              </>
            )
          }
          Icon={error !== null ? Close : CloudUpload}
          loadingProps={{ loading: isUploading, label: isUploading ? 'Uploading or processing...' : 'Uploading...' }}
          onClick={() => { }}
        />
      </div>

      {/* Only render the local folder section if IS_LOCAL_DEPLOYMENT is true */}
      {IS_LOCAL_DEPLOYMENT && (
        <>
          <div className="divider text-sm opacity-70">OR</div>

          <form onSubmit={handleFolderSubmit} className="flex flex-col gap-2">
            <div className="text-sm mb-1">Place your folder in {UPLOADS_DIRECTORY}:</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={folderPath}
                onChange={(e: any) => setFolderPath(e.target.value)}
                placeholder="Enter folder name"
                className="input input-bordered text-secondary flex-grow w-full"
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isProcessingFolder || !folderPath.trim()}
              >
                {isProcessingFolder ? 'Processing...' : 'Process Folder'}
              </button>
            </div>
            <div className="text-xs opacity-70">
              The app will convert all image files to a video and upload it.
            </div>
          </form>
        </>
      )}
    </div>
  );
}
