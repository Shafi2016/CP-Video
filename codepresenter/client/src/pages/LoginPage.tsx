import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { hasFirebaseConfig } from '@/lib/firebase';

function getAuthErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const firebaseCode = String((error as { code?: string }).code || '');

    if (firebaseCode.includes('invalid-email')) return 'Enter a valid email address.';
    if (firebaseCode.includes('user-not-found')) return 'No account found for this email.';
    if (firebaseCode.includes('wrong-password')) return 'Incorrect password. Please try again.';
    if (firebaseCode.includes('invalid-credential')) return 'Email or password is incorrect.';
    if (firebaseCode.includes('too-many-requests')) return 'Too many attempts. Please try again later.';
  }

  return 'Unable to sign in right now. Please try again.';
}

function getSafeNextPath(defaultPath: string) {
  if (typeof window === 'undefined') {
    return defaultPath;
  }

  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return defaultPath;
  }

  return next;
}

export default function LoginPage() {
  const { currentUser, loading, signInWithGoogle, signInWithEmail } = useAuth();
  const [, setLocation] = useLocation();
  const nextPath = useMemo(() => getSafeNextPath('/code'), []);
  const signupPath = useMemo(
    () => (nextPath === '/code' ? '/signup' : `/signup?next=${encodeURIComponent(nextPath)}`),
    [nextPath],
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setLocation(nextPath);
    }
  }, [currentUser, nextPath, setLocation]);

  const handleGoogleLogin = async () => {
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      await signInWithGoogle();
      setLocation(nextPath);
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      await signInWithEmail(email.trim(), password);
      setLocation(nextPath);
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-emerald-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-emerald-950 text-white flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-300 mb-4">
            [CP] Presenter
          </div>
          <h1 className="text-3xl font-bold mb-2">Sign in</h1>
          <p className="text-slate-400">Sign in to continue</p>
        </div>

        <div className="p-8 rounded-2xl bg-white/5 border border-white/10 space-y-6">
          {!hasFirebaseConfig ? (
            <div className="text-center text-sm text-slate-300">
              Authentication is not configured. Set `VITE_FIREBASE_*` environment variables for this deployment.
            </div>
          ) : (
            <>
              <Button
                type="button"
                className="w-full bg-white hover:bg-gray-100 text-gray-900 font-medium py-6 text-base flex items-center justify-center gap-3"
                onClick={handleGoogleLogin}
                disabled={isSubmitting}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </Button>

              <div className="flex items-center gap-3 text-slate-500 text-xs uppercase tracking-wider">
                <div className="h-px flex-1 bg-white/10" />
                <span>or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <form className="space-y-4" onSubmit={handleEmailLogin}>
                <div className="space-y-2">
                  <label className="text-sm text-slate-300" htmlFor="login-email">Email address</label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-slate-300" htmlFor="login-password">Password</label>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm outline-none focus:border-emerald-400/60"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-6 text-base"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>

              <div className="text-center text-sm text-slate-400">
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  className="text-emerald-300 hover:text-emerald-200"
                  onClick={() => setLocation(signupPath)}
                >
                  Create free account
                </button>
              </div>
            </>
          )}

          {errorMessage && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
