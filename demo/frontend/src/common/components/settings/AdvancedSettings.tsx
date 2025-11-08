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
import { ChevronDown, ChevronUp, Settings } from '@carbon/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { INFERENCE_API_ENDPOINT } from '@/demo/DemoConfig';
import { selectedModelAtom, selectedResolutionAtom, updateStatusAtom, currentResolutionAtom } from '@/demo/atoms';

type ModelInfo = {
  max_frames: number;
  memory_per_frame: string;
  resolutions?: number[];
  default_resolution?: number;
  description?: string;
};

type GpuInfo = {
  gpu_available: boolean;
  total_memory?: number;
  available_memory?: number;
  model_estimates: Record<string, ModelInfo>;
  error?: string;
};

const MODEL_DESCRIPTIONS = {
  tiny: 'Fastest processing, lowest accuracy. Best for quick previews or when processing speed is critical.',
  small: 'Good balance of speed and accuracy. Recommended for most use cases.',
  base_plus: 'Higher accuracy with moderate speed. Good for detailed segmentation work.',
  large: 'Highest accuracy, slowest processing. Best for final results when quality is paramount.',
};

const MODEL_DISPLAY_NAMES = {
  tiny: 'Tiny',
  small: 'Small (Recommended)',
  base_plus: 'Base Plus',
  large: 'Large',
};

export default function AdvancedSettings() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);
  const [selectedResolution, setSelectedResolution] = useAtom(selectedResolutionAtom);
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom);
  const setCurrentResolution = useSetAtom(currentResolutionAtom);

  const fetchGpuInfo = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${INFERENCE_API_ENDPOINT}/gpu_info`);
      const data = await response.json();
      setGpuInfo(data);
    } catch (error) {
      console.error('Failed to fetch GPU info:', error);
      setGpuInfo({
        gpu_available: false,
        model_estimates: {
          tiny: { max_frames: 800, memory_per_frame: '~1.5MB' },
          small: { max_frames: 650, memory_per_frame: '~2.5MB' },
          base_plus: { max_frames: 500, memory_per_frame: '~4MB' },
          large: { max_frames: 300, memory_per_frame: '~6MB' },
        },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleModelChange = useCallback(async (modelSize: string, resolution?: number) => {
    try {
      setUpdateStatus('Updating...');
      const requestBody: { model_size: string; resolution?: number } = { model_size: modelSize };
      if (resolution !== undefined) {
        requestBody.resolution = resolution;
      }

      const response = await fetch(`${INFERENCE_API_ENDPOINT}/set_model_size`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (response.ok) {
        setSelectedModel(modelSize);
        if (resolution !== undefined) {
          setSelectedResolution(resolution);
          setCurrentResolution(resolution);
        } else if (gpuInfo?.model_estimates[modelSize]?.default_resolution) {
          const defaultRes = gpuInfo.model_estimates[modelSize].default_resolution!;
          setSelectedResolution(defaultRes);
          setCurrentResolution(defaultRes);
        }
        setUpdateStatus('Model updated! Please refresh the page for changes to take effect.');
        setTimeout(() => setUpdateStatus(''), 3000);
      } else {
        setUpdateStatus(`Error: ${data.error}`);
        setTimeout(() => setUpdateStatus(''), 3000);
      }
    } catch (error) {
      setUpdateStatus('Failed to update model size');
      setTimeout(() => setUpdateStatus(''), 3000);
    }
  }, [gpuInfo, setCurrentResolution]);

  const handleResolutionChange = useCallback(async (resolution: number) => {
    await handleModelChange(selectedModel, resolution);
  }, [selectedModel, handleModelChange]);

  useEffect(() => {
    if (isExpanded && !gpuInfo) {
      fetchGpuInfo();
    }
  }, [isExpanded, gpuInfo, fetchGpuInfo]);

  const formatMemory = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 ** 3);
    return `${gb.toFixed(1)} GB`;
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 mb-4">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <Settings size={16} />
          <span className="text-sm font-semibold text-white/90">Advanced Settings</span>
        </div>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="text-white/60 text-xs text-center p-4">Loading GPU information...</div>
          ) : (
            <>
              {gpuInfo && (
                <>
                  <div className="mb-3 text-xs text-white/70">
                    <strong>GPU:</strong> {gpuInfo.gpu_available ? 'Available' : 'Not Available'}
                    {gpuInfo.total_memory && (
                      <div className="mt-1">
                        <strong>Total Memory:</strong> {formatMemory(gpuInfo.total_memory)}
                        {gpuInfo.available_memory && (
                          <span className="ml-2">
                            <strong>Available:</strong> {formatMemory(gpuInfo.available_memory)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mb-2 text-sm font-semibold">
                    Model Size Selection
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(gpuInfo.model_estimates).map(([modelSize, info]) => (
                      <div
                        key={modelSize}
                        className={`p-3 rounded-md border cursor-pointer transition-all duration-200 ${
                          selectedModel === modelSize
                            ? 'border-[#0084ff] bg-[#0084ff]/10'
                            : 'border-white/10 hover:border-white/30 hover:bg-white/5'
                        }`}
                        onClick={() => handleModelChange(modelSize)}
                      >
                        <div className="text-sm font-semibold mb-1">
                          {MODEL_DISPLAY_NAMES[modelSize as keyof typeof MODEL_DISPLAY_NAMES]}
                        </div>
                        <div className="text-xs text-white/70 mb-1">
                          {Math.round(info.max_frames / 100) * 100} Frames • Memory per frame: {info.memory_per_frame}
                        </div>
                        <div className="text-xs text-white/60 leading-tight">
                          {MODEL_DESCRIPTIONS[modelSize as keyof typeof MODEL_DESCRIPTIONS]}
                        </div>
                      </div>
                    ))}
                  </div>

                  {gpuInfo.model_estimates[selectedModel]?.resolutions && (
                    <div className="mt-4 pt-3 border-t border-white/10">
                      <div className="mb-2 text-sm font-semibold">
                        Resolution Selection
                      </div>
                      <div className="text-xs text-white/70 mb-2">
                        Higher resolutions provide better quality but use more memory
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2 mt-2">
                        {gpuInfo.model_estimates[selectedModel].resolutions!.map((resolution) => (
                          <div
                            key={resolution}
                            className={`p-2 rounded border cursor-pointer text-center text-xs transition-all duration-200 ${
                              selectedResolution === resolution
                                ? 'border-[#0084ff] bg-[#0084ff]/10'
                                : 'border-white/10 hover:border-white/30 hover:bg-white/5'
                            }`}
                            onClick={() => handleResolutionChange(resolution)}
                          >
                            {resolution}px
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {updateStatus && (
                    <div
                      className={`text-xs mt-2 ${
                        updateStatus.includes('Error') ? 'text-[#ff4444]' : 'text-[#44ff44]'
                      }`}
                    >
                      {updateStatus}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}