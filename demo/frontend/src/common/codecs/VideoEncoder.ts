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
import {ImageFrame} from '@/common/codecs/VideoDecoder';
import {MP4ArrayBuffer, createFile} from 'mp4box';

// The selection of timescale and seconds/key-frame value are
// explained in the following docs: https://github.com/vjeux/mp4-h264-re-encode
const TIMESCALE = 90000;
const SECONDS_PER_KEY_FRAME = 2;

export function encode(
  width: number,
  height: number,
  numFrames: number,
  framesGenerator: AsyncGenerator<ImageFrame, unknown>,
  progressCallback?: (progress: number) => void,
): Promise<MP4ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let encodedFrameIndex = 0;
    let nextKeyFrameTimestamp = 0;
    let trackID: number | null = null;
    const durations: number[] = [];

    const outputFile = createFile();

    const encoder = new VideoEncoder({
      output(chunk, metaData) {
        const uint8 = new Uint8Array(chunk.byteLength);
        chunk.copyTo(uint8);

        const description = metaData?.decoderConfig?.description;
        if (trackID === null) {
          trackID = outputFile.addTrack({
            width: width,
            height: height,
            timescale: TIMESCALE,
            avcDecoderConfigRecord: description,
          });
        }
        const shiftedDuration = durations.shift();
        if (shiftedDuration != null) {
          outputFile.addSample(trackID, uint8, {
            duration: getScaledDuration(shiftedDuration),
            is_sync: chunk.type === 'key',
          });
          encodedFrameIndex++;
          progressCallback?.(encodedFrameIndex / numFrames);
        }

        if (encodedFrameIndex === numFrames) {
          resolve(outputFile.getBuffer());
        }
      },
      error(error) {
        reject(error);
        return;
      },
    });

    const setConfigurationAndEncodeFrames = async () => {
      // The codec value was taken from the following implementation and seems
      // reasonable for our use case for now:
      // https://github.com/vjeux/mp4-h264-re-encode/blob/main/mp4box.html#L103

      // Additional details about codecs can be found here:
      //  - https://developer.mozilla.org/en-US/docs/Web/Media/Formats/codecs_parameter
      //  - https://www.w3.org/TR/webcodecs-codec-registry/#video-codec-registry
      //
      // The following setting is a good compromise between output video file
      // size and quality. The latencyMode "realtime" is needed for Safari,
      // which otherwise will produce 20x larger files when in quality
      // latencyMode. Chrome does a really good job with file size even when
      // latencyMode is set to quality.

      const targetWidth = roundToNearestEven(width);
      const targetHeight = roundToNearestEven(height);

      // Define fallback configurations to try if the primary config fails
      const configurationOptions: VideoEncoderConfig[] = [
        // Primary configuration
        {
          codec: 'avc1.4d0034',
          width: targetWidth,
          height: targetHeight,
          bitrate: 14_000_000,
          alpha: 'discard',
          bitrateMode: 'variable',
          latencyMode: 'realtime',
        },
        // Fallback 1: Lower bitrate
        {
          codec: 'avc1.4d0034',
          width: targetWidth,
          height: targetHeight,
          bitrate: 8_000_000,
          alpha: 'discard',
          bitrateMode: 'variable',
          latencyMode: 'realtime',
        },
        // Fallback 2: Different codec profile
        {
          codec: 'avc1.42e01e',
          width: targetWidth,
          height: targetHeight,
          bitrate: 8_000_000,
          alpha: 'discard',
          bitrateMode: 'variable',
          latencyMode: 'realtime',
        },
        // Fallback 3: Reduce resolution if too high
        {
          codec: 'avc1.42e01e',
          width: Math.min(targetWidth, 1920),
          height: Math.min(targetHeight, 1080),
          bitrate: 6_000_000,
          alpha: 'discard',
          bitrateMode: 'variable',
          latencyMode: 'realtime',
        },
        // Fallback 4: Basic configuration with constant bitrate
        {
          codec: 'avc1.42e01e',
          width: Math.min(targetWidth, 1280),
          height: Math.min(targetHeight, 720),
          bitrate: 4_000_000,
          alpha: 'discard',
          bitrateMode: 'constant',
          latencyMode: 'realtime',
        },
        // Fallback 5: Very conservative settings
        {
          codec: 'avc1.42e01e',
          width: Math.min(targetWidth, 854),
          height: Math.min(targetHeight, 480),
          bitrate: 2_000_000,
          alpha: 'discard',
          bitrateMode: 'constant',
          latencyMode: 'realtime',
        },
        // Fallback 6: Minimal settings for maximum compatibility
        {
          codec: 'avc1.42001e', // H.264 Baseline Profile
          width: Math.min(targetWidth, 640),
          height: Math.min(targetHeight, 360),
          bitrate: 1_000_000,
          alpha: 'discard',
          bitrateMode: 'constant',
          latencyMode: 'realtime',
        },
      ];

      let configurationUsed: VideoEncoderConfig | null = null;
      let lastError: string | null = null;

      // Try each configuration until one is supported
      for (const configuration of configurationOptions) {
        try {
          const supportedConfig = await VideoEncoder.isConfigSupported(configuration);
          if (supportedConfig.supported === true) {
            encoder.configure(configuration);
            configurationUsed = configuration;
            console.log('Video encoder configured with:', configuration);
            break;
          } else {
            lastError = `Config not supported: ${JSON.stringify(supportedConfig)}`;
          }
        } catch (error) {
          lastError = `Error checking config support: ${error}`;
        }
      }

      if (!configurationUsed) {
        // Provide helpful error message about WebCodecs support
        const isWebCodecsSupported = typeof VideoEncoder !== 'undefined';
        const supportInfo = isWebCodecsSupported 
          ? 'WebCodecs is supported but no encoder configuration worked' 
          : 'WebCodecs VideoEncoder is not available';
          
        throw new Error(
          `Video encoding failed: ${supportInfo}. This may be due to browser limitations, hardware restrictions, or unsupported video resolution. Try using a different browser (Chrome/Edge recommended) or download frames instead. Last error: ${lastError}`
        );
      }

      for await (const frame of framesGenerator) {
        const {bitmap, duration, timestamp} = frame;
        durations.push(duration);
        let keyFrame = false;
        if (timestamp >= nextKeyFrameTimestamp) {
          await encoder.flush();
          keyFrame = true;
          nextKeyFrameTimestamp = timestamp + SECONDS_PER_KEY_FRAME * 1e6;
        }
        encoder.encode(bitmap, {keyFrame});
        bitmap.close();
      }

      await encoder.flush();
      encoder.close();
    };

    setConfigurationAndEncodeFrames();
  });
}

function getScaledDuration(rawDuration: number) {
  return rawDuration / (1_000_000 / TIMESCALE);
}

function roundToNearestEven(dim: number) {
  const rounded = Math.round(dim);

  if (rounded % 2 === 0) {
    return rounded;
  } else {
    return rounded + (rounded > dim ? -1 : 1);
  }
}
