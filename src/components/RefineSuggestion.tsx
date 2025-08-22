'use client';

import { useState } from 'react';
import { triageClassify, type TriageResponse } from '@/lib/api';

type Props = {
  /** Read the current composer text */
  getCurrentText: () => string;
  /** Insert text into the composer */
  insertIntoComposer: (text: string) => void;
  /** Optional: return 0..10 distress for extra signal */
  getDistress?: () => number | undefined;
  /** JWT for auth; if omitted, backend will 401 */
  authToken?: string | null;
  /** Optional: current chat session id */
  chatSessionId?: number | null;
};

export default function RefineSuggestion({
  getCurrentText,
  insertIntoComposer,
  getDistress,
  authToken,
  chatSessionId,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TriageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const text = (getCurrentText?.() || '').trim();
    if (!text) {
      setError('Type something first.');
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const triage = await triageClassify({
        capture_text: text,
        distress_0_10: getDistress?.(),
        authToken: authToken ?? undefined,
        // Only pass if it’s a number; avoids JSON "null" noise
        chat_session_id: typeof chatSessionId === 'number' ? chatSessionId : undefined,
      });
      setData(triage);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'string'
          ? e
          : 'Failed to get refinement';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md border border-white/10 bg-white/10 px-3 py-1.5 text-sm text-gray-100 backdrop-blur hover:bg-white/20 disabled:opacity-60"
          title="Suggest the next two prompts based on your message"
          type="button"
        >
          {loading ? 'Refining…' : 'Refine suggestion'}
        </button>
        {error && <span className="text-xs text-rose-300">{error}</span>}
      </div>

      {data && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3">
          {/* Header pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
            <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
              {data.label}
              {typeof data.confidence === 'number' && (
                <span className="ml-1 opacity-80">• {(data.confidence * 100).toFixed(0)}%</span>
              )}
            </span>
            {data.second_choice && (
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2 py-0.5">
                alt: {data.second_choice}
              </span>
            )}
          </div>

          {/* Rationale */}
          {data.rationale && <p className="mt-2 text-sm text-gray-200">{data.rationale}</p>}

          {/* Prompts */}
          <div className="mt-2 flex flex-col gap-2">
            {(Array.isArray(data.prompts) ? data.prompts : []).map((p, i) => (
              <button
                key={`${i}-${p.slice(0, 20)}`}
                onClick={() => insertIntoComposer(p)}
                className="text-left rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-gray-100 hover:bg-white/10"
                type="button"
                title="Insert into composer"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
