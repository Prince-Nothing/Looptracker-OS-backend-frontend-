'use client';

import * as React from 'react';

type Variant =
  | 'primary'
  | 'subtle'
  | 'ghost'
  | 'danger'
  | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

const base =
  'inline-flex items-center justify-center gap-2 select-none rounded-xl font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 disabled:opacity-50 disabled:pointer-events-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-cyan-400 to-violet-500 text-black shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30',
  subtle:
    'bg-white/8 text-white border border-white/10 hover:bg-white/12',
  ghost:
    'bg-transparent text-gray-200 hover:bg-white/8',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/50',
  outline:
    'bg-transparent text-white border border-white/15 hover:bg-white/8',
};

const sizes: Record<Size, string> = {
  sm: 'text-sm h-8 px-3',
  md: 'text-sm h-10 px-4',
  lg: 'text-base h-12 px-5',
  icon: 'h-10 w-10 p-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, leftIcon, rightIcon, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        aria-busy={loading ? 'true' : undefined}
        {...props}
      >
        {loading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" />
          </svg>
        ) : (
          <>
            {leftIcon && <span className="shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);
Button.displayName = 'Button';
