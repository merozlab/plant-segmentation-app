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
import { ChevronDown, ChevronUp } from '@carbon/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { INFERENCE_API_ENDPOINT } from '@/demo/DemoConfig';
import { selectedPresetAtom, updateStatusAtom, selectedResolutionAtom } from '@/demo/atoms';

type PresetInfo = {
  name: string;
  description: string;
  technical_detail: string;
  model_size: string;
  resolution: number;
  memory_per_frame_mb?: number;
  estimated_max_frames?: number;
};

type PresetsResponse = Record<string, PresetInfo>;

export default function ModelPresetSelector() {
  const [presets, setPresets] = useState<Record<string, PresetInfo>>({});
  const [selectedPreset, setSelectedPreset] = useAtom(selectedPresetAtom);
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom);
  const [loading, setLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [, setSelectedResolution] = useAtom(selectedResolutionAtom);

  const fetchPresets = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${INFERENCE_API_ENDPOINT}/presets`);
      const data: PresetsResponse = await response.json();
      setPresets(data);
    } catch (error) {
      console.error('Failed to fetch presets:', error);
      setUpdateStatus('Failed to load presets');
      setTimeout(() => setUpdateStatus(''), 3000);
    } finally {
      setLoading(false);
    }
  }, [setUpdateStatus]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const handlePresetChange = useCallback(async (presetId: string) => {
    setSelectedPreset(presetId);
    setUpdateStatus('Updating...');

    try {
      const response = await fetch(`${INFERENCE_API_ENDPOINT}/set_preset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preset: presetId }),
      });

      const data = await response.json();

      if (response.ok) {
        // Update the selected resolution atom to match the preset
        if (data.resolution) {
          setSelectedResolution(data.resolution);
        }
        setUpdateStatus('Preset updated! Please refresh the page for changes to take effect.');
        setTimeout(() => setUpdateStatus(''), 5000);
      } else {
        setUpdateStatus(`Error: ${data.error}`);
        setTimeout(() => setUpdateStatus(''), 3000);
      }
    } catch (error) {
      setUpdateStatus('Failed to update preset');
      setTimeout(() => setUpdateStatus(''), 3000);
    }
  }, [setSelectedPreset, setUpdateStatus, setSelectedResolution]);

  // Get the currently selected preset info for collapsed view
  const currentPreset = presets[selectedPreset];

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 mb-4">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white/90">Model Quality</span>
            {!isExpanded && currentPreset && (
              <span className="text-xs text-white/60">
                ({currentPreset.name})
              </span>
            )}
          </div>
          {!isExpanded && currentPreset && (
            <div className="text-xs text-white/50 mt-1">
              {currentPreset.technical_detail}
              {currentPreset.estimated_max_frames && (
                <span className="ml-2">• ~{currentPreset.estimated_max_frames} frames</span>
              )}
            </div>
          )}
        </div>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {isExpanded && (
        <>
          {loading ? (
            <div className="text-white/60 text-xs text-center p-4">Loading presets...</div>
          ) : (
            <div className="px-3 pb-3">
              <div className="space-y-3">
                {Object.entries(presets).map(([presetId, preset]) => (
                  <label
                    key={presetId}
                    className={`block p-3 rounded-md border cursor-pointer transition-all duration-200 ${
                      selectedPreset === presetId
                        ? 'border-[#0084ff] bg-[#0084ff]/10'
                        : 'border-white/10 hover:border-white/30 hover:bg-white/5'
                    }`}
                  >
                    <input
                      type="radio"
                      name="preset"
                      value={presetId}
                      checked={selectedPreset === presetId}
                      onChange={() => handlePresetChange(presetId)}
                      className="sr-only"
                    />
                    <div className="text-sm font-semibold text-white mb-1">{preset.name}</div>
                    <div className="text-xs text-white/70 mb-1">{preset.description}</div>
                    <div className="text-xs text-white/50 flex items-center justify-between">
                      <span>{preset.technical_detail}</span>
                      {preset.estimated_max_frames && (
                        <span className="text-white/60">~{preset.estimated_max_frames} frames</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {updateStatus && (
        <div
          className={`text-xs p-3 border-t border-white/10 ${
            updateStatus.includes('Error') || updateStatus.includes('Failed')
              ? 'text-[#ff4444]'
              : 'text-[#44ff44]'
          }`}
        >
          {updateStatus}
        </div>
      )}
    </div>
  );
}
