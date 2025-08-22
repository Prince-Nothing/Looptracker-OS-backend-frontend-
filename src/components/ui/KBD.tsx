'use client';

import * as React from 'react';

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export interface KBDProps extends React.HTMLAttributes<HTMLElement> {}

export const KBD: React.FC<KBDProps> = ({ className, ...props }) => (
  <kbd
    className={cn(
      'rounded border border-white/20 bg-white/10 px-1 text-[11px] font-mono',
      className
    )}
    {...props}
  />
);
