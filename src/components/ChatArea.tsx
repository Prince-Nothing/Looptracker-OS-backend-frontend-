'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';
import ChatAreaSkeleton from './ChatAreaSkeleton';
import { fetchEventSource } from '@microsoft/fetch-event-source';
// import RefineSuggestion from './RefineSuggestion';
// Update the import path below if the file exists elsewhere, e.g.:
// import RefineSuggestion from './chat/RefineSuggestion';
import HeaderChips from './chat/HeaderChips';
import MessageList from './chat/MessageList';
import Composer from './chat/Composer';
import ScrollToBottom from './chat/ScrollToBottom';
import type { Message, Diagnostics, DiagnosticPoint, Series } from './chat/types';
import RefineSuggestion from './RefineSuggestion';

/* ---------------- Component ---------------- */
export default function ChatArea() {
  const { authToken, activeSessionId, setActiveSessionId, refreshSessions } = useAppContext();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({});
  const [series, setSeries] = useState<Series>({ MIIS: [], SRQ: [], EFM: [] });

  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const [expandedPlan, setExpandedPlan] = useState<Record<string, boolean>>({});
  const [loadingReasoning, setLoadingReasoning] = useState<Record<string, boolean>>({});
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // UI / scroll
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Input focus + prefill toast
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [prefillToast, setPrefillToast] = useState<string | null>(null);

  // Abort controller for streaming
  const streamAbortRef = useRef<AbortController | null>(null);

  /* ---------------- Effects ---------------- */

  // Keep scroll pinned to bottom when already at bottom
  useEffect(() => {
    if (!containerRef.current) return;
    if (atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Detect prefill set by Loops (“Send to Chat”), focus input, show toast
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pf = localStorage.getItem('lt_prefill');
    if (pf && pf.trim().length > 0) {
      setInput(pf);
      localStorage.removeItem('lt_prefill');
      setTimeout(() => inputRef.current?.focus(), 0);
      setPrefillToast('Loaded from Loops — press Enter to send');
      const t = setTimeout(() => setPrefillToast(null), 2400);
      return () => clearTimeout(t);
    }
  }, []);

  // Auto-resize textarea (1–6 rows)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const next = Math.min(160, el.scrollHeight); // ~6 rows
    el.style.height = `${next}px`;
  }, [input]);

  // Map backend messages to local type
  const mapFetchedMessages = (fetched: any[]): Message[] =>
    fetched.map((msg: any) => ({
      id: String(msg.id ?? crypto.randomUUID()),
      role: msg.role,
      content: msg.content,
      properties: msg.properties || {},
    }));

  // Diagnostics series
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

  // Fetch messages for current session
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
      setErrorBanner('Failed to load chat history.');
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

  /* ---------------- Actions ---------------- */

  const stopStreaming = () => {
    try {
      streamAbortRef.current?.abort();
    } catch {}
    setIsStreaming(false);
  };

  const handleSend = async () => {
    if (!input.trim() || !authToken || isStreaming) return;

    if (prefillToast) setPrefillToast(null);
    setErrorBanner(null);

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `asst-${Date.now()}`;
    const userMessage: Message = { id: userMessageId, role: 'user', content: input };
    const assistantPlaceholder: Message = { id: assistantMessageId, role: 'assistant', content: '', properties: {} };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    const currentInput = input;
    setInput('');
    setIsStreaming(true);
    let newSessionCreated = false;
    let sessionIdForFetch: number | null = (activeSessionId as number) ?? null;

    const controller = new AbortController();
    streamAbortRef.current = controller;

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
        signal: controller.signal,
        async onopen(res) {
          if (res.ok && res.status === 200) {
            // ok
          } else {
            throw new Error(`Failed to open stream: ${res.status} ${res.statusText}`);
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
              if (metaData.diagnostics) {
                setDiagnostics((prev) => ({ ...prev, ...metaData.diagnostics }));
              }
              if (metaData.task_spec) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, properties: { ...(msg.properties || {}), task_spec: metaData.task_spec } }
                      : msg
                  )
                );
              }
              if (metaData.attributions) {
                setMessages((prev) =>
                  prev.map((msg) =>
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
              setMessages((prev) =>
                prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: msg.content + textChunk } : msg))
              );
              break;
            }
            case 'end': {
              if (newSessionCreated) {
                refreshSessions();
              }
              if (sessionIdForFetch) {
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
          setIsStreaming(false);
        },
        onerror(err) {
          console.error('Stream error:', err);
          setIsStreaming(false);
          setErrorBanner('Streaming failed. Please try again.');
          throw err;
        },
      });
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        setErrorBanner('Generation stopped.');
      } else {
        console.error('Failed to send message:', err);
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, content: 'Sorry, an error occurred.' } : msg))
        );
        setErrorBanner('Failed to send. Please try again.');
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const isNumericId = (id: string) => /^\d+$/.test(id);

  const ensureReasoningLoaded = async (msg: Message) => {
    if (!activeSessionId) return;
    if (msg.properties?.thought_process) return;

    if (!isNumericId(msg.id)) {
      await fetchMessagesForSession(activeSessionId as number);
      return;
    }

    try {
      setLoadingReasoning((prev) => ({ ...prev, [msg.id]: true }));
      const response = await fetch(`${API_URL}/chats/${activeSessionId}/messages/${msg.id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) {
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
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? hydrated : m)));
    } catch (e) {
      console.warn('Could not lazy-load reasoning:', e);
      await fetchMessagesForSession(activeSessionId as number);
    } finally {
      setLoadingReasoning((prev) => ({ ...prev, [msg.id]: false }));
    }
  };

  /* ---------------- UI ---------------- */

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    atBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {}
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <HeaderChips
        diagnostics={diagnostics}
        series={series}
        isStreaming={isStreaming}
        prefillToast={prefillToast}
        onStop={stopStreaming}
      />

      {errorBanner && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          <div className="mx-auto max-w-5xl">{errorBanner}</div>
        </div>
      )}

      {isLoadingHistory ? (
        <ChatAreaSkeleton />
      ) : (
        <div className="relative flex-1">
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            expandedReasoning={expandedReasoning}
            setExpandedReasoning={setExpandedReasoning}
            expandedPlan={expandedPlan}
            setExpandedPlan={setExpandedPlan}
            loadingReasoning={loadingReasoning}
            onLoadReasoning={ensureReasoningLoaded}
            onCopyMessage={copyMessage}
            containerRef={containerRef}
            messagesEndRef={messagesEndRef}
            onScroll={handleScroll}
          />
          <ScrollToBottom
            visible={showScrollDown}
            onClick={() =>
              containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
            }
          />
        </div>
      )}

      <Composer
        ref={inputRef}
        value={input}
        setValue={(v: string) => setInput(v)}
        disabled={isStreaming || isLoadingHistory}
        isStreaming={isStreaming}
        onSend={handleSend}
        onStop={stopStreaming}
      />

      {/* Dynamic Triage: refine suggestion under the composer */}
      <div className="mx-auto w-full max-w-5xl px-4 pb-3">
        <RefineSuggestion
          getCurrentText={() => input}
          insertIntoComposer={(text: string) => setInput(text)}
          authToken={authToken}
          chatSessionId={typeof activeSessionId === 'number' ? activeSessionId : null}
        />
      </div>
    </div>
  );
}
