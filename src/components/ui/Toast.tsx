'use client';

import * as React from 'react';

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export type ToastVariant = 'neutral' | 'success' | 'error' | 'warning' | 'info';

export interface ToastProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  onClose?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

const variantChrome: Record<ToastVariant, { ring: string; dot: string; icon: React.ReactNode }> = {
  neutral: {
    ring: 'ring-white/15',
    dot: 'bg-white/40',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  success: {
    ring: 'ring-emerald-400/30',
    dot: 'bg-emerald-400',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M9 12l2 2 4-4 1.5 1.5-5.5 5.5L7.5 13.5 9 12z" />
      </svg>
    ),
  },
  error: {
    ring: 'ring-red-400/30',
    dot: 'bg-red-400',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M13.41 12l4.3-4.29-1.42-1.42L12 10.59 7.71 6.29 6.29 7.71 10.59 12l-4.3 4.29 1.42 1.42L12 13.41l4.29 4.3 1.42-1.42z" />
      </svg>
    ),
  },
  warning: {
    ring: 'ring-amber-400/30',
    dot: 'bg-amber-400',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M11 7h2v6h-2V7zm0 8h2v2h-2v-2z" />
      </svg>
    ),
  },
  info: {
    ring: 'ring-cyan-400/30',
    dot: 'bg-cyan-400',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M11 17h2v-6h-2v6zm0-8h2V7h-2v2z" />
      </svg>
    ),
  },
};

export const Toast: React.FC<ToastProps> = ({
  className,
  title,
  description,
  variant = 'neutral',
  onClose,
  actionLabel,
  onAction,
  ...props
}) => {
  const chrome = variantChrome[variant];

  return (
    <div
      className={cn(
        'glass pointer-events-auto flex w-full min-w-[280px] max-w-sm items-start gap-3 rounded-2xl border border-white/10 bg-black/40 p-3 ring-1',
        chrome.ring,
        className
      )}
      role="status"
      {...props}
    >
      <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', chrome.dot)} aria-hidden />
      <div className="flex-1">
        {title && <div className="text-sm font-semibold text-white">{title}</div>}
        {description && <div className="mt-0.5 text-xs text-gray-300">{description}</div>}
        {actionLabel && (
          <button
            onClick={onAction}
            className="mt-2 inline-flex text-xs text-cyan-200 underline underline-offset-2 hover:text-white"
          >
            {actionLabel}
          </button>
        )}
      </div>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="rounded-md p-1 text-gray-400 hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M13.41 12l4.3-4.29-1.42-1.42L12 10.59 7.71 6.29 6.29 7.71 10.59 12l-4.3 4.29 1.42 1.42L12 13.41l4.29 4.3 1.42-1.42z" />
        </svg>
      </button>
    </div>
  );
};
