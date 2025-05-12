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
import Tooltip from '@/common/components/Tooltip';
import { CarbonIconType } from '@carbon/icons-react';

type ActionButtonProps = {
    message: string;
    onClick?: () => void;
    isDisabled?: boolean;
    icon: CarbonIconType;
    iconClassName?: string;
    buttonClassName?: string;
    activeState?: number; // Optional prop to manage different active styles like in ToggleEffectsButton
};

export default function ActionButton({
    message,
    onClick,
    isDisabled,
    icon: Icon,
    iconClassName,
    buttonClassName,
    activeState,
}: ActionButtonProps) {
    let currentButtonClassName = 'bg-white text-green-700 hover:bg-green-200';
    let currentIconClassName = 'text-gray-800 group-hover:text-gray-900';

    if (activeState === 1) {
        currentButtonClassName = 'bg-white text-black hover:bg-gray-200';
        currentIconClassName = 'text-black group-hover:text-green-700';
    } else if (activeState === 2) {
        currentButtonClassName = 'bg-white text-blue-700 hover:bg-blue-200';
        currentIconClassName = 'text-blue-700 group-hover:text-blue-900';
    }

    if (buttonClassName) {
        currentButtonClassName = buttonClassName;
    }

    if (iconClassName) {
        currentIconClassName = iconClassName;
    }


    return (
        <Tooltip message={message}>
            <button
                disabled={isDisabled}
                className={`group !rounded-full !w-8 !h-8 flex items-center justify-center ${isDisabled
                    ? '!bg-gray-400 !text-graydark-700 cursor-not-allowed'
                    : currentButtonClassName
                    }`}
                onClick={onClick}>
                <Icon
                    size={18}
                    className={
                        isDisabled
                            ? 'text-graydark-600'
                            : currentIconClassName
                    }
                />
            </button>
        </Tooltip>
    );
}
