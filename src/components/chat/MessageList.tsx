'use client';

import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { Message } from './types';

type Props = {
  messages: Message[];
  isStreaming: boolean;
  expandedReasoning: Record<string, boolean>;
  setExpandedReasoning: (u: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  expandedPlan: Record<string, boolean>;
  setExpandedPlan: (u: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  loadingReasoning: Record<string, boolean>;
  onLoadReasoning: (msg: Message) => Promise<void>;
  onCopyMessage: (content: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;    // <- loosened
  messagesEndRef: React.RefObject<HTMLDivElement | null>;  // <- loosened
  onScroll: () => void;
};

const attributionLabel = (a: any): string => {
  if (!a) return 'Source';
  if (a.type === 'file') {
    const name = a.filename || 'file';
    const idx = typeof a.chunk_index === 'number' ? `#${a.chunk_index}` : '';
    return `${name}${idx}`;
  }
  if (a.type === 'memory') return `Memory #${a.memory_id ?? '?'}`;
  return 'Source';
};

function PreWithCopy(props: any) {
  const raw =
    typeof props?.children?.[0]?.props?.children?.[0] === 'string'
      ? (props.children[0].props.children[0] as string)
      : String(props.children).replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
    } catch {}
  };

  return (
    <div className="relative my-2 max-w-full">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-gray-100 backdrop-blur hover:bg-white/20"
        title="Copy code"
        aria-label="Copy code"
        type="button"
      >
        Copy
      </button>
      <pre className="max-w-full overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[13px] text-gray-100">
        {props.children}
      </pre>
    </div>
  );
}

const md: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-6 text-[15px] text-gray-100">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-white/40 underline-offset-2 hover:text-white"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1.5 first:mt-0 last:mb-0 list-disc pl-5 marker:text-white/60">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-1.5 first:mt-0 last:mb-0 list-decimal pl-5 marker:text-white/60">{children}</ol>
  ),
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  h1: ({ children }) => <h1 className="mt-1 mb-1 text-[17px] font-semibold text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-1 mb-1 text-[16px] font-semibold text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-1 mb-1 text-[15px] font-semibold text-white">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-white/20 pl-3 text-gray-300 italic">{children}</blockquote>
  ),
  code: (props) => <code className="rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-gray-100">{props.children}</code>,
  pre: (props) => <PreWithCopy {...props} />,
  hr: () => <hr className="my-2 border-white/10" />,
};

