'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { API_URL } from '@/lib/api';

// --- TYPE DEFINITIONS ---
// These types can be shared across components
export type ChatSession = {
  id: number;
  title: string;
  created_at: string;
};

// Define the shape of the context's value
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

// Create the context
const AppContext = createContext<IAppContext | null>(null);

// Create the Provider component
export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  // Check for token in localStorage on initial load
  useEffect(() => {
    const token = localStorage.getItem('looptracker_auth_token');
    if (token) {
      setAuthToken(token);
    }
  }, []);

  // Fetch sessions whenever the auth token changes
  const refreshSessions = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/chats`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (response.ok) {
        setSessions(await response.json());
      } else {
        // If token is invalid, log out
        if (response.status === 401) {
          logout();
        }
      }
    } catch (error) {
      console.error("Failed to fetch chat sessions:", error);
    }
  }, [authToken]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // --- Context Functions ---

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password: password }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Login failed.');
    }
    const data = await response.json();
    const token = data.access_token;
    localStorage.setItem('looptracker_auth_token', token);
    setAuthToken(token);
  };

  const logout = () => {
    localStorage.removeItem('looptracker_auth_token');
    setAuthToken(null);
    setSessions([]);
    setActiveSessionId(null);
  };

  const deleteSession = async (sessionIdToDelete: number) => {
    if (!authToken) return;
    try {
      const response = await fetch(`${API_URL}/chats/${sessionIdToDelete}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (response.ok) {
        setSessions(prev => prev.filter(session => session.id !== sessionIdToDelete));
        if (activeSessionId === sessionIdToDelete) {
          setActiveSessionId(null);
        }
      }
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  // The value provided to consuming components
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

// Create a custom hook for easy consumption of the context
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};