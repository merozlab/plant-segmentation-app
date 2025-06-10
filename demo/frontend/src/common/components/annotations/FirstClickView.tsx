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
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import { useEffect, useRef } from 'react';

export default function FirstClickView() {
  const isFirstClickMessageShown = useRef(false);
  const { enqueueMessage } = useMessagesSnackbar();

  useEffect(() => {
    if (!isFirstClickMessageShown.current) {
      isFirstClickMessageShown.current = true;
      enqueueMessage('firstClick');
    }
  }, [enqueueMessage]);

  return (
    <div className="w-full h-full flex flex-col p-8">
      <div className="grow flex flex-col gap-6">
        <h2 className="text-2xl">Click an object in the video to start</h2>
        <p className="!text-gray-60">
          If you are uploading a video, make sure it is at 24fps. <br />
          The demo should work great with ~500 frames, and up to 10 tracked objects. <br />
          Uploads will be resized to 1280 x 840 pixels.
        </p>
        <p className="!text-gray-60">
          To start, click any object in the video.
        </p>
      </div>
      <div className="flex items-center">
        <DefaultVideoGalleryModalTrigger />
      </div>
    </div>
  );
}
