'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { API_URL } from '@/lib/api';
import { setExternalTokenGetter } from '@/lib/loopApi'; // ← NEW

// --- TYPE DEFINITIONS ---
export type ChatSession = {
  id: number;
  title: string;
  created_at: string;
};

interface IAppContext {
  authToken: string | null;
  sessions: ChatSession[];
  activeSessionId: number | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setActiveSessionId: (id: number | null) => void;
  refreshSessions: () => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
}

const AppContext = createContext<IAppContext | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  // Initial token load
  useEffect(() => {
    try {
      const token = localStorage.getItem('looptracker_auth_token');
      if (token) setAuthToken(token);
    } catch {}
  }, []);

  // Bridge authToken into loopApi so /loops* calls carry Authorization automatically
  useEffect(() => {
    setExternalTokenGetter(() => authToken);
  }, [authToken]);

  const refreshSessions = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/chats`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        setSessions(await response.json());
      } else {
        if (response.status === 401) {
          // token invalid/expired → clear state
          logout();
        }
      }
    } catch (error) {
      console.error('Failed to fetch chat sessions:', error);
    }
  }, [authToken]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }),
    });
    if (!response.ok) {
      let detail = 'Login failed.';
      try {
        const errorData = await response.json();
        detail = errorData.detail || detail;
      } catch {}
      throw new Error(detail);
    }
    const data = await response.json();
    const token = data.access_token as string;
    localStorage.setItem('looptracker_auth_token', token);
    setAuthToken(token);
    // refreshSessions will run via effect; no need to call here
  };

  const logout = () => {
    try {
      localStorage.removeItem('looptracker_auth_token');
    } catch {}
    setAuthToken(null);
    setSessions([]);
    setActiveSessionId(null);
  };

  const deleteSession = async (sessionIdToDelete: number) => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/chats/${sessionIdToDelete}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionIdToDelete));
        if (activeSessionId === sessionIdToDelete) {
          setActiveSessionId(null);
        }
      }
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const value = {
    authToken,
    sessions,
    activeSessionId,
    login,
    logout,
    setActiveSessionId,
    refreshSessions,
    deleteSession,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
