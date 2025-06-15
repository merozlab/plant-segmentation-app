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
import { MAX_FILE_SIZE_IN_MB, MAX_ZIP_FILE_SIZE_MB } from '@/demo/DemoConfig';


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

  const {
    getRootProps,
    getInputProps,
    isUploading,
    error,
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

  return (
    <div className="flex flex-col gap-2 mb-4">
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
                  MP4 (max {MAX_FILE_SIZE_IN_MB}MB) or ZIP of images (max {MAX_ZIP_FILE_SIZE_MB}MB)
                </div>
              </>
            ) : (
              <>
                Upload video or ZIP of images{' '}
                <div className="text-xs opacity-70">
                  MP4 (max {MAX_FILE_SIZE_IN_MB}MB) or ZIP of images (max {MAX_ZIP_FILE_SIZE_MB}MB)
                </div>
              </>
            )
          }
          Icon={error !== null ? Close : CloudUpload}
          loadingProps={{ loading: isUploading, label: isUploading ? 'Uploading or processing...' : 'Uploading...' }}
          onClick={() => { }}
        />
      </div>

    </div>
  );
}
