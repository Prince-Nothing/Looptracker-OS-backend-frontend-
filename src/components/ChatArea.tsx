'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';
import ChatAreaSkeleton from './ChatAreaSkeleton';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import Sparkline from './Sparkline';

// Local Type Definitions
type Message = {
  id: string;                         // preserves backend id when available
  role: 'user' | 'assistant';
  content: string;
  properties?: Record<string, any>;   // includes thought_process, diagnostics, task_spec, attributions, etc.
};

type Diagnostics = {
  MIIS?: number;
  SRQ?: number;
  EFM?: number;
};

type DiagnosticPoint = {
  timestamp: string;
  diagnostics: {
    MIIS?: number;
    SRQ?: number;
    EFM?: number;
    [k: string]: number | undefined;
  };
};

// Helpful label renderer for attribution chips
const attributionLabel = (a: any): string => {
  if (!a) return 'Source';
  if (a.type === 'file') {
    const name = a.filename || 'file';
    const idx = (typeof a.chunk_index === 'number') ? `#${a.chunk_index}` : '';
    return `${name}${idx}`;
  }
  if (a.type === 'memory') {
    return `Memory #${a.memory_id ?? '?'}`;
  }
  return 'Source';
};

export default function ChatArea() {
  const { authToken, activeSessionId, setActiveSessionId, refreshSessions } = useAppContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({});
  const [series, setSeries] = useState<{ MIIS: number[]; SRQ: number[]; EFM: number[] }>({ MIIS: [], SRQ: [], EFM: [] });
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const [expandedPlan, setExpandedPlan] = useState<Record<string, boolean>>({});
  const [loadingReasoning, setLoadingReasoning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Helper: map backend messages to local Message type (preserve real DB id)
  const mapFetchedMessages = (fetched: any[]): Message[] =>
    fetched.map((msg: any) => ({
      id: String(msg.id ?? crypto.randomUUID()),
      role: msg.role,
      content: msg.content,
      properties: msg.properties || {},
    }));

  // Diagnostics series fetcher
  const fetchDiagnosticsSeries = async (sessionId: number) => {
    try {
      const res = await fetch(`${API_URL}/chats/${sessionId}/diagnostics`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return;
      const data: DiagnosticPoint[] = await res.json();
      const MIIS: number[] = [];
      const SRQ: number[] = [];
      const EFM: number[] = [];
      for (const dp of data) {
        if (typeof dp.diagnostics.MIIS === 'number') MIIS.push(dp.diagnostics.MIIS);
        if (typeof dp.diagnostics.SRQ === 'number') SRQ.push(dp.diagnostics.SRQ);
        if (typeof dp.diagnostics.EFM === 'number') EFM.push(dp.diagnostics.EFM);
      }
      setSeries({ MIIS, SRQ, EFM });
    } catch (e) {
      console.warn('Failed to fetch diagnostics series', e);
      setSeries({ MIIS: [], SRQ: [], EFM: [] });
    }
  };

  // Helper: fetch messages for current session
  const fetchMessagesForSession = async (sessionId: number) => {
    setIsLoadingHistory(true);
    setDiagnostics({});
    try {
      const response = await fetch(`${API_URL}/chats/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const fetchedMessages = await response.json();
        const mapped = mapFetchedMessages(fetchedMessages);
        setMessages(mapped);
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (activeSessionId) {
      const sid = activeSessionId as number;
      fetchMessagesForSession(sid);
      fetchDiagnosticsSeries(sid);
    } else {
      setMessages([]);
      setDiagnostics({});
      setSeries({ MIIS: [], SRQ: [], EFM: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, authToken]);

  const handleSend = async () => {
    if (!input.trim() || !authToken || isStreaming) return;

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `asst-${Date.now()}`;
    const userMessage: Message = { id: userMessageId, role: 'user', content: input };
    const assistantPlaceholder: Message = { id: assistantMessageId, role: 'assistant', content: '', properties: {} };

    setMessages(prev => [...prev, userMessage, assistantPlaceholder]);
    const currentInput = input;
    setInput('');
    setIsStreaming(true);
    let newSessionCreated = false;
    let sessionIdForFetch: number | null = (activeSessionId as number) ?? null;

    try {
      await fetchEventSource(`${API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          message: currentInput,
          chat_session_id: activeSessionId,
        }),
        async onopen(res) {
          if (res.ok && res.status === 200) {
            console.log('Stream connection opened.');
          } else {
            throw new Error(`Failed to connect to the chat stream: ${res.status} ${res.statusText}`);
          }
        },
        onmessage(event) {
          switch (event.event) {
            case 'session_created': {
              newSessionCreated = true;
              const sessionData = JSON.parse(event.data);
              setActiveSessionId(sessionData.chat_session_id);
              sessionIdForFetch = sessionData.chat_session_id;
              break;
            }
            case 'metadata': {
              const metaData = JSON.parse(event.data);
              // Diagnostics (from model or pipeline)
              if (metaData.diagnostics) {
                setDiagnostics(prev => ({ ...prev, ...metaData.diagnostics }));
              }
              // Live TaskSpec (pre_metadata or model metadata) -> attach to placeholder
              if (metaData.task_spec) {
                setMessages(prev =>
                  prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, properties: { ...(msg.properties || {}), task_spec: metaData.task_spec } }
                      : msg
                  )
                );
              }
              // NEW: Attributions chips (streamed early via metadata)
              if (metaData.attributions) {
                setMessages(prev =>
                  prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, properties: { ...(msg.properties || {}), attributions: metaData.attributions } }
                      : msg
                  )
                );
              }
              break;
            }
            case 'text': {
              const textChunk = JSON.parse(event.data);
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMessageId ? { ...msg, content: msg.content + textChunk } : msg
                )
              );
              break;
            }
            case 'end': {
              if (newSessionCreated) {
                refreshSessions();
              }
              if (sessionIdForFetch) {
                // Slightly longer defer so DB commit + serialization definitely complete
                setTimeout(() => {
                  const sid = sessionIdForFetch as number;
                  fetchMessagesForSession(sid);
                  fetchDiagnosticsSeries(sid);
                }, 350);
              }
              break;
            }
            default:
              break;
          }
        },
        onclose() {
          console.log('Stream connection closed by server.');
          setIsStreaming(false);
        },
        onerror(err) {
          console.error('Stream connection error:', err);
          setIsStreaming(false);
          throw err;
        },
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev =>
        prev.map(msg =>
          msg.id === assistantMessageId
            ? { ...msg, content: 'Sorry, an error occurred. Please try again.' }
            : msg
        )
      );
      setIsStreaming(false);
    }
  };

  // Helper: numeric id check (placeholders like "asst-..." are not numeric)
  const isNumericId = (id: string) => /^\d+$/.test(id);

  // Lazy-load reasoning for a single message if absent (preferred: single-message endpoint)
  const ensureReasoningLoaded = async (msg: Message) => {
    if (!activeSessionId) return;
    if (msg.properties?.thought_process) return;

    // If this is a streaming placeholder (non-numeric id), refresh the whole list
    if (!isNumericId(msg.id)) {
      await fetchMessagesForSession(activeSessionId as number);
      return;
    }

    try {
      setLoadingReasoning(prev => ({ ...prev, [msg.id]: true }));
      const response = await fetch(
        `${API_URL}/chats/${activeSessionId}/messages/${msg.id}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (!response.ok) {
        // fallback: refresh list
        await fetchMessagesForSession(activeSessionId as number);
        return;
      }
      const single = await response.json();
      const hydrated: Message = {
        id: String(single.id),
        role: single.role,
        content: single.content,
        properties: single.properties || {},
      };
      setMessages(prev => prev.map(m => (m.id === msg.id ? hydrated : m)));
    } catch (e) {
      console.warn('Could not lazy-load reasoning:', e);
      // fallback: refresh list
      await fetchMessagesForSession(activeSessionId as number);
    } finally {
      setLoadingReasoning(prev => ({ ...prev, [msg.id]: false }));
    }
  };

  // --- RENDER ---
  const last = (arr: number[]) => (arr.length ? arr[arr.length - 1] : undefined);

  return (
    <div className="flex-1 flex flex-col bg-gray-900">
      <div className="p-2 bg-gray-800 border-b border-gray-700 text-xs text-gray-300 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">MIIS:</span>
            <span className="min-w-[2ch] text-white">{diagnostics.MIIS ?? (last(series.MIIS) ?? 'N/A')}</span>
            <span className="text-gray-500">
              <Sparkline data={series.MIIS} ariaLabel="MIIS trend" />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">SRQ:</span>
            <span className="min-w-[2ch] text-white">{diagnostics.SRQ ?? (last(series.SRQ) ?? 'N/A')}</span>
            <span className="text-gray-500">
              <Sparkline data={series.SRQ} ariaLabel="SRQ trend" />
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">EFM:</span>
            <span className="min-w-[2ch] text-white">{diagnostics.EFM ?? (last(series.EFM) ?? 'N/A')}</span>
            <span className="text-gray-500">
              <Sparkline data={series.EFM} ariaLabel="EFM trend" />
            </span>
          </div>
        </div>
      </div>

      {isLoadingHistory ? (
        <ChatAreaSkeleton />
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map(msg => {
            const isAssistant = msg.role === 'assistant';
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

            const atts: any[] = (isAssistant && Array.isArray(msg.properties?.attributions))
              ? msg.properties!.attributions as any[]
              : [];

            return (
              <div
                key={msg.id}
                className={`flex items-start gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {isAssistant && <div className="w-8 h-8 rounded-full bg-gray-600 flex-shrink-0" />}
                <div
                  className={`prose prose-invert max-w-xl px-5 py-3 rounded-2xl ${
                    msg.role === 'user' ? 'bg-blue-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'
                  }`}
                >
                  {msg.content === '' && isAssistant && isStreaming ? (
                    <span className="animate-pulse">▍</span>
                  ) : (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  )}

                  {isAssistant && (
                    <div className="mt-3 space-y-2">
                      {/* Attributions chips */}
                      {atts.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {atts.map((a, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300"
                              title={JSON.stringify(a)}
                            >
                              {attributionLabel(a)}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Plan/Reasoning controls */}
                      <div className="flex flex-wrap items-center gap-3">
                        {hasPlan ? (
                          <>
                            <button
                              className="text-xs text-gray-300 hover:text-white underline underline-offset-2"
                              onClick={() => setExpandedPlan(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                              aria-expanded={expandedP}
                              aria-controls={`plan-${msg.id}`}
                            >
                              {expandedP ? 'Hide plan' : 'Show plan'}
                            </button>
                            {(plan.risk_tolerance || plan.latency_budget_ms) && (
                              <div className="flex gap-2">
                                {plan.risk_tolerance && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
                                    risk: {String(plan.risk_tolerance)}
                                  </span>
                                )}
                                {typeof plan.latency_budget_ms === 'number' && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
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
                            className="text-xs text-gray-300 hover:text-white underline underline-offset-2"
                            onClick={() => setExpandedReasoning(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                            aria-expanded={expandedR}
                            aria-controls={`reasoning-${msg.id}`}
                          >
                            {expandedR ? 'Hide reasoning' : 'Show reasoning'}
                          </button>
                        ) : (
                          // Fallback: allow manual load if reasoning didn't arrive yet
                          <button
                            className={`text-xs underline underline-offset-2 ${loadBusy ? 'text-gray-500' : 'text-gray-400 hover:text-white'}`}
                            onClick={async () => {
                              if (!loadBusy) {
                                await ensureReasoningLoaded(msg);
                                setExpandedReasoning(prev => ({ ...prev, [msg.id]: true }));
                              }
                            }}
                            disabled={isStreaming || loadBusy}
                            title={/^\d+$/.test(msg.id) ? 'Load the saved reasoning for this message' : 'Waiting for message to finalize'}
                          >
                            {loadBusy ? 'Loading…' : 'Load reasoning'}
                          </button>
                        )}
                      </div>

                      {/* Plan panel */}
                      {hasPlan && expandedP && (
                        <div id={`plan-${msg.id}`} className="mt-1 text-xs bg-gray-800 border border-gray-700 rounded-lg p-3">
                          {plan.task && (
                            <div className="mb-2">
                              <div className="uppercase tracking-wider text-[10px] text-gray-400">Task</div>
                              <div className="text-gray-200">{plan.task}</div>
                            </div>
                          )}
                          {Array.isArray(plan.success_criteria) && plan.success_criteria.length > 0 && (
                            <div className="mb-2">
                              <div className="uppercase tracking-wider text-[10px] text-gray-400">Success criteria</div>
                              <ul className="list-disc pl-5">
                                {plan.success_criteria.map((s, i) => (
                                  <li key={i} className="text-gray-200">{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {Array.isArray(plan.constraints) && plan.constraints.length > 0 && (
                            <div className="mb-2">
                              <div className="uppercase tracking-wider text-[10px] text-gray-400">Constraints</div>
                              <ul className="list-disc pl-5">
                                {plan.constraints.map((c, i) => (
                                  <li key={i} className="text-gray-200">{c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {!plan.task && !plan.success_criteria?.length && !plan.constraints?.length && (
                            <pre className="whitespace-pre-wrap text-gray-300">
                              {JSON.stringify(plan, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Reasoning panel */}
                      {hasReasoning && expandedR && (
                        <pre
                          id={`reasoning-${msg.id}`}
                          className="mt-1 text-xs bg-gray-800 border border-gray-700 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap"
                          style={{ maxHeight: '300px' }}
                        >
                          {msg.properties?.thought_process}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && <div className="w-8 h-8 rounded-full bg-blue-500 flex-shrink-0" />}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="p-4 bg-gray-800 border-t border-gray-700">
        <div className="flex items-center">
          <textarea
            rows={1}
            className="flex-1 bg-gray-700 rounded-2xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-y-auto"
            style={{ maxHeight: '100px' }}
            placeholder="Talk to your OS..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isStreaming || isLoadingHistory}
          />
          <button
            onClick={handleSend}
            className="ml-4 bg-blue-600 text-white rounded-full p-3 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            disabled={!input.trim() || isStreaming || isLoadingHistory}
            aria-label="Send message"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
