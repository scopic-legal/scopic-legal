import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface AuthProvider {
  id: string;
  label: string;
  startUrl: string;
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0"
    >
      <path
        fill="#4285F4"
        d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.25-.95 2.31-2.02 3.02v2.5h3.27c1.91-1.76 3.01-4.36 3.01-7.44 0-.72-.06-1.41-.17-2z"
      />
      <path
        fill="#34A853"
        d="M12.17 22c2.73 0 5.02-.9 6.69-2.44l-3.27-2.5c-.91.61-2.07.98-3.42.98-2.62 0-4.84-1.77-5.64-4.14H3.15v2.59A10 10 0 0 0 12.17 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.53 13.9c-.2-.61-.31-1.26-.31-1.9s.11-1.29.31-1.9V7.5H3.15A10 10 0 0 0 2.17 12c0 1.61.38 3.13 1.04 4.5l3.32-2.6z"
      />
      <path
        fill="#EA4335"
        d="M12.17 5.96c1.49 0 2.82.51 3.87 1.51l2.9-2.9C17.18 2.92 14.89 2 12.17 2A10 10 0 0 0 3.15 7.5l3.38 2.6c.8-2.37 3.02-4.14 5.64-4.14z"
      />
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('demo');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/providers', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data: { providers?: AuthProvider[] }) => {
        if (!cancelled) {
          setProviders(data.providers ?? []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDemoSignIn(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || `Sign-in failed (${res.status})`);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-0 grid-rules opacity-70" aria-hidden />
      <div className="relative w-full max-w-sm">
        {/* Decorative bauhaus header band */}
        <div className="mb-8 flex items-center gap-3">
          <span className="inline-block size-3 bg-saffron-400" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/55">
            Counsel · Sign in
          </span>
          <span className="h-px flex-1 bg-foreground/15" aria-hidden />
        </div>

        <div className="flex flex-col leading-none">
          <span className="font-display text-[2.5rem] font-bold tracking-[-0.02em] text-foreground">
            SUZIE
          </span>
          <span className="my-2 inline-block h-px w-10 bg-foreground/60" aria-hidden />
          <span className="font-display text-[2.5rem] font-bold tracking-[-0.02em] text-foreground">
            LAW
          </span>
        </div>

        <p className="mt-6 font-serif text-[15px] italic text-foreground/65">
          A specialised legal-AI workspace. Sign in to continue.
        </p>

        <div className="mt-8 flex flex-col gap-3 border-t border-foreground/15 pt-6">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => {
                window.location.href = provider.startUrl;
              }}
              className="inline-flex w-full items-center justify-center gap-3 border border-foreground bg-background px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-foreground hover:text-background"
            >
              {provider.id === 'google' ? <GoogleMark /> : null}
              <span>Continue with {provider.label}</span>
            </button>
          ))}

          {loaded && providers.length === 0 && (
            <form onSubmit={handleDemoSignIn} className="flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">
                Demo account · stub auth
              </div>
              <label className="block">
                <span className="sr-only">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="block w-full border border-foreground/30 bg-background px-3 py-2.5 font-mono text-[13px] text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none focus:ring-1 focus:ring-saffron-400"
                />
              </label>
              <label className="block">
                <span className="sr-only">Password</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="block w-full border border-foreground/30 bg-background px-3 py-2.5 font-mono text-[13px] text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none focus:ring-1 focus:ring-saffron-400"
                />
              </label>
              {error && (
                <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-destructive">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 border border-foreground bg-foreground px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-background transition-colors hover:bg-saffron-400 hover:text-foreground disabled:opacity-50"
              >
                {submitting ? 'Signing in…' : 'Sign in →'}
              </button>
              <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-foreground/45">
                Default: demo@example.com / demo. Set GOOGLE_CLIENT_ID +
                GOOGLE_CLIENT_SECRET to enable OAuth.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
