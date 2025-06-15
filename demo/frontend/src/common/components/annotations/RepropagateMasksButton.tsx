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
import PrimaryCTAButton from '@/common/components/button/PrimaryCTAButton';
import useMessagesSnackbar from '@/common/components/snackbar/useDemoMessagesSnackbar';
import useVideo from '@/common/components/video/editor/useVideo';
import { hasEditedMasksAfterPropagationAtom, sessionAtom } from '@/demo/atoms';
import { Redo } from '@carbon/icons-react';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';

export default function RepropagateMasksButton() {
    const setHasEditedMasksAfterPropagation = useSetAtom(hasEditedMasksAfterPropagationAtom);
    const setSession = useSetAtom(sessionAtom);
    const video = useVideo();
    const { enqueueMessage } = useMessagesSnackbar();

    const handleRepropagate = useCallback(() => {
        // Reset edited state when user chooses to repropagate
        setHasEditedMasksAfterPropagation(false);

        // Trigger video propagation
        enqueueMessage('trackAndPlayClick');
        video?.streamMasks();
        setSession(previousSession =>
            previousSession == null
                ? previousSession
                : { ...previousSession, ranPropagation: true },
        );
    }, [setHasEditedMasksAfterPropagation, video, enqueueMessage, setSession]);

    return (
        <PrimaryCTAButton
            onClick={handleRepropagate}
            endIcon={<Redo size={20} />}
        >
            Re-propagate
        </PrimaryCTAButton>
    );
}
