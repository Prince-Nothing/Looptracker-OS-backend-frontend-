'use client';

import { useAppContext } from '@/context/AppContext';

interface SidebarProps {
  activeView: 'chat' | 'knowledge' | 'progress' | 'loops';
  setActiveView: (view: 'chat' | 'knowledge' | 'progress' | 'loops') => void;
}

export default function Sidebar({ activeView, setActiveView }: SidebarProps) {
  const { sessions, activeSessionId, setActiveSessionId, logout, deleteSession } = useAppContext();

  const handleNewChat = () => {
    setActiveSessionId(null);
    setActiveView('chat');
  };

  const handleSelectSession = (id: number) => {
    setActiveSessionId(id);
    setActiveView('chat'); // chat stays mounted; ChatArea reacts to activeSessionId change
  };

  const handleDeleteSession = async (sessionIdToDelete: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this chat session?')) {
      await deleteSession(sessionIdToDelete);
    }
  };

  const NavButton = ({
    label,
    icon,
    active,
    onClick,
  }: {
    label: string;
    icon: React.ReactNode;
    active: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
        active
          ? 'bg-white/10 border border-white/10 text-white shadow-sm'
          : 'text-gray-300 hover:text-white hover:bg-white/5 border border-transparent'
      }`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${
          active ? 'bg-white/10' : 'bg-white/5 group-hover:bg-white/10'
        }`}
      >
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <aside className="w-72 shrink-0 border-r border-white/10 bg-gradient-to-b from-white/5 to-transparent px-4 py-4 backdrop-blur-xl">
      {/* Brand */}
      <div className="mb-4 flex items-center gap-2 px-1">
        <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500" />
        <div className="font-semibold tracking-wide">Looptracker OS</div>
      </div>

      {/* Primary actions */}
      <div className="space-y-2">
        <button
          onClick={handleNewChat}
          className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-3 py-2 text-sm font-medium text-black shadow-md shadow-violet-500/20 transition hover:shadow-lg hover:shadow-violet-500/30"
        >
          + New Chat
        </button>

        <NavButton
          label="Open Loops"
          active={activeView === 'loops'}
          onClick={() => setActiveView('loops')}
          icon={
            // arrows-path-rounded-square
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M7 7h6a4 4 0 1 1 0 8H9v3l-4-4 4-4v3h4a2 2 0 1 0 0-4H7V7Zm10 10h-6a4 4 0 1 1 0-8h4V6l4 4-4 4v-3h-4a2 2 0 1 0 0 4h6v2Z" />
            </svg>
          }
        />

        <NavButton
          label="Progress"
          active={activeView === 'progress'}
          onClick={() => setActiveView('progress')}
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M3 13h3v8H3v-8Zm5-6h3v14H8V7Zm5 3h3v11h-3V10Zm5-6h3v17h-3V4Z" />
            </svg>
          }
        />

        <NavButton
          label="Knowledge Base"
          active={activeView === 'knowledge'}
          onClick={() => setActiveView('knowledge')}
          icon={
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M4 6a2 2 0 0 1 2-2h12v14H6a2 2 0 0 1-2-2V6Zm2 0v10h10V6H6Zm12 12H6v2h12v-2Z" />
            </svg>
          }
        />
      </div>

      {/* History */}
      <div className="mt-6">
        <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-gray-400">History</div>
        <div className="max-h-[42vh] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => handleSelectSession(session.id)}
              className={`group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-sm ${
                activeSessionId === session.id
                  ? 'bg-white/10 border border-white/10'
                  : 'hover:bg-white/5 border border-transparent'
              }`}
              title={session.title || ''}
            >
              <p className="truncate text-gray-200">
                {session.title || `Chat • ${new Date(session.created_at).toLocaleDateString()}`}
              </p>
              <button
                onClick={(e) => handleDeleteSession(session.id, e)}
                className="ml-2 shrink-0 rounded-md p-1 text-gray-400 hover:text-red-400 hover:bg-white/5"
                aria-label="Delete session"
                title="Delete"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7Zm3-5h6l1 2h4v2H2V4h4l1-2Z" />
                </svg>
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 p-3 text-xs text-gray-400">
              No conversations yet. Start a new chat to begin.
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 border-t border-white/10 pt-4">
        <button
          onClick={logout}
          className="w-full rounded-xl px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/5 hover:text-white"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
