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
import { Effects } from '@/common/components/video/effects/Effects';

type EffectLayers = {
  background: keyof Effects;
  highlight: keyof Effects;
};

export const DEMO_SHORT_NAME = 'SAM 2 Demo';
export const RESEARCH_BY_META_AI = 'By Meta FAIR';
export const DEMO_FRIENDLY_NAME = 'Segment Anything 2 Demo';
// export const VIDEO_WATERMARK_TEXT = `Modified with ${DEMO_FRIENDLY_NAME}`;
export const VIDEO_WATERMARK_TEXT = '';
export const PROJECT_GITHUB_URL =
  'https://github.com/facebookresearch/sam2';
export const AIDEMOS_URL = 'https://aidemos.meta.com';
export const ABOUT_URL = 'https://ai.meta.com/sam2';
export const EMAIL_ADDRESS = 'segment-anything@meta.com';
export const BLOG_URL = 'http://ai.meta.com/blog/sam2';

export const VIDEO_API_ENDPOINT = 'http://localhost:7264';
export const INFERENCE_API_ENDPOINT = 'http://localhost:7263';

// Path configurations
/**
 * UPLOADS_DIRECTORY
 * Path to the directory where user folders should be placed for local processing
 * This should match the server's uploads directory path in a local development setup
 */
export const UPLOADS_DIRECTORY = '/home/yasmine/alex/plant-segmentation-app/demo/data/uploads';

// Feature flags
/**
 * IS_LOCAL_DEPLOYMENT
 * Set to true for local development environments where you want to enable
 * features like local folder processing.
 * Set to false for production/remote deployments where local file system 
 * access is not available or should be disabled for security reasons.
 */
export const IS_LOCAL_DEPLOYMENT = true;

export const demoObjectLimit = 3;

export const DEFAULT_EFFECT_LAYERS: EffectLayers = {
  background: 'Original',
  highlight: 'Overlay',
};

export const MAX_UPLOAD_FILE_SIZE = '140MB';
