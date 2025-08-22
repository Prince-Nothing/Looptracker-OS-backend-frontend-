"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppContext } from "@/context/AppContext";
import {
  createLoop,
  listLoops,
  befriend,
  analyze,
  chunk,
  listHabits,
  getLoopMemories,
  logHabitEvent,
  setExternalTokenGetter,
  type LoopOut,
  type HabitOut,
  type MemoryItem,
} from "@/lib/loopApi";

type Stage = "capture" | "befriend" | "analyze" | "chunk";
const STAGES: Stage[] = ["capture", "befriend", "analyze", "chunk"];

export default function LoopBuilder() {
  const router = useRouter();
  const { authToken } = useAppContext();

  // make API use the live token
  useEffect(() => {
    setExternalTokenGetter(() => authToken || null);
  }, [authToken]);

  const [stage, setStage] = useState<Stage>("capture");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // New-loop inputs
  const [title, setTitle] = useState("");
  const [trigger, setTrigger] = useState("");
  const [description, setDescription] = useState("");

  // Data
  const [loops, setLoops] = useState<LoopOut[]>([]);
  const [activeLoop, setActiveLoop] = useState<LoopOut | null>(null);

  // Stage inputs
  const [befriendEntry, setBefriendEntry] = useState("");
  const [analyzeEntry, setAnalyzeEntry] = useState("");
  const [chunkInsight, setChunkInsight] = useState("");

  // Memories
  const [mems, setMems] = useState<MemoryItem[]>([]);
  const [memLoading, setMemLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Quick actions for newly created habit
  const [lastHabitId, setLastHabitId] = useState<number | null>(null);
  const [lastHabitName, setLastHabitName] = useState<string>("");

  // initial load AFTER we have a token
  useEffect(() => {
    if (!authToken) return;
    (async () => {
      try {
        const [loopsData] = await Promise.all([listLoops(), listHabits()]);
        setLoops(loopsData);
        if (loopsData.length > 0) {
          setActiveLoop(loopsData[0]);
          void refreshMemories(loopsData[0].id);
        }
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    })();
  }, [authToken]);

  async function refreshMemories(loopId: number) {
    setMemLoading(true);
    try {
      const items = await getLoopMemories(loopId, 20);
      setMems(items);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setMemLoading(false);
    }
  }

  const canContinue = useMemo(() => {
    if (stage === "capture") return title.trim().length > 0;
    if (stage === "befriend") return befriendEntry.trim().length > 0;
    if (stage === "analyze") return analyzeEntry.trim().length > 0;
    if (stage === "chunk") return chunkInsight.trim().length > 0;
    return false;
  }, [stage, title, befriendEntry, analyzeEntry, chunkInsight]);

  function goPrev() {
    const i = STAGES.indexOf(stage);
    if (i > 0) setStage(STAGES[i - 1]);
  }
  function goNext() {
    const i = STAGES.indexOf(stage);
    if (i < STAGES.length - 1) setStage(STAGES[i + 1]);
  }
  function toast(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 1800);
  }
  function sendToChat(text: string) {
    try {
      localStorage.setItem("lt_prefill", text);
    } catch {}
    router.push("/");
  }

  async function onCreateLoop(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const loop = await createLoop({
        title: title.trim(),
        trigger: trigger.trim() || undefined,
        description: description.trim() || undefined,
      });
      setActiveLoop(loop);
      setLoops((prev) => [loop, ...prev]);
      setStage("befriend");
      toast("Loop created");
      void refreshMemories(loop.id);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }

  async function onBefriend() {
    if (!activeLoop) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await befriend(activeLoop.id, befriendEntry);
      setActiveLoop(updated);
      toast("Befriended");
      void refreshMemories(updated.id);
      goNext();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onAnalyze() {
    if (!activeLoop) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await analyze(activeLoop.id, analyzeEntry);
      setActiveLoop(updated);
      toast("Analyzed");
      void refreshMemories(updated.id);
      goNext();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onChunk() {
    if (!activeLoop) return;
    setSubmitting(true);
    setError(null);
    try {
      const newHabit = (await chunk(activeLoop.id, chunkInsight)) as HabitOut;
      setLastHabitId(newHabit.id);
      setLastHabitName(newHabit.name || "Micro-action");
      toast("Habit created");
      void refreshMemories(activeLoop.id);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setStage("capture");
    setTitle("");
    setTrigger("");
    setDescription("");
    setBefriendEntry("");
    setAnalyzeEntry("");
    setChunkInsight("");
    setMems([]);
    setLastHabitId(null);
    setLastHabitName("");
  }

  const filteredMems = useMemo(() => {
    if (sourceFilter === "all") return mems;
    return mems.filter((m) => m.properties?.source === sourceFilter);
  }, [mems, sourceFilter]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    mems.forEach((m) => m.properties?.source && set.add(m.properties.source));
    return ["all", ...Array.from(set)];
  }, [mems]);

  return (
    <div className="mx-auto max-w-5xl p-6 text-slate-100">
      {/* Header row with Back-to-Chat + stage nav */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
          >
            ← Back to Chat
          </Link>
          <span className="ml-1 text-lg font-semibold">Guided Loop</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={goPrev}
            disabled={STAGES.indexOf(stage) === 0}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm disabled:opacity-40"
          >
            ← Back
          </button>
          <button
            onClick={goNext}
            disabled={STAGES.indexOf(stage) === STAGES.length - 1}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>

      <p className="text-slate-300 mb-4">
        Capture → Befriend (IFS) → Analyze (CBT) → Chunk (tiny habit).
      </p>

      {msg && (
        <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {msg}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Stage selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={`rounded-xl px-3 py-1 text-sm border transition ${
              stage === s
                ? "bg-white/15 border-white/20"
                : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Loop picker */}
      <div className="mb-6">
        <label className="text-sm text-slate-300">Recent loops</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {loops.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setActiveLoop(l);
                setStage("befriend");
                void refreshMemories(l.id);
              }}
              className={`rounded-xl border px-3 py-1 text-sm transition ${
                activeLoop?.id === l.id
                  ? "bg-white/15 border-white/20"
                  : "bg-white/5 border-white/10 hover:bg-white/10"
              }`}
              title={l.description || ""}
            >
              #{l.id} {l.title}
            </button>
          ))}
        </div>
      </div>

      {/* Panels */}
      {stage === "capture" && (
        <form onSubmit={onCreateLoop} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none"
              placeholder="Title (e.g., Procrastination around outreach)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <input
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none"
              placeholder="Trigger (optional)"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
            />
            <input
              className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-4 py-2 text-black disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create & Continue"}
            </button>
            <button
              type="button"
              onClick={resetAll}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2"
            >
              Reset
            </button>
          </div>
        </form>
      )}

      {stage === "befriend" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            IFS micro-prompt. Free-write the part’s voice and what it fears.
          </p>
          <textarea
            className="min-h-[140px] w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none"
            placeholder="What does the part say? Where do you feel it? What is it afraid of?"
            value={befriendEntry}
            onChange={(e) => setBefriendEntry(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={onBefriend}
              disabled={submitting || !befriendEntry.trim() || !activeLoop}
              className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 disabled:opacity-50"
            >
              {submitting ? "Working…" : "Continue"}
            </button>
            <button onClick={goPrev} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              Back
            </button>
          </div>

          {/* If IFS exists, show card with Send to Chat */}
          {activeLoop?.ifs && Object.keys(activeLoop.ifs).length > 0 && (
            <JSONCard
              title="IFS (befriend) result"
              data={activeLoop.ifs}
              onSend={() =>
                sendToChat(
                  `IFS result for "${activeLoop.title}":\n` +
                    JSON.stringify(activeLoop.ifs, null, 2)
                )
              }
            />
          )}
        </div>
      )}

      {stage === "analyze" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Strategy Lab (CBT). We’ll extract distortions and create a balanced alternative.
          </p>
          <textarea
            className="min-h-[140px] w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none"
            placeholder="Write the thought in detail. What are you telling yourself?"
            value={analyzeEntry}
            onChange={(e) => setAnalyzeEntry(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={onAnalyze}
              disabled={submitting || !analyzeEntry.trim() || !activeLoop}
              className="rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 disabled:opacity-50"
            >
              {submitting ? "Working…" : "Continue"}
            </button>
            <button onClick={goPrev} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              Back
            </button>
          </div>

          {/* If CBT exists, show card with Send to Chat */}
          {activeLoop?.cbt && Object.keys(activeLoop.cbt).length > 0 && (
            <JSONCard
              title="CBT (analyze) result"
              data={activeLoop.cbt}
              onSend={() =>
                sendToChat(
                  `CBT result for "${activeLoop.title}":\n` +
                    JSON.stringify(activeLoop.cbt, null, 2)
                )
              }
            />
          )}
        </div>
      )}

      {stage === "chunk" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Turn the insight into a tiny, testable habit (1–3 minutes).
          </p>
          <input
            className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none"
            placeholder="Goal/insight (e.g., send one friendly email daily despite fear)"
            value={chunkInsight}
            onChange={(e) => setChunkInsight(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={onChunk}
              disabled={submitting || !chunkInsight.trim() || !activeLoop}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-4 py-2 text-black disabled:opacity-50"
            >
              {submitting ? "Designing…" : "Create habit"}
            </button>
            <button onClick={goPrev} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              Back
            </button>
          </div>

          {/* Quick actions for the newly created habit */}
          {lastHabitId && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 mt-3">
              <div className="text-sm text-slate-300 mb-2">
                Quick actions for <span className="font-medium">{lastHabitName}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      await logHabitEvent(lastHabitId, { type: "complete" });
                      toast("Logged: done today");
                    } catch (e: any) {
                      setError(e.message ?? String(e));
                    }
                  }}
                  className="rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1 text-sm"
                >
                  Mark done today
                </button>
                <button
                  onClick={async () => {
                    try {
                      await logHabitEvent(lastHabitId, { type: "skip" });
                      toast("Logged: skipped today");
                    } catch (e: any) {
                      setError(e.message ?? String(e));
                    }
                  }}
                  className="rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 px-3 py-1 text-sm"
                >
                  Skip today
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Right rail: Memories */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 font-medium">Loop Memories</div>

          {/* Filter chips */}
          <div className="mb-3 flex flex-wrap gap-2">
            {sources.map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`rounded-xl border px-3 py-1 text-xs transition ${
                  sourceFilter === s
                    ? "bg-white/15 border-white/20"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                {s}
              </button>
            ))}
            <div className="grow" />
            <button
              onClick={() => activeLoop && refreshMemories(activeLoop.id)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs"
              disabled={!activeLoop || memLoading}
            >
              {memLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {(!filteredMems || filteredMems.length === 0) ? (
            <div className="text-sm text-slate-300">
              No saved items yet. Complete Befriend/Analyze/Chunk—or use the
              Send button on the IFS/CBT cards above to continue in Chat.
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {filteredMems.map((m) => (
                <div key={m.id} className="rounded-xl bg-black/20 border border-white/10 p-3">
                  <div className="text-[11px] text-slate-400 mb-1">
                    {m.created_at ? new Date(m.created_at).toLocaleString() : `#${m.id}`}
                    {m.properties?.source ? ` • ${m.properties.source}` : ""}
                  </div>
                  <div className="text-sm whitespace-pre-wrap mb-2">{m.content}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendToChat(m.content)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
                    >
                      Send to Chat
                    </button>
                    <button
                      onClick={() => navigator.clipboard?.writeText?.(m.content)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Results (also have Send buttons now) */}
        <div className="space-y-4">
          {activeLoop?.ifs && Object.keys(activeLoop.ifs).length > 0 && (
            <JSONCard
              title="IFS (befriend) result"
              data={activeLoop.ifs}
              onSend={() =>
                sendToChat(
                  `IFS result for "${activeLoop.title}":\n` +
                    JSON.stringify(activeLoop.ifs, null, 2)
                )
              }
            />
          )}
          {activeLoop?.cbt && Object.keys(activeLoop.cbt).length > 0 && (
            <JSONCard
              title="CBT (analyze) result"
              data={activeLoop.cbt}
              onSend={() =>
                sendToChat(
                  `CBT result for "${activeLoop.title}":\n` +
                    JSON.stringify(activeLoop.cbt, null, 2)
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function JSONCard({
  title,
  data,
  onSend,
}: {
  title: string;
  data: unknown;
  onSend?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 font-medium">{title}</div>
      <pre className="whitespace-pre-wrap break-words text-xs text-slate-300 mb-2">
        {JSON.stringify(data, null, 2)}
      </pre>
      <div className="flex gap-2">
        {onSend && (
          <button
            onClick={onSend}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
          >
            Send to Chat
          </button>
        )}
        <button
          onClick={() =>
            navigator.clipboard?.writeText?.(JSON.stringify(data, null, 2))
          }
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
