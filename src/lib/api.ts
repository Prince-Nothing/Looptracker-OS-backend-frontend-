export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/* ---------- Dynamic Triage (SE / ACT / IFS) ---------- */
export type TriageLabel = 'SE' | 'ACT' | 'IFS';

export type TriageResponse = {
  label: TriageLabel;
  confidence: number;
  rationale: string;
  prompts: string[];
  second_choice?: TriageLabel | null;
};

export async function triageClassify(params: {
  capture_text: string;
  distress_0_10?: number;
  tags?: string[];
  authToken?: string | null;
  chat_session_id?: number; // ← added
}): Promise<TriageResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.authToken) headers['Authorization'] = `Bearer ${params.authToken}`;

  const res = await fetch(`${API_URL}/triage/classify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      capture_text: params.capture_text,
      distress_0_10: params.distress_0_10,
      tags: params.tags,
      chat_session_id: params.chat_session_id, // ← added
    }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Triage failed (HTTP ${res.status})`);
  return res.json();
}
