// src/lib/loopApi.ts
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:8000";

/** Allow components to provide a fresh JWT from context */
let externalTokenGetter: (() => string | null) | null = null;
export function setExternalTokenGetter(fn: () => string | null) {
  externalTokenGetter = fn;
}

/** Read auth token (context → storage → cookies) */
function getToken(): string | null {
  if (typeof window === "undefined") return null;

  // From context
  if (externalTokenGetter) {
    try {
      const t = externalTokenGetter();
      if (t) return t;
    } catch {}
  }

  // From storages
  const stores = [localStorage, sessionStorage];
  const keys = ["authToken", "auth_token", "access_token", "token", "jwt"];
  for (const store of stores) {
    try {
      for (const k of keys) {
        const v = store.getItem(k);
        if (v) return v;
      }
    } catch {}
  }

  // From cookies
  try {
    const parts = (document.cookie || "").split(";").map((s) => s.trim());
    const find = (name: string) =>
      parts.find((p) => p.startsWith(name + "="))?.split("=", 2)?.[1] || null;
    return find("jwt") || find("token") || null;
  } catch {}

  return null;
}

/** Fetch helper with JSON + auth + credentials */
async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

/** ===== Types ===== */
export type LoopOut = {
  id: number;
  title: string;
  trigger?: string | null;
  description?: string | null;
  ifs?: Record<string, any>;
  cbt?: Record<string, any>;
  metrics?: Record<string, any>;
  status: string;
};

export type HabitOut = {
  id: number;
  loop_id: number;
  name: string;
  cue?: string | null;
  routine?: string | null;
  reward?: string | null;
  perceived_automaticity: number;
  status: "active" | "paused" | "archived" | string;
};

export type HabitUpdate = Partial<
  Pick<HabitOut, "name" | "cue" | "routine" | "reward" | "perceived_automaticity" | "status">
>;

export type MemoryItem = {
  id: number;
  content: string;
  properties?: Record<string, any>;
  created_at?: string;
};

export type HabitEvent = {
  id: number;
  habit_id: number;
  user_id: number;
  ts: string; // ISO timestamp
  event_type: "complete" | "skip" | string;
  value?: number | null;
  note?: string | null;
};

export type HabitSummary = {
  habit_id: number;
  name: string;
  last_done?: string | null;
  streak_current: number;
  streak_best: number;
  completion_rate_7: number;   // 0..1
  completion_rate_30: number;  // 0..1
};

/** ===== Loops ===== */
export async function createLoop(input: {
  title: string;
  trigger?: string;
  description?: string;
}): Promise<LoopOut> {
  return api("/loops", { method: "POST", body: JSON.stringify(input) });
}

export async function listLoops(limit = 50): Promise<LoopOut[]> {
  return api(`/loops?limit=${encodeURIComponent(String(limit))}`);
}

export async function befriend(loopId: number, entry: string): Promise<LoopOut> {
  return api(`/loops/${loopId}/befriend`, {
    method: "POST",
    body: JSON.stringify({ entry }),
  });
}

export async function analyze(loopId: number, entry: string): Promise<LoopOut> {
  return api(`/loops/${loopId}/analyze`, {
    method: "POST",
    body: JSON.stringify({ entry }),
  });
}

export async function chunk(loopId: number, goal_or_insight: string): Promise<HabitOut> {
  return api(`/loops/${loopId}/chunk`, {
    method: "POST",
    body: JSON.stringify({ goal_or_insight }),
  });
}

export async function getLoopMemories(loopId: number, limit = 20): Promise<MemoryItem[]> {
  return api(`/loops/${loopId}/memories?limit=${encodeURIComponent(String(limit))}`);
}

/** ===== Habits ===== */
export async function listHabits(limit = 50): Promise<HabitOut[]> {
  return api(`/loops/habits?limit=${encodeURIComponent(String(limit))}`);
}

export async function updateHabit(habitId: number, data: HabitUpdate): Promise<HabitOut> {
  return api(`/loops/habits/${habitId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** ===== Habit events & summary ===== */
export async function logHabitEvent(
  habitId: number,
  payload: { type: "complete" | "skip"; value?: number; note?: string }
): Promise<HabitEvent> {
  return api(`/loops/habits/${habitId}/events`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getHabitEvents(habitId: number, days = 30): Promise<HabitEvent[]> {
  return api(`/loops/habits/${habitId}/events?days=${encodeURIComponent(String(days))}`);
}

export async function getHabitSummary(days = 30): Promise<HabitSummary[]> {
  return api(`/loops/habits/summary?days=${encodeURIComponent(String(days))}`);
}