export default function MessageList({
  messages,
  isStreaming,
  expandedReasoning,
  setExpandedReasoning,
  expandedPlan,
  setExpandedPlan,
  loadingReasoning,
  onLoadReasoning,
  onCopyMessage,
  containerRef,
  messagesEndRef,
  onScroll,
}: Props) {
  const bubbles = useMemo(() => {
    return messages.map((msg, idx) => {
      const isAssistant = msg.role === 'assistant';
      const prev = messages[idx - 1];
      const next = messages[idx + 1];

      const groupedWithPrev = prev && prev.role === msg.role;
      const groupedWithNext = next && next.role === msg.role;

      const showLeftAvatar = isAssistant && (!prev || prev.role !== 'assistant');
      const showRightAvatar = !isAssistant && (!next || next.role !== 'user');

      const hasReasoning = !!msg.properties?.thought_process && isAssistant;
      const hasPlan = !!msg.properties?.task_spec && isAssistant;
      const expandedR = !!expandedReasoning[msg.id];
      const expandedP = !!expandedPlan[msg.id];
      const loadBusy = !!loadingReasoning[msg.id];

      const plan = (msg.properties?.task_spec ?? {}) as {
        task?: string;
        constraints?: string[];
        success_criteria?: string[];
        risk_tolerance?: string;
        latency_budget_ms?: number;
      };

      const atts: any[] =
        isAssistant && Array.isArray(msg.properties?.attributions) ? (msg.properties!.attributions as any[]) : [];

      const marginTop = idx === 0 ? '' : groupedWithPrev ? 'mt-2' : 'mt-6';
      const baseBubble = 'group/bubble relative max-w-[680px] break-words px-5 py-3 shadow-sm rounded-2xl';
      const roleBubble = isAssistant
        ? 'border border-white/10 bg-white/5 text-gray-100'
        : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white';
      const cornerTrim = isAssistant
        ? `${groupedWithPrev ? 'rounded-tl-md' : 'rounded-tl-2xl'} ${groupedWithNext ? 'rounded-bl-md' : 'rounded-bl-none'}`
        : `${groupedWithPrev ? 'rounded-tr-md' : 'rounded-tr-2xl'} ${groupedWithNext ? 'rounded-br-md' : 'rounded-br-none'}`;

      return (
        <div
          key={msg.id}
          className={`flex items-end gap-3 ${isAssistant ? 'justify-start' : 'justify-end'} ${marginTop}`}
        >
          {showLeftAvatar && (
            <div className="mb-0.5 h-8 w-8 flex-shrink-0 rounded-full bg-gradient-to-br from-cyan-400/70 to-violet-500/70 ring-1 ring-white/10" />
          )}
          {!showLeftAvatar && isAssistant && <div className="w-8" />}

          <div className={`${baseBubble} ${roleBubble} ${cornerTrim}`}>
            <div className="pointer-events-none absolute right-2 top-2 opacity-0 transition group-hover/bubble:opacity-100">
              <button
                type="button"
                onClick={() => onCopyMessage(msg.content)}
                className="pointer-events-auto rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] text-gray-100 backdrop-blur hover:bg-white/20"
                title="Copy message"
                aria-label="Copy message"
              >
                Copy
              </button>
            </div>

            {msg.content === '' && isAssistant && isStreaming ? (
              <span className="animate-pulse">▍</span>
            ) : (
              <ReactMarkdown components={md}>{msg.content}</ReactMarkdown>
            )}

            {/* Assistant extras */}
            {isAssistant && (
              <div className="mt-3 space-y-2">
                {/* Attributions */}
                {atts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {atts.map((a, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-300"
                        title={JSON.stringify(a)}
                      >
                        {attributionLabel(a)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  {hasPlan ? (
                    <>
                      <button
                        className="text-xs text-gray-300 underline underline-offset-2 hover:text-white"
                        onClick={() => setExpandedPlan((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                        aria-expanded={expandedP}
                        aria-controls={`plan-${msg.id}`}
                        type="button"
                      >
                        {expandedP ? 'Hide plan' : 'Show plan'}
                      </button>
                      {(plan.risk_tolerance || plan.latency_budget_ms) && (
                        <div className="flex gap-2">
                          {plan.risk_tolerance && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-300">
                              risk: {String(plan.risk_tolerance)}
                            </span>
                          )}
                          {typeof plan.latency_budget_ms === 'number' && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-300">
                              budget: {plan.latency_budget_ms}ms
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-500">Waiting for plan…</span>
                  )}

                  {hasReasoning ? (
                    <button
                      className="text-xs text-gray-300 underline underline-offset-2 hover:text-white"
                      onClick={() => setExpandedReasoning((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                      aria-expanded={expandedR}
                      aria-controls={`reasoning-${msg.id}`}
                      type="button"
                    >
                      {expandedR ? 'Hide reasoning' : 'Show reasoning'}
                    </button>
                  ) : (
                    <button
                      className={`text-xs underline underline-offset-2 ${
                        loadBusy ? 'text-gray-500' : 'text-gray-400 hover:text-white'
                      }`}
                      onClick={async () => {
                        if (!loadBusy) {
                          await onLoadReasoning(msg);
                          setExpandedReasoning((prev) => ({ ...prev, [msg.id]: true }));
                        }
                      }}
                      disabled={loadBusy}
                      title="Load the saved reasoning for this message"
                      type="button"
                    >
                      {loadBusy ? 'Loading…' : 'Load reasoning'}
                    </button>
                  )}
                </div>

                {/* Plan panel */}
                {hasPlan && expandedP && (
                  <div id={`plan-${msg.id}`} className="mt-1 rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
                    {plan.task && (
                      <div className="mb-2">
                        <div className="text-[10px] uppercase tracking-wider text-gray-400">Task</div>
                        <div className="text-gray-200">{plan.task}</div>
                      </div>
                    )}
                    {Array.isArray(plan.success_criteria) && plan.success_criteria.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] uppercase tracking-wider text-gray-400">Success criteria</div>
                        <ul className="list-disc pl-5">
                          {plan.success_criteria.map((s, i) => (
                            <li key={i} className="text-gray-200">
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(plan.constraints) && plan.constraints.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] uppercase tracking-wider text-gray-400">Constraints</div>
                        <ul className="list-disc pl-5">
                          {plan.constraints.map((c, i) => (
                            <li key={i} className="text-gray-200">
                              {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!plan.task && !plan.success_criteria?.length && !plan.constraints?.length && (
                      <pre className="whitespace-pre-wrap text-gray-300">{JSON.stringify(plan, null, 2)}</pre>
                    )}
                  </div>
                )}

                {/* Reasoning panel */}
                {hasReasoning && expandedR && (
                  <pre
                    id={`reasoning-${msg.id}`}
                    className="mt-1 max-h-[300px] overflow-x-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-white/5 p-3 text-xs"
                  >
                    {msg.properties?.thought_process}
                  </pre>
                )}
              </div>
            )}
          </div>

          {showRightAvatar && (
            <div className="mb-0.5 h-8 w-8 flex-shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 ring-1 ring-white/10" />
          )}
          {!showRightAvatar && !isAssistant && <div className="w-8" />}
        </div>
      );
    });
  }, [
    messages,
    isStreaming,
    expandedReasoning,
    setExpandedReasoning,
    expandedPlan,
    setExpandedPlan,
    loadingReasoning,
    onLoadReasoning,
    onCopyMessage,
  ]);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="scroll-fade scrollbar-thin relative flex-1 overflow-y-auto px-4 py-6"
      role="log"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl flex-col">{bubbles}</div>
      <div ref={messagesEndRef} />
    </div>
  );
}
