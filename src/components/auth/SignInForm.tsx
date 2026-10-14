import React, { useId, useRef, useState } from 'react';
import { apiClient } from '../../services/apiClient';

export function SignInForm({ onSignedIn, onCancel }: { onSignedIn?: () => void; onCancel?: () => void }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read the actual controls so password-manager autofill is submitted even
    // when it does not dispatch React change events.
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') ?? '').trim();
    const password = String(values.get('password') ?? '');
    setBusy(true);
    setError('');
    try {
      await apiClient.login(email, password);
      form.current?.reset();
      onSignedIn?.();
    } catch (failure) {
      setError((failure as { code?: string }).code === 'UNAUTHENTICATED'
        ? 'The email or password was not accepted. Check your details and try again.'
        : failure instanceof Error ? failure.message : 'Sign-in could not be completed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <form ref={form} onSubmit={submit} aria-labelledby={id + '-title'} className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white" aria-hidden="true">M</span>
      <span className="text-sm font-semibold text-zinc-100">Mazao ERP</span>
    </div>
    <h1 id={id + '-title'} className="text-2xl font-semibold text-zinc-100">Sign in to Mazao</h1>
    <p className="mt-2 text-sm leading-6 text-zinc-400">Use your assigned account to open your business workspace.</p>
    <label className="mt-5 block text-sm text-zinc-300" htmlFor={id + '-email'}>Email</label>
    <input id={id + '-email'} name="email" required type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus disabled={busy} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400" />
    <label className="mt-4 block text-sm text-zinc-300" htmlFor={id + '-password'}>Password</label>
    <input id={id + '-password'} name="password" required type={showPassword ? 'text' : 'password'} autoComplete="current-password" disabled={busy} aria-describedby={error ? id + '-error' : undefined} className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400" />
    <button type="button" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} className="mt-1 min-h-11 text-sm text-blue-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">{showPassword ? 'Hide password' : 'Show password'}</button>
    {error && <p id={id + '-error'} role="alert" className="mt-2 text-sm leading-6 text-rose-300">{error}</p>}
    <div className="mt-5 flex gap-3">
      {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-zinc-200">Cancel</button>}
      <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
    </div>
  </form>;
}
