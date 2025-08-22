'use client';

import * as React from 'react';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
type Size = 'sm' | 'md';

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: Size;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

const tones: Record<Tone, string> = {
  neutral: 'bg-white/8 text-gray-200 border-white/10',
  info: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/25',
  success: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/25',
  warning: 'bg-amber-500/15 text-amber-200 border-amber-400/25',
  danger: 'bg-red-500/15 text-red-200 border-red-400/25',
};

const sizes: Record<Size, string> = {
  sm: 'text-[11px] px-2 py-0.5',
  md: 'text-sm px-2.5 py-0.5',
};

export const Chip: React.FC<ChipProps> = ({ className, tone = 'neutral', size = 'sm', ...props }) => (
  <span
    className={cn('inline-flex items-center rounded-full border', tones[tone], sizes[size], className)}
    {...props}
  />
);
