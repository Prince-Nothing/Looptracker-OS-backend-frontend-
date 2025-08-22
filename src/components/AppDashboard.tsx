'use client';

import { useState, useEffect } from 'react';
import { useAppContext } from '@/context/AppContext';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import KnowledgeBase from './KnowledgeBase';
import ProgressDashboard from './ProgressDashboard';
import LoopBuilder from './LoopBuilder'; // NEW: embed Open Loops as a panel

export default function AppDashboard() {
  const { activeSessionId } = useAppContext();
  const [activeView, setActiveView] = useState<'chat' | 'knowledge' | 'progress' | 'loops'>('chat');

  // Land on Chat when a Loops prefill exists
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('lt_prefill')) {
      setActiveView('chat');
    }
  }, []);

  // Helper to style/stack panels with a subtle fade; keeps layout stable and prevents janky reflows
  const panelClass = (active: boolean) =>
    `absolute inset-0 min-h-0 flex flex-col transition-opacity duration-200 ${
      active ? 'opacity-100' : 'opacity-0 pointer-events-none'
    }`;

  return (
    <div className="flex min-h-dvh bg-gray-950/40 text-white">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="relative flex min-h-0 flex-1 flex-col">
        {/* Keep panels mounted and fade between them for smoother feel */}
        <section className={panelClass(activeView === 'chat')} aria-hidden={activeView !== 'chat'}>
          {/* IMPORTANT: removed key={activeSessionId} to avoid full remount flicker */}
          <ChatArea />
        </section>

        <section className={panelClass(activeView === 'loops')} aria-hidden={activeView !== 'loops'}>
          <div className="mx-auto w-full max-w-6xl p-6">
            <div className="mb-4 px-1">
              <h1 className="text-2xl font-semibold">Open Loops</h1>
              <p className="text-sm text-gray-300">Capture → Befriend (IFS) → Analyze (CBT) → Chunk.</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-2 backdrop-blur-xl">
              <LoopBuilder />
            </div>
          </div>
        </section>

        <section className={panelClass(activeView === 'knowledge')} aria-hidden={activeView !== 'knowledge'}>
          <KnowledgeBase />
        </section>

        <section className={panelClass(activeView === 'progress')} aria-hidden={activeView !== 'progress'}>
          <ProgressDashboard />
        </section>
      </main>
    </div>
  );
}
