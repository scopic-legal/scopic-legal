import type { ReactNode } from 'react';
import type { SessionUser } from '../hooks/use-session.js';

interface Props {
  user: SessionUser | null;
  loading: boolean;
  children: ReactNode;
}

export function Protected({ user, loading, children }: Props) {
  if (loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Starting session...
      </div>
    );
  }

  return <>{children}</>;
}
