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
import {
  LENGTH_SCALE_TOOLBAR_INDEX,
  CENTERLINE_TOOLBAR_INDEX, // Import the new index
} from '@/common/components/toolbar/ToolbarConfig';
import { ChevronLeft, ChevronRight } from '@carbon/icons-react'; // Import ChevronRight
import { Button } from 'react-daisyui';
import ToolbarBottomActionsWrapper from '../toolbar/ToolbarBottomActionsWrapper';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react'; // Import state to handle button loading state
import { masksReadyAtom } from '@/common/components/options/masksReadyAtom'; // Import our mask readiness state
import { sessionAtom, trackletObjectsAtom, centerlinesAtom, originalFilePathAtom, centerlineAlgorithmAtom, centerlinePointsAtom, centerlineEdgePercentageAtom } from '@/demo/atoms';
import { VIDEO_API_ENDPOINT } from '@/demo/DemoConfig';

type Props = {
  onTabChange: (newIndex: number) => void;
};

export default function MoreOptionsToolbarBottomActions({ onTabChange }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const areMasksReady = useAtomValue(masksReadyAtom);
  const session = useAtomValue(sessionAtom);
  const [trackletObjects] = useAtom(trackletObjectsAtom);
  const setCenterlinesMap = useSetAtom(centerlinesAtom);
  const originalFilePath = useAtomValue(originalFilePathAtom);
  const centerlineAlgorithm = useAtomValue(centerlineAlgorithmAtom);
  const centerlinePoints = useAtomValue(centerlinePointsAtom);
  const centerlineEdgePercentage = useAtomValue(centerlineEdgePercentageAtom);

  function handleReturnToLengthScaleTab() {
    onTabChange(LENGTH_SCALE_TOOLBAR_INDEX);
  }

  // Make the handler async
  async function handleSwitchToCenterlineTab() {
    setIsLoading(true);
    // helper to fetch PCA-computed centerlines and populate atom
    async function fetchCenterlinesPCA() {
      if (!session?.id) {
        console.error('Missing session for centerline PCA');
        return;
      }
      try {
        // Build request body conditionally
        const requestBody: any = {
          session_id: session.id,
          safe_folder_name: originalFilePath,
          pca_algorithm: centerlineAlgorithm,
        };

        // Only add parameters if they're not null
        if (centerlinePoints !== null) {
          requestBody.n_points = centerlinePoints;
        }

        if (centerlineAlgorithm === 'edge' && centerlineEdgePercentage !== null) {
          requestBody.edge_percentage = centerlineEdgePercentage;
        }

        const resp = await fetch(`${VIDEO_API_ENDPOINT}/centerlines_pca`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (!resp.ok) throw new Error(resp.statusText);
        const data: Record<string, [number[], number[]][]> = await resp.json();
        const mapping: Record<number, Record<number, [number, number][]>> = {};
        Object.entries(data).forEach(([objName, frames]) => {
          const idx = parseInt(objName.split('_')[1], 10) - 1;
          const tracklet = trackletObjects[idx];
          if (!tracklet) return;
          const objMap: Record<number, [number, number][]> = {};
          frames.forEach(([xs, ys], fi) => {
            objMap[fi] = xs.map((x, i) => [x, ys[i]]);
          });
          mapping[tracklet.id] = objMap;
        });
        setCenterlinesMap(mapping);
      } catch (e) {
        console.error('Error fetching centerlines PCA:', e);
      }
    }
    if (areMasksReady) {
      await fetchCenterlinesPCA();
      setIsLoading(false);
      onTabChange(CENTERLINE_TOOLBAR_INDEX);
    } else {
      // retry after masks generation delay
      setTimeout(async () => {
        await fetchCenterlinesPCA();
        setIsLoading(false);
        onTabChange(CENTERLINE_TOOLBAR_INDEX);
      }, 5000);
    }
  }

  return (
    <ToolbarBottomActionsWrapper>
      <Button
        color="ghost"
        onClick={handleReturnToLengthScaleTab}
        disabled={isLoading}
        className="!px-4 !rounded-full font-medium text-white hover:bg-black"
        startIcon={<ChevronLeft />}>
        Length Scale
      </Button>
      {/* Next button with loading state */}
      <PrimaryCTAButton
        onClick={handleSwitchToCenterlineTab}
        endIcon={isLoading ? null : <ChevronRight />}
        disabled={isLoading}>
        {isLoading ? 'Getting centerlines...' : 'Next'}
      </PrimaryCTAButton>
    </ToolbarBottomActionsWrapper>
  );
}
