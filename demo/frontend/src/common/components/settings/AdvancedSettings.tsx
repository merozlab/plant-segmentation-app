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
import stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { INFERENCE_API_ENDPOINT } from '@/demo/DemoConfig';
import { selectedModelAtom, selectedResolutionAtom, updateStatusAtom, currentResolutionAtom } from '@/demo/atoms';

const styles = stylex.create({
  container: {
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
  },
  headerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  content: {
    padding: '0 12px 12px 12px',
  },
  modelGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 8,
  },
  modelOption: {
    padding: 12,
    borderRadius: 6,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    ':hover': {
      borderColor: 'rgba(255, 255, 255, 0.3)',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
  },
  selectedModel: {
    borderColor: '#0084ff',
    backgroundColor: 'rgba(0, 132, 255, 0.1)',
  },
  modelName: {
    fontSize: '0.875rem',
    fontWeight: 600,
    marginBottom: 4,
  },
  modelStats: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  modelDescription: {
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 1.3,
  },
  loading: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.75rem',
    textAlign: 'center',
    padding: 16,
  },
  errorText: {
    color: '#ff4444',
    fontSize: '0.75rem',
  },
  successText: {
    color: '#44ff44',
    fontSize: '0.75rem',
  },
  resolutionSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  },
  resolutionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8,
    marginTop: 8,
  },
  resolutionOption: {
    padding: 8,
    borderRadius: 4,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    cursor: 'pointer',
    textAlign: 'center',
    fontSize: '0.75rem',
    transition: 'all 0.2s ease',
    ':hover': {
      borderColor: 'rgba(255, 255, 255, 0.3)',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
  },
  selectedResolution: {
    borderColor: '#0084ff',
    backgroundColor: 'rgba(0, 132, 255, 0.1)',
  },
});

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
    <div {...stylex.props(styles.container)}>
      <div
        {...stylex.props(styles.header)}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div {...stylex.props(styles.headerContent)}>
          <Settings size={16} />
          <span {...stylex.props(styles.title)}>Advanced Settings</span>
        </div>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {isExpanded && (
        <div {...stylex.props(styles.content)}>
          {loading ? (
            <div {...stylex.props(styles.loading)}>Loading GPU information...</div>
          ) : (
            <>
              {gpuInfo && (
                <>
                  <div style={{ marginBottom: 12, fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    <strong>GPU:</strong> {gpuInfo.gpu_available ? 'Available' : 'Not Available'}
                    {gpuInfo.total_memory && (
                      <div style={{ marginTop: 4 }}>
                        <strong>Total Memory:</strong> {formatMemory(gpuInfo.total_memory)}
                        {gpuInfo.available_memory && (
                          <span style={{ marginLeft: 8 }}>
                            <strong>Available:</strong> {formatMemory(gpuInfo.available_memory)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 8, fontSize: '0.875rem', fontWeight: 600 }}>
                    Model Size Selection
                  </div>

                  <div {...stylex.props(styles.modelGrid)}>
                    {Object.entries(gpuInfo.model_estimates).map(([modelSize, info]) => (
                      <div
                        key={modelSize}
                        {...stylex.props(
                          styles.modelOption,
                          selectedModel === modelSize && styles.selectedModel
                        )}
                        onClick={() => handleModelChange(modelSize)}
                      >
                        <div {...stylex.props(styles.modelName)}>
                          {MODEL_DISPLAY_NAMES[modelSize as keyof typeof MODEL_DISPLAY_NAMES]}
                        </div>
                        <div {...stylex.props(styles.modelStats)}>
                          {Math.round(info.max_frames / 100) * 100} Frames • Memory per frame: {info.memory_per_frame}
                        </div>
                        <div {...stylex.props(styles.modelDescription)}>
                          {MODEL_DESCRIPTIONS[modelSize as keyof typeof MODEL_DESCRIPTIONS]}
                        </div>
                      </div>
                    ))}
                  </div>

                  {gpuInfo.model_estimates[selectedModel]?.resolutions && (
                    <div {...stylex.props(styles.resolutionSection)}>
                      <div style={{ marginBottom: 8, fontSize: '0.875rem', fontWeight: 600 }}>
                        Resolution Selection
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: 8 }}>
                        Higher resolutions provide better quality but use more memory
                      </div>
                      <div {...stylex.props(styles.resolutionGrid)}>
                        {gpuInfo.model_estimates[selectedModel].resolutions!.map((resolution) => (
                          <div
                            key={resolution}
                            {...stylex.props(
                              styles.resolutionOption,
                              selectedResolution === resolution && styles.selectedResolution
                            )}
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
                      {...stylex.props(
                        updateStatus.includes('Error') ? styles.errorText : styles.successText
                      )}
                      style={{ marginTop: 8 }}
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