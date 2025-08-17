'use client';

import { useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import KnowledgeBase from './KnowledgeBase';
import ProgressDashboard from './ProgressDashboard'; // <-- IMPORT

export default function AppDashboard() {
  const { activeSessionId } = useAppContext();
  // MODIFIED: Add 'progress' to the view state
  const [activeView, setActiveView] = useState<'chat' | 'knowledge' | 'progress'>('chat');

  return (
    <div className="flex h-screen bg-gray-900 text-white font-sans">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="flex-1 flex flex-col">
        {/* MODIFIED: Add conditional render for ProgressDashboard */}
        {activeView === 'chat' && <ChatArea key={activeSessionId} />}
        {activeView === 'knowledge' && <KnowledgeBase />}
        {activeView === 'progress' && <ProgressDashboard />}
      </main>
    </div>
  );
}