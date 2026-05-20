import { useCallback, useEffect, useRef, useState } from 'react';

export interface SessionUser {
  email: string;
  name: string;
  role: string;
}

export interface TokenBudgetSummary {
  tokenLimit: number;
  tokensUsed: number;
  tokensRemaining: number;
  limitReached: boolean;
}

interface SessionState {
  user: SessionUser | null;
  tokenBudget: TokenBudgetSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo';

export function useSession(): SessionState {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tokenBudget, setTokenBudget] = useState<TokenBudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const autoLoginAttemptedRef = useRef(false);

  const loginDemoUser = useCallback(async () => {
    await fetch('/api/auth/providers', { credentials: 'include' }).catch(() => undefined);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(data.message || `Auto-login failed (${response.status})`);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    try {
      async function loadSession() {
        const response = await fetch('/api/session', { credentials: 'include' });
        if (!response.ok) {
          throw new Error(`Session request failed (${response.status})`);
        }
        return (await response.json()) as {
          user: SessionUser | null;
          tokenBudget?: TokenBudgetSummary | null;
        };
      }

      let data = await loadSession();
      if (!data.user && !autoLoginAttemptedRef.current) {
        autoLoginAttemptedRef.current = true;
        await loginDemoUser();
        data = await loadSession();
      }
      setUser(data.user);
      setTokenBudget(data.tokenBudget ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      if (!hasLoadedRef.current) {
        setUser(null);
        setTokenBudget(null);
      }
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [loginDemoUser]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setTokenBudget(null);
    autoLoginAttemptedRef.current = false;
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user, tokenBudget, loading, error, refresh, logout };
}
