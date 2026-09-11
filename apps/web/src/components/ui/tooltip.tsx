'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

type TriggerProps = {
  'aria-describedby'?: string;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
};

export type TooltipProps = {
  content: ReactNode;
  children: ReactElement<TriggerProps>;
  delayMs?: number;
};

export function Tooltip({ content, children, delayMs = 400 }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState<number | null>(null);

  const show = () => {
    const handle = window.setTimeout(() => setOpen(true), delayMs);
    setTimer(handle);
  };
  const hide = () => {
    if (timer != null) window.clearTimeout(timer);
    setTimer(null);
    setOpen(false);
  };

  if (!isValidElement(children)) return children;

  const child = cloneElement(children, {
    'aria-describedby': open ? id : children.props['aria-describedby'],
    onMouseEnter: (e: MouseEvent) => {
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: MouseEvent) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent) => {
      children.props.onFocus?.(e);
      show();
    },
    onBlur: (e: FocusEvent) => {
      children.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <span className="relative inline-flex">
      {child}
      {open ? (
        <span className="absolute start-0 end-0 top-full z-40 mt-token-xs flex justify-center">
          <span
            id={id}
            role="tooltip"
            className="whitespace-nowrap rounded-sm bg-navy px-token-sm py-token-2xs text-token-xs text-on-dark shadow-sm"
          >
            {content}
          </span>
        </span>
      ) : null}
    </span>
  );
}
