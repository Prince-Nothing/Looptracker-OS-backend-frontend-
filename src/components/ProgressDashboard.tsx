'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';
import {
  getHabitSummary,
  getHabitEvents,
  listHabits,
  logHabitEvent,
  setExternalTokenGetter,
  type HabitSummary,
  type HabitOut,
} from '@/lib/loopApi';

type DiagnosticHistoryPoint = {
  timestamp: string;
  diagnostics: {
    MIIS?: number;
    SRQ?: number;
    EFM?: number;
  }
};

type Filter = 'all' | 'active' | 'paused' | 'archived';
type SortKey = 'streak' | 'recent' | 'name';

export default function ProgressDashboard() {
  const { authToken } = useAppContext();

  // Ensure loopApi grabs the live token
  useEffect(() => {
    setExternalTokenGetter(() => authToken || null);
  }, [authToken]);

  // Diagnostics
  const [diagData, setDiagData] = useState<any[]>([]);
  const [diagLoading, setDiagLoading] = useState(true);
  const [diagError, setDiagError] = useState<string | null>(null);

  // Habits
  const [summaries, setSummaries] = useState<HabitSummary[]>([]);
  const [habits, setHabits] = useState<HabitOut[]>([]);
  const [habitsLoading, setHabitsLoading] = useState(false);
  const [habitsError, setHabitsError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('streak');
  const [days, setDays] = useState(30);

  const [openHabitId, setOpenHabitId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSeries, setDetailSeries] = useState<{ date: string; done: number }[]>([]);

  // Map id → habit
  const habitMap = useMemo(() => {
    const m = new Map<number, HabitOut>();
    habits.forEach((h) => m.set(h.id, h));
    return m;
  }, [habits]);

  // Visible summaries
  const visibleSummaries = useMemo(() => {
    let arr = summaries.slice();
    if (filter !== 'all') {
      arr = arr.filter((s) => (habitMap.get(s.habit_id)?.status || 'active') === filter);
    }
    switch (sortKey) {
      case 'name':
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'recent': {
        const key = (s: HabitSummary) => (s.last_done ? new Date(s.last_done).getTime() : 0);
        arr.sort((a, b) => key(b) - key(a));
        break;
      }
      case 'streak':
      default:
        arr.sort(
          (a, b) =>
            b.streak_current - a.streak_current ||
            b.completion_rate_30 - a.completion_rate_30 ||
            b.completion_rate_7 - a.completion_rate_7 ||
            a.name.localeCompare(b.name),
        );
    }
    return arr;
  }, [summaries, filter, sortKey, habitMap]);

  // Fetch diagnostics
  useEffect(() => {
    const run = async () => {
      if (!authToken) return;
      setDiagLoading(true);
      setDiagError(null);
      try {
        const res = await fetch(`${API_URL}/users/me/diagnostics`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) throw new Error('Failed to fetch diagnostic data.');
        const history: DiagnosticHistoryPoint[] = await res.json();
        const formatted = history.map((p) => ({
          name: new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          MIIS: p.diagnostics.MIIS,
          SRQ: p.diagnostics.SRQ,
          EFM: p.diagnostics.EFM,
        }));
        setDiagData(formatted);
      } catch (err) {
        setDiagError(err instanceof Error ? err.message : 'An unknown error occurred.');
      } finally {
        setDiagLoading(false);
      }
    };
    run();
  }, [authToken]);

  // Fetch habits + summaries
  useEffect(() => {
    if (!authToken) return;
    (async () => {
      setHabitsLoading(true);
      setHabitsError(null);
      try {
        const [sum, habs] = await Promise.all([getHabitSummary(days), listHabits()]);
        setSummaries(sum);
        setHabits(habs);
      } catch (e: any) {
        setHabitsError(e.message ?? String(e));
      } finally {
        setHabitsLoading(false);
      }
    })();
  }, [authToken, days]);

  function toast(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 1400);
  }

  async function refreshHabits() {
    try {
      const [sum, habs] = await Promise.all([getHabitSummary(days), listHabits()]);
      setSummaries(sum);
      setHabits(habs);
    } catch (e: any) {
      setHabitsError(e.message ?? String(e));
    }
  }

  async function mark(habitId: number, type: 'complete' | 'skip') {
    try {
      await logHabitEvent(habitId, { type });
      toast(type === 'complete' ? 'Logged ✓' : 'Logged skip');
      await refreshHabits();
      if (openHabitId === habitId) await loadDetails(habitId);
    } catch (e: any) {
      setHabitsError(e.message ?? String(e));
    }
  }

  async function loadDetails(habitId: number) {
    setDetailLoading(true);
    try {
      const evs = (await getHabitEvents(habitId, 30)) as any[];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const completes = new Set<string>();
      evs.forEach((e) => {
        const kind = (e?.event_type ?? e?.type) as string | undefined;
        if (kind === 'complete') {
          const d = new Date(e.ts);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString().slice(0, 10);
          completes.add(key);
        }
      });

      const series: { date: string; done: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        series.push({ date: key.slice(5), done: completes.has(key) ? 1 : 0 });
      }
      setDetailSeries(series);
    } catch (e: any) {
      setHabitsError(e.message ?? String(e));
      setDetailSeries([]);
    } finally {
      setDetailLoading(false);
    }
  }

  /* ------------ Render ------------ */
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-2xl font-bold text-transparent">
            Your Progress
          </h1>
          <p className="mt-1 text-sm text-gray-400">Track diagnostics and habit momentum over time.</p>
        </div>

        {/* Diagnostics card */}
        <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold text-white/90">Diagnostics</div>
            {diagError && (
              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200">
                {diagError}
              </span>
            )}
          </div>

          {diagLoading ? (
            <div className="flex h-72 items-center justify-center text-gray-400">Loading…</div>
          ) : diagData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={diagData} margin={{ top: 5, right: 30, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                  <XAxis dataKey="name" stroke="#A0AEC0" />
                  <YAxis stroke="#A0AEC0" domain={[0, 10]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#2D3748',
                      border: '1px solid #4A5568',
                      color: '#E2E8F0',
                    }}
                  />
                  <Legend wrapperStyle={{ color: '#E2E8F0' }} />
                  <Line type="monotone" dataKey="MIIS" stroke="#8884d8" strokeWidth={2} name="Metacognitive Integrity" />
                  <Line type="monotone" dataKey="SRQ" stroke="#82ca9d" strokeWidth={2} name="Self-Regulation" />
                  <Line type="monotone" dataKey="EFM" stroke="#ffc658" strokeWidth={2} name="Emotional Fluidity" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-gray-400">
              No diagnostic data yet. Start a conversation to see your progress!
            </div>
          )}
        </div>

        {/* Habits toolbar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white/90">Habits</div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm"
            >
              <option value="streak">Sort: Streak</option>
              <option value="recent">Sort: Recent</option>
              <option value="name">Sort: Name</option>
            </select>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm"
            >
              <option value={30}>Last 30d</option>
              <option value={60}>Last 60d</option>
              <option value={90}>Last 90d</option>
            </select>
            <button
              onClick={refreshHabits}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
            >
              Refresh
            </button>
          </div>
        </div>

        {msg && (
          <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {msg}
          </div>
        )}
        {habitsError && (
          <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {habitsError}
          </div>
        )}

        {/* Habits grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {habitsLoading ? (
            <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-gray-400">
              Loading habits…
            </div>
          ) : visibleSummaries.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-gray-300">
              No habits yet. Create one via <b>Loops → Chunk</b>, then return here.
            </div>
          ) : (
            visibleSummaries.map((s) => {
              const h = habitMap.get(s.habit_id);
              const status = h?.status || 'active';
              const lastStr = s.last_done ? new Date(s.last_done).toLocaleDateString() : 'Never';
              const rate7 = Math.round(s.completion_rate_7 * 100);
              const rate30 = Math.round(s.completion_rate_30 * 100);
              const open = openHabitId === s.habit_id;

              return (
                <div
                  key={s.habit_id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-white">{s.name}</div>
                      <div className="text-xs text-gray-400">
                        Status: {status} • Last done: {lastStr}
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-300">
                      streak {s.streak_current} / best {s.streak_best}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-300">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">7d</span>
                      <span className="font-medium">{rate7}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">30d</span>
                      <span className="font-medium">{rate30}%</span>
                    </div>
                  </div>

                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => mark(s.habit_id, 'complete')}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-200 hover:bg-emerald-500/15"
                    >
                      Mark done
                    </button>
                    <button
                      onClick={() => mark(s.habit_id, 'skip')}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-sm text-amber-200 hover:bg-amber-500/15"
                    >
                      Skip
                    </button>
                    <button
                      onClick={async () => {
                        const opening = !open;
                        setOpenHabitId(opening ? s.habit_id : null);
                        if (opening) await loadDetails(s.habit_id);
                      }}
                      className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
                    >
                      {open ? 'Hide' : 'Details'}
                    </button>
                  </div>

                  {open && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3">
                      {detailLoading ? (
                        <div className="text-xs text-gray-400">Loading details…</div>
                      ) : detailSeries.length === 0 ? (
                        <div className="text-xs text-gray-400">No events in the last 30 days.</div>
                      ) : (
                        <div className="h-24">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={detailSeries} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                              <XAxis dataKey="date" hide />
                              <YAxis domain={[0, 1]} hide />
                              <Area type="monotone" dataKey="done" stroke="#82ca9d" fill="#82ca9d33" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
