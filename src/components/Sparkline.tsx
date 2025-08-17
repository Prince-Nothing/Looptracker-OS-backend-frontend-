'use client';

import React from 'react';

type Props = {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  ariaLabel?: string;
};

export default function Sparkline({
  data,
  width = 90,
  height = 24,
  strokeWidth = 1.5,
  ariaLabel = 'sparkline'
}: Props) {
  if (!data || data.length < 2) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        className="text-[10px] text-gray-500"
        style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        —
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid div by zero if flat

  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    // Flip Y (SVG origin is top-left)
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const last = data[data.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${ariaLabel}: latest ${last}`}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        points={points}
      />
    </svg>
  );
}
