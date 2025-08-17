'use client';

import { useState } from 'react'; // <-- IMPORT useState
import { useAppContext } from '@/context/AppContext';
import LoginPage from '@/components/LoginPage';
import RegistrationPage from '@/components/RegistrationPage'; // <-- IMPORT RegistrationPage
import AppDashboard from '@/components/AppDashboard';

export default function Home() {
  const { authToken } = useAppContext();
  // NEW STATE: To control which auth form is shown
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  // If the user is authenticated, show the main dashboard
  if (authToken) {
    return <AppDashboard />;
  }

  // If not authenticated, show either the login or registration page
  return authView === 'login' ? (
    <LoginPage setAuthView={setAuthView} />
  ) : (
    <RegistrationPage setAuthView={setAuthView} />
  );
}