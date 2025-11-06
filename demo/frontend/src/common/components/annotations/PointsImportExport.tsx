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
import { Download, Upload } from '@carbon/icons-react';
import { trackletObjectsAtom, frameIndexAtom, activeTrackletObjectIdAtom } from '@/demo/atoms';
import { useAtomValue, useSetAtom } from 'jotai';
import { useRef } from 'react';
import useVideo from '@/common/components/video/editor/useVideo';
import { SegmentationPoint } from '@/common/tracker/Tracker';

type PointsExportData = {
  version: string;
  tracklets: {
    id: number;
    frames: {
      frameIndex: number;
      points: SegmentationPoint[];
    }[];
  }[];
};

const DECIMAL_PRECISION = 4; // Round to 4 decimal places for comparison

function roundPoint(point: SegmentationPoint, precision: number): SegmentationPoint {
  const factor = Math.pow(10, precision);
  return [
    Math.round(point[0] * factor) / factor,
    Math.round(point[1] * factor) / factor,
    point[2],
  ];
}

function pointsEqual(p1: SegmentationPoint, p2: SegmentationPoint, precision: number): boolean {
  const rounded1 = roundPoint(p1, precision);
  const rounded2 = roundPoint(p2, precision);
  return rounded1[0] === rounded2[0] && rounded1[1] === rounded2[1] && rounded1[2] === rounded2[2];
}

export default function PointsImportExport() {
  const tracklets = useAtomValue(trackletObjectsAtom);
  const frameIndex = useAtomValue(frameIndexAtom);
  const setActiveTrackletId = useSetAtom(activeTrackletObjectIdAtom);
  const video = useVideo();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    // Collect all points from all tracklets
    const exportData: PointsExportData = {
      version: '1.0',
      tracklets: tracklets.map(tracklet => ({
        id: tracklet.id,
        frames: tracklet.points
          .map((framePoints, idx) => ({
            frameIndex: idx,
            points: framePoints || [],
          }))
          .filter(frame => frame.points.length > 0), // Only include frames with points
      })).filter(tracklet => tracklet.frames.length > 0), // Only include tracklets with points
    };

    // Create and download JSON file
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `points-export-${new Date().toISOString()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData: PointsExportData = JSON.parse(text);

      // Validate the data structure
      if (!importData.version || !importData.tracklets) {
        alert('Invalid JSON format');
        return;
      }

      if (!video) {
        alert('Video player not initialized');
        return;
      }

      // Store the original frame to return to it later
      const originalFrame = frameIndex;

      // Helper function to wait for frame change
      const waitForFrame = (targetFrame: number): Promise<void> => {
        return new Promise((resolve) => {
          if (video.frame === targetFrame) {
            resolve();
            return;
          }

          const checkFrame = () => {
            if (video.frame === targetFrame) {
              resolve();
            } else {
              setTimeout(checkFrame, 50);
            }
          };
          checkFrame();
        });
      };

      let pointsAdded = 0;
      let pointsSkipped = 0;

      // Process each tracklet
      for (const trackletData of importData.tracklets) {
        // Find or create the tracklet
        let tracklet = tracklets.find(t => t.id === trackletData.id);

        // If tracklet doesn't exist, create it
        if (!tracklet) {
          const newTracklet = await video.createTracklet();
          if (!newTracklet) {
            console.error(`Failed to create tracklet ${trackletData.id}`);
            continue;
          }
          tracklet = newTracklet;
        }

        // Set the active tracklet
        setActiveTrackletId(tracklet.id);

        // Process each frame
        for (const frameData of trackletData.frames) {
          const targetFrameIndex = frameData.frameIndex;

          // Navigate to the target frame
          video.frame = targetFrameIndex;
          await waitForFrame(targetFrameIndex);

          // Get existing points for this frame
          const existingPoints = tracklet.points[targetFrameIndex] || [];

          // Filter out points that already exist
          const newPoints: SegmentationPoint[] = [];
          for (const point of frameData.points) {
            const exists = existingPoints.some(existing =>
              pointsEqual(existing, point, DECIMAL_PRECISION)
            );
            if (!exists) {
              newPoints.push(point);
            } else {
              pointsSkipped++;
            }
          }

          // If there are new points to add, add them
          if (newPoints.length > 0) {
            // Combine existing and new points
            const allPoints = [...existingPoints, ...newPoints];
            pointsAdded += newPoints.length;

            // Add points using the inference backend
            // This will trigger the backend to process the points and generate masks
            await video.updatePoints(tracklet.id, allPoints);

            // Wait a bit for the backend to process
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }

      // Return to the original frame
      video.frame = originalFrame;
      await waitForFrame(originalFrame);

      alert(`Import completed!\nAdded: ${pointsAdded} points\nSkipped: ${pointsSkipped} duplicate points`);
    } catch (error) {
      console.error('Error importing points:', error);
      alert('Error importing points. Please check the file format.');
    } finally {
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="flex gap-2 p-3 border-t border-gray-700">
      <button
        onClick={handleExport}
        disabled={tracklets.length === 0}
        className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-sm flex-1"
        title="Export all points as JSON"
      >
        <Download size={16} />
        Export Points
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm flex-1"
        title="Import points from JSON"
      >
        <Upload size={16} />
        Import Points
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        style={{ display: 'none' }}
      />
    </div>
  );
}
