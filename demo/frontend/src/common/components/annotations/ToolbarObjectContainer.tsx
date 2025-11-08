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
import {Close} from '@carbon/icons-react';
import {PropsWithChildren, ReactNode} from 'react';

type ToolbarObjectContainerProps = PropsWithChildren<{
  alignItems?: 'top' | 'center';
  isActive: boolean;
  title: string;
  subtitle: string;
  thumbnail: ReactNode;
  isMobile: boolean;
  onCancel?: () => void;
  onClick?: () => void;
}>;

export default function ToolbarObjectContainer({
  alignItems = 'top',
  children,
  isActive,
  title,
  subtitle,
  thumbnail,
  isMobile,
  onClick,
  onCancel,
}: ToolbarObjectContainerProps) {
  if (isMobile) {
    return (
      <div
        onClick={onClick}
        className="flex overflow-hidden cursor-pointer shrink-0 border-t-0 bg-black pb-[10px] items-center">
        <div className="grow items-center">{children}</div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`flex overflow-hidden cursor-pointer shrink-0 border-t-0 ${
        isActive ? 'bg-black rounded-2xl p-4' : ''
      } ${alignItems === 'center' ? 'items-center' : ''}`}>
      {thumbnail}
      <div className="ms-4 grow items-center">
        <div className="text-md font-semibold ml-2">{title}</div>
        {subtitle.length > 0 && (
          <div className="text-sm text-gray-400 leading-5 mt-2 ml-2">
            {subtitle}
          </div>
        )}
        {children}
      </div>
      {onCancel != null && (
        <div className="items-start self-stretch" onClick={onCancel}>
          <Close size={32} />
        </div>
      )}
    </div>
  );
}
