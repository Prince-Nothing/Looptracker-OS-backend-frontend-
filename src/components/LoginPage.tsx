'use client';

import { useState } from 'react';
import { useAppContext } from '@/context/AppContext';

// NEW PROP: Add a function to switch views
interface LoginPageProps {
  setAuthView: (view: 'login' | 'register') => void;
}

export default function LoginPage({ setAuthView }: LoginPageProps) {
  const { login } = useAppContext();
  const [email, setEmail] = useState('test@test.com');
  const [password, setPassword] = useState('test');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center text-white">Login to Looptracker OS</h1>
        {error && <p className="text-red-500 text-center">{error}</p>}
        <div className="space-y-4">
          <input type="email" className="w-full px-4 py-2 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" className="w-full px-4 py-2 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleLogin()} />
        </div>
        <button onClick={handleLogin} className="w-full px-4 py-2 font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Login</button>
        
        {/* NEW ELEMENT: Link to the registration page */}
        <p className="text-sm text-center text-gray-400">
          Don't have an account?{' '}
          <button onClick={() => setAuthView('register')} className="font-medium text-blue-500 hover:underline">
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
}