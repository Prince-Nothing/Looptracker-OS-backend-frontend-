import React from "react";
import Link from "next/link";
import LoopBuilder from "@/components/LoopBuilder";

export const metadata = {
  title: "Loops • Looptracker OS",
  description: "Capture → Befriend (IFS) → Analyze (CBT) → Chunk (tiny habit).",
};

export default function LoopsPage() {
  return (
    <main className="min-h-[100dvh] relative overflow-x-hidden">
      {/* Back to Chat */}
      <div className="fixed left-4 top-4 z-50">
        <Link
          href="/"
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-100 hover:bg-white/10"
        >
          ← Back to Chat
        </Link>
      </div>

      <div className="mx-auto max-w-6xl px-4 md:px-6 pt-20 md:pt-24 pb-24 pb-safe">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold text-slate-100">Loops</h1>
          <p className="text-slate-300">
            Create a loop and move through Befriend → Analyze → Chunk.
          </p>
        </div>

        <div className="glass">
          <LoopBuilder />
        </div>
      </div>
    </main>
  );
}
