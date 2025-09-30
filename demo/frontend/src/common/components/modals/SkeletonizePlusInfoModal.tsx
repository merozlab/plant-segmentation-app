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
import { Modal } from 'react-daisyui';
import { Close } from '@carbon/icons-react';
import stylex from '@stylexjs/stylex';

const styles = stylex.create({
  container: {
    position: 'relative',
    minWidth: '700px',
    maxWidth: '800px',
    maxHeight: '85vh',
    overflow: 'hidden',
    color: '#fff',
    boxShadow: '0 0 100px 50px #000',
    borderRadius: 16,
    border: '2px solid transparent',
    background:
      'linear-gradient(#1A1C1F, #1A1C1F) padding-box, linear-gradient(to right bottom, #FB73A5,#595FEF,#94EAE2,#FCCB6B) border-box',
  },
  closeButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: 12,
    zIndex: 10,
    cursor: 'pointer',
    ':hover': {
      opacity: 0.7,
    },
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: 24,
  },
  header: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  scrollContainer: {
    overflowY: 'auto',
    paddingRight: 8,
    marginBottom: 24,
    maxHeight: 'calc(85vh - 200px)',
  },
  stage: {
    marginBottom: 20,
  },
  stageTitle: {
    fontSize: '1.125rem',
    fontWeight: 600,
    marginBottom: 8,
    color: '#fff',
  },
  stageDescription: {
    fontSize: '0.875rem',
    color: '#d1d5db',
    lineHeight: 1.6,
  },
  buttonContainer: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 16,
  },
  button: {
    padding: '12px 32px',
    borderRadius: 8,
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    border: 'none',
    minWidth: '120px',
    backgroundColor: '#0064E0',
    color: '#fff',
    ':hover': {
      backgroundColor: '#0056cc',
    },
  },
});

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function SkeletonizePlusInfoModal({ visible, onClose }: Props) {
  if (!visible) return null;

  return (
    <Modal open={visible} {...stylex.props(styles.container)}>
      <div onClick={onClose} {...stylex.props(styles.closeButton)}>
        <Close size={28} />
      </div>
      <Modal.Body>
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.header)}>
            <div {...stylex.props(styles.title)}>Skeletonize+ Algorithm</div>
          </div>

          <div {...stylex.props(styles.scrollContainer)}>
            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>1. Adaptive Parameter Calculation:</strong> Uses PCA to estimate the rod's length and width, then calculates how many points the centerline needs and what portion of the contour to use for endpoint detection.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>2. Point Distribution:</strong> Redistributes points uniformly along curves by calculating cumulative distance and interpolating at evenly spaced intervals.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>3. Skeleton Endpoint Detection:</strong> Skeletonizes the mask and identifies endpoints by finding pixels with exactly one neighbor, giving robust endpoint locations even for curved rods.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>4. Neighborhood Extraction:</strong> Extracts a small region of contour points around each endpoint based on the calculated edge percentage.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>5. Rectangle Fitting:</strong> Fits a rectangle to each endpoint neighborhood using PCA to determine the rod's orientation at its ends.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>6. Contour Intercept Finding:</strong> Finds where the perpendicular axis through each rectangle (the width axis) intersects the contour, marking the rod's edge boundaries.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>7. Edge Segment Extraction:</strong> Extracts two contour segments running along opposite sides of the rod between the intersection points found in Stage 6.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>8. Centerline Computation:</strong> Averages the two edge segments point-by-point to produce the final centerline, then validates all points lie within the mask.
              </div>
            </div>

            <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <div {...stylex.props(styles.stageTitle)} style={{ marginBottom: 16 }}>Advanced Options</div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>Number of Points:</strong> Controls the resolution of the output centerline. Leave empty for automatic calculation (recommended), which determines the optimal number based on the rod's length. Manual values between 50-500 can be specified for finer or coarser sampling.
              </div>
            </div>

            <div {...stylex.props(styles.stage)}>
              <div {...stylex.props(styles.stageDescription)}>
                <strong>Edge Percentage:</strong> Determines what portion of the contour near each endpoint is used for orientation detection (Stage 4). Leave empty for automatic calculation (recommended). Lower values (1-10%) focus on the very tips of the rod, while higher values (20-50%) include more of the contour. Useful for fine-tuning when dealing with irregular or curved endpoints.
              </div>
            </div>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}