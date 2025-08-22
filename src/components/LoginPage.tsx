'use client';

import { useState } from 'react';
import { useAppContext } from '@/context/AppContext';

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
              <h1 className="text-2xl font-semibold">Welcome back</h1>
              <p className="mt-1 text-sm text-gray-400">Sign in to continue your session.</p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
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
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
              </div>
            </div>

            <button
              onClick={handleLogin}
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-2.5 font-medium text-black shadow-md shadow-violet-500/20 transition hover:shadow-lg hover:shadow-violet-500/30"
            >
              Sign in
            </button>

            <div className="mt-5 text-center text-sm text-gray-400">
              Don&apos;t have an account?{' '}
              <button
                onClick={() => setAuthView('register')}
                className="font-medium text-violet-300 hover:text-violet-200 underline underline-offset-4"
              >
                Create one
              </button>
            </div>
          </div>
        </div>

        {/* footer mini */}
        <div className="mt-6 text-center text-xs text-gray-500">
          By continuing you agree to our <span className="underline underline-offset-2">Terms</span> &amp; <span className="underline underline-offset-2">Privacy</span>.
        </div>
      </div>
    </div>
  );
}
