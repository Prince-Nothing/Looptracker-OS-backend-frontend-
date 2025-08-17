'use client';

import { useAppContext } from '@/context/AppContext';

// MODIFIED: Added 'progress' to the type
interface SidebarProps {
    activeView: string;
    setActiveView: (view: 'chat' | 'knowledge' | 'progress') => void;
}

export default function Sidebar({ activeView, setActiveView }: SidebarProps) {
  const { sessions, activeSessionId, setActiveSessionId, logout, deleteSession } = useAppContext();
  
  const handleNewChat = () => {
    setActiveSessionId(null);
    setActiveView('chat');
  }

  const handleSelectSession = (id: number) => {
    setActiveSessionId(id);
    setActiveView('chat');
  }

  const handleDeleteSession = async (sessionIdToDelete: number, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (window.confirm("Are you sure you want to delete this chat session?")) {
        await deleteSession(sessionIdToDelete);
    }
  };

  return (
    <div className="w-64 bg-gray-800 p-4 flex flex-col border-r border-gray-700">
      <h1 className="text-xl font-bold mb-4">Looptracker OS</h1>
      <button onClick={handleNewChat} className="w-full mb-2 px-4 py-2 font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700">
        + New Chat
      </button>

      {/* NEW BUTTON FOR PROGRESS */}
      <button onClick={() => setActiveView('progress')} className={`w-full mb-2 px-4 py-2 font-bold rounded-md ${activeView === 'progress' ? 'bg-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        Progress
      </button>

      <button onClick={() => setActiveView('knowledge')} className={`w-full mb-4 px-4 py-2 font-bold rounded-md ${activeView === 'knowledge' ? 'bg-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        Knowledge Base
      </button>

      <div className="flex-1 overflow-y-auto">
        <h2 className="text-sm font-semibold text-gray-400 mb-2 px-2">History</h2>
        <div className="space-y-1">
          {sessions.map(session => (
            <div key={session.id} onClick={() => handleSelectSession(session.id)} className={`group flex justify-between items-center p-2 rounded-md cursor-pointer ${activeSessionId === session.id ? 'bg-gray-600' : 'hover:bg-gray-700'}`}>
              <p className="truncate text-sm">{session.title || `Chat from ${new Date(session.created_at).toLocaleDateString()}`}</p>
              <button onClick={(e) => handleDeleteSession(session.id, e)} className="text-gray-500 hover:text-red-500">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4">
          <button onClick={logout} className="w-full text-left text-sm text-gray-400 hover:text-white p-2 rounded-md hover:bg-gray-700">Logout</button>
      </div>
    </div>
  );
}