import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, Mail, Lock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#09090b] text-[#ede8df]">
        <div className="w-full max-w-md p-8 rounded-2xl bg-[#0e0e12] border border-white/[0.08] shadow-2xl text-center flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-editorial text-2xl tracking-wide text-[#f5f2ec] italic">
              AuraMIDI
            </span>
            <span className="text-[10px] font-sans tracking-widest uppercase text-[#8f8a80] border border-white/[0.08] px-1.5 py-0.5 rounded">
              Studio
            </span>
          </div>
          <p className="text-sm font-sans text-[#a8a398] mt-2">
            Sign-in isn't set up yet. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const getFriendlyErrorMessage = (rawError: string): string => {
    const lower = rawError.toLowerCase();
    if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
      return 'The email or password you entered is incorrect.';
    }
    if (lower.includes('user already registered') || lower.includes('already exists')) {
      return 'An account with this email already exists. Try logging in instead.';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    if (lower.includes('is invalid') || lower.includes('invalid email')) {
      return "That email wasn't accepted. Please use a real email address you can open.";
    }
    if (lower.includes('valid email')) {
      return 'Please enter a valid email address.';
    }
    if (lower.includes('network') || lower.includes('fetch')) {
      return 'Unable to connect right now. Please check your connection and try again.';
    }
    return 'Something went wrong. Please check your details and try again.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (error) {
          setErrorMessage(getFriendlyErrorMessage(error.message));
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        if (error) {
          setErrorMessage(getFriendlyErrorMessage(error.message));
        } else if (data.user && !data.session) {
          setInfoMessage('Check your email to confirm your account.');
        }
      }
    } catch {
      setErrorMessage('Unable to connect right now. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 bg-[#09090b] text-[#ede8df] selection:bg-[#c5a059]/20 selection:text-[#f4f0e6]">
      {/* Container */}
      <div className="w-full max-w-md flex flex-col gap-6">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-editorial text-3xl sm:text-4xl tracking-wide text-[#f5f2ec] italic select-none">
              AuraMIDI
            </span>
            <span className="text-[10px] font-sans tracking-widest uppercase text-[#c5a059] border border-[#c5a059]/30 px-1.5 py-0.5 rounded bg-[#c5a059]/10">
              Studio
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#8f8a80] font-sans mt-1">
            {mode === 'login' ? 'Sign in to access your MIDI studio' : 'Create an account to get started'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#0e0e12] border border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col gap-5">
          {/* Mode switch tabs */}
          <div className="grid grid-cols-2 p-1 bg-[#141419] border border-white/[0.06] rounded-lg text-xs font-sans">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              className={`min-h-[38px] py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-[#22222a] text-[#f5f2ec] shadow-sm'
                  : 'text-[#8f8a80] hover:text-[#ede8df]'
              }`}
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              className={`min-h-[38px] py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                mode === 'signup'
                  ? 'bg-[#22222a] text-[#f5f2ec] shadow-sm'
                  : 'text-[#8f8a80] hover:text-[#ede8df]'
              }`}
            >
              Create account
            </button>
          </div>

          {/* Feedback messages */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/30 border border-red-500/30 text-red-200 text-xs font-sans leading-relaxed">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {infoMessage && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#c5a059]/10 border border-[#c5a059]/30 text-[#f5f2ec] text-xs font-sans leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#c5a059] shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-medium text-[#d8ba7f]">{infoMessage}</span>
                <span className="text-[#a8a398] text-[11px]">
                  Once confirmed, switch to &ldquo;Log in&rdquo; above to sign into your studio.
                </span>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-sans font-medium text-[#c9c4b9]">
                Email address
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3 w-4 h-4 text-[#787369] pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  required
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-[#121217] border border-white/[0.08] focus:border-[#c5a059]/60 focus:ring-1 focus:ring-[#c5a059]/40 rounded-lg text-sm text-[#ede8df] placeholder-[#5c5850] outline-none transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-sans font-medium text-[#c9c4b9]">
                  Password
                </label>
                <span className="text-[11px] text-[#787369] font-sans">
                  At least 8 characters
                </span>
              </div>
              <div className="relative flex items-center">
                <Lock className="absolute left-3 w-4 h-4 text-[#787369] pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  className="w-full min-h-[44px] pl-10 pr-11 py-2 bg-[#121217] border border-white/[0.08] focus:border-[#c5a059]/60 focus:ring-1 focus:ring-[#c5a059]/40 rounded-lg text-sm text-[#ede8df] placeholder-[#5c5850] outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1 w-9 h-9 flex items-center justify-center text-[#787369] hover:text-[#c9c4b9] transition-colors cursor-pointer rounded-md focus:outline-none"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-sans font-medium text-sm text-[#0c0c0e] bg-gradient-to-r from-[#d8ba7f] to-[#c5a059] hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none cursor-pointer transition-all shadow-md shadow-[#c5a059]/10"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#0c0c0e]" />
                  <span>{mode === 'login' ? 'Signing in…' : 'Creating account…'}</span>
                </>
              ) : (
                <span>{mode === 'login' ? 'Log in' : 'Create account'}</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
