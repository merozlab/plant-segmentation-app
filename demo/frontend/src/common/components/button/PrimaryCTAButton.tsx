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
import GradientBorder from '@/common/components/button/GradientBorder';
import { Loading } from 'react-daisyui';
import type {ReactNode} from 'react';

type Props = {
  disabled?: boolean;
  endIcon?: ReactNode;
  loadingProps?: {
    loading: boolean;
    label?: string;
  };
} & React.DOMAttributes<HTMLButtonElement>;

export default function PrimaryCTAButton({
  children,
  disabled,
  endIcon,
  loadingProps,
  ...props
}: Props) {
  const isLoading = loadingProps?.loading === true;
  const effectiveDisabled = disabled || isLoading;

  return (
    <GradientBorder disabled={effectiveDisabled}>
      <button
        className={`btn ${effectiveDisabled && 'btn-disabled'} !rounded-full !bg-black !text-white !border-none`}
        {...props}>
        <span className="flex items-center gap-2">
          {isLoading && <Loading size="sm" />}
          {isLoading && loadingProps?.label != null
            ? loadingProps.label
            : children}
          {!isLoading && endIcon != null && endIcon}
        </span>
      </button>
    </GradientBorder>
  );
}
