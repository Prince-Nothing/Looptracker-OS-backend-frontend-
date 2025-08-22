'use client';

import { useState } from 'react';
import { useAppContext } from '@/context/AppContext';
import { API_URL } from '@/lib/api';

interface RegistrationPageProps {
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

    if (!email || !password || !confirmPassword) {
      setError('All fields are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Registration failed.');

      setSuccess('Registration successful! Logging you in…');
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      {/* brand mark */}
      <div className="absolute top-10 inset-x-0 flex justify-center">
        <div className="inline-flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 shadow-lg shadow-violet-500/20" />
          <div className="text-sm tracking-wider text-gray-300 uppercase">Looptracker OS</div>
        </div>
      </div>

      {/* card */}
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl shadow-black/40">
          <div className="px-6 py-7 sm:px-8 sm:py-9">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold">Create your account</h1>
              <p className="mt-1 text-sm text-gray-400">Join and start tracking loops & habits.</p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {success}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                  placeholder="you@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Password</label>
                <input
                  type="password"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Confirm password</label>
                <input
                  type="password"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleRegister()}
                />
              </div>
            </div>

            <button
              onClick={handleRegister}
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2.5 font-medium text-black shadow-md shadow-violet-500/20 transition hover:shadow-lg hover:shadow-violet-500/30"
            >
              Create account
            </button>

            <div className="mt-5 text-center text-sm text-gray-400">
              Already have an account?{' '}
              <button
                onClick={() => setAuthView('login')}
                className="font-medium text-violet-300 hover:text-violet-200 underline underline-offset-4"
              >
                Log in
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          Protected by best-practice auth. We never share your data.
        </div>
      </div>
    </div>
  );
}
