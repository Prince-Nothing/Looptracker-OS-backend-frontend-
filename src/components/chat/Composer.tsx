'use client';

import { forwardRef } from 'react';

type Props = {
  value: string;
  setValue: (v: string) => void;
  disabled: boolean;
  isStreaming: boolean;
  onSend: () => void;
  onStop: () => void;
};

const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { value, setValue, disabled, isStreaming, onSend, onStop },
  ref
) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-white/10 bg-black/40 pb-safe backdrop-blur-md">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-white/5 p-2 shadow-sm">
          <textarea
            ref={ref}
            rows={1}
            className="max-h-[160px] flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2 text-white placeholder-gray-400 outline-none focus-visible:ring-0"
            placeholder="Talk to your OS…  (Shift+Enter for newline)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
              if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) || e.key === 'NumpadEnter') {
                e.preventDefault();
                onSend();
              }
              if (e.key === 'Escape') {
                setValue('');
              }
            }}
            disabled={disabled}
            aria-label="Message input"
          />

          <div className="flex items-center gap-2 pr-1">
            {isStreaming && (
              <button
                onClick={onStop}
                className="rounded-full border border-red-500/50 bg-red-500/20 p-3 text-red-100 hover:bg-red-500/30 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                aria-label="Stop generating"
                title="Stop generating"
                type="button"
              >
                ■
              </button>
            )}

            <button
              onClick={onSend}
              className="rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 p-3 text-black shadow-md shadow-violet-500/20 hover:shadow-lg hover:shadow-violet-500/30 focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-50"
              disabled={!value.trim() || disabled}
              aria-label="Send message"
              title="Send message"
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12m0 0h7.5"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-2 pl-2 text-[11px] text-gray-500">
          Press <kbd>Enter</kbd> to send • <kbd>Shift</kbd>+<kbd>Enter</kbd> for newline
        </div>
      </div>
    </div>
  );
});

export default Composer;
