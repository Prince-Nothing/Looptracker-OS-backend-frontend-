'use client';

import { useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';

interface RegistrationPageProps {
  // A function to switch the view back to the login page
  setAuthView: (view: 'login' | 'register') => void;
}

export default function RegistrationPage({ setAuthView }: RegistrationPageProps) {
  const { login } = useAppContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleRegister = async () => {
    setError('');
    setSuccess('');

    // --- Frontend Validation ---
    if (!email || !password || !confirmPassword) {
      setError('All fields are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      // --- API Call to Register ---
      const response = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Registration failed.');
      }

      setSuccess('Registration successful! Logging you in...');

      // --- Auto-Login on Success ---
      await login(email, password);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-center text-white">Create Account</h1>
        
        {error && <p className="text-red-500 text-center">{error}</p>}
        {success && <p className="text-green-500 text-center">{success}</p>}

        <div className="space-y-4">
          <input type="email" className="w-full px-4 py-2 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" className="w-full px-4 py-2 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input type="password" className="w-full px-4 py-2 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleRegister()} />
        </div>
        
        <button onClick={handleRegister} className="w-full px-4 py-2 font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          Sign Up
        </button>

        <p className="text-sm text-center text-gray-400">
          Already have an account?{' '}
          <button onClick={() => setAuthView('login')} className="font-medium text-blue-500 hover:underline">
            Log In
          </button>
        </p>
      </div>
    </div>
  );
}