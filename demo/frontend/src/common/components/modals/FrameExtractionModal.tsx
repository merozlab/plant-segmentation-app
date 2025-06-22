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
import { useEffect } from 'react';
import { Modal } from 'react-daisyui';
import { Progress } from 'react-daisyui';
import { Archive } from '@carbon/icons-react';

type Props = {
  visible: boolean;
  progress: number;
};

export default function FrameExtractionModal({ visible, progress }: Props) {
  // Prevent closing the browser tab or navigating away
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (visible) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [visible]);

  // If not visible, don't render
  if (!visible) return null;

  return (
    <Modal open={visible} className="max-w-[600px]">
      <Modal.Header className="font-bold">Extracting Video Frames</Modal.Header>
      <Modal.Body>
        <div className="flex flex-col items-center space-y-4">
          <Archive size={48} className="text-primary animate-pulse" />
          <p className="text-center">
            Please don't pause the video or exit the app while frames are being extracted.
            This process may take a few minutes depending on the video length.
          </p>
          <div className="w-full">
            <Progress className="w-full" value={progress} max={100} />
            <p className="text-center mt-2">{Math.round(progress)}% Complete</p>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}
