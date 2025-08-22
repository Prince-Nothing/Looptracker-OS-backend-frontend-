'use client';

import Sparkline from '../Sparkline';
import type { Diagnostics, Series } from './types';

type Props = {
  diagnostics: Diagnostics;
  series: Series;
  isStreaming: boolean;
  prefillToast: string | null;
  onStop: () => void;
};

export default function HeaderChips({
  diagnostics,
  series,
  isStreaming,
  prefillToast,
  onStop,
}: Props) {
  const last = (arr: number[]) => (arr.length ? arr[arr.length - 1] : undefined);

  return (
    <div className="sticky top-0 z-20 border-b border-white/10 bg-black/30 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-center gap-3 overflow-x-auto">
          {[
            { key: 'MIIS', value: diagnostics.MIIS ?? last(series.MIIS), data: series.MIIS },
            { key: 'SRQ', value: diagnostics.SRQ ?? last(series.SRQ), data: series.SRQ },
            { key: 'EFM', value: diagnostics.EFM ?? last(series.EFM), data: series.EFM },
          ].map((m) => (
            <div
              key={m.key}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1"
            >
              <span className="text-[11px] tracking-wide text-gray-300">{m.key}</span>
              <span className="min-w-[2ch] text-sm font-medium text-white">
                {typeof m.value === 'number' ? m.value : 'N/A'}
              </span>
              <span className="text-gray-500">
                <Sparkline data={m.data} ariaLabel={`${m.key} trend`} />
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {prefillToast && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
              {prefillToast}
            </div>
          )}
          {isStreaming && (
            <button
              onClick={onStop}
              className="rounded-md border border-red-500/40 bg-red-500/15 px-2 py-1 text-xs text-red-200"
              title="Stop generating"
              aria-label="Stop generating"
              type="button"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
