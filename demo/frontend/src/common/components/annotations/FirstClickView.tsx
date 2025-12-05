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
import DemoVideoGallery from '@/common/components/gallery/DemoVideoGallery';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import ModelPresetSelector from '@/common/components/settings/ModelPresetSelector';
import { useEffect, useRef } from 'react';
import PointsImportExport from './PointsImportExport';

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
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0 px-8">
        <ModelPresetSelector />
        <PointsImportExport />
        <DefaultVideoGalleryModalTrigger />
        <DemoVideoGallery />
      </div>
  );
}
