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
import DefaultVideoGalleryModalTrigger from '@/common/components/gallery/DefaultVideoGalleryModalTrigger';
import LoadingStateScreen from '@/common/loading/LoadingStateScreen';
import { uploadingStateAtom, uploadErrorMessageAtom } from '@/demo/atoms';
import { MAX_FILE_SIZE_IN_MB } from '@/demo/DemoConfig';
import { useAtomValue } from 'jotai';

export default function UploadLoadingScreen() {
  const uploadingState = useAtomValue(uploadingStateAtom);
  const errorMessage = useAtomValue(uploadErrorMessageAtom);

  if (uploadingState === 'error') {
    const defaultDescription =
      `Please upload another video, and make sure that the video's file size is less than ${MAX_FILE_SIZE_IN_MB}MB or use a ZIP file with images in the root folder.`;

    return (
      <LoadingStateScreen
        title="Uh oh, we cannot process this file"
        description={errorMessage || defaultDescription}>
        <div className="max-w-[250px] w-full mx-auto">
          <DefaultVideoGalleryModalTrigger />
        </div>
      </LoadingStateScreen>
    );
  }

  return (
    <LoadingStateScreen
      title="Processing..."
      description="Sit tight while we process your video. This may take a moment."
    />
  );
}
