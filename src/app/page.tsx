'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import LoginPage from '@/components/LoginPage';
import RegistrationPage from '@/components/RegistrationPage';
import AppDashboard from '@/components/AppDashboard';

export default function Home() {
  const { authToken } = useAppContext();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  // If the user is authenticated, show the main dashboard + a top-right link to Loops
  if (authToken) {
    return (
      <>
        <div className="fixed right-4 top-4 z-50">
          <Link
            href="/loops"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-100 hover:bg-white/10"
          >
            Open Loops
          </Link>
        </div>
        <AppDashboard />
      </>
    );
  }

  // If not authenticated, show either the login or registration page
  return authView === 'login' ? (
    <LoginPage setAuthView={setAuthView} />
  ) : (
    <RegistrationPage setAuthView={setAuthView} />
  );
}
