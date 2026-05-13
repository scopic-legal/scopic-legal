import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import cookieSession from 'cookie-session';
import { config } from './config.js';
import type { TokenBudgetStore } from '@teamsuzie/hosted-demo';

export interface SessionUser {
  email: string;
  name: string;
  role: string;
}

/**
 * Stub auth — single demo user from env. Real multi-user / multi-tenant auth
 * means swapping this for `@teamsuzie/shared-auth` (Postgres-backed users,
 * Redis-backed sessions, CSRF). The route shape (POST /api/auth/login,
 * POST /api/auth/logout, GET /api/session) is intentionally compatible with
 * the upstream pattern so the swap is mostly server-side.
 */
export function createSessionMiddleware(): RequestHandler {
  return cookieSession({
    name: config.session.cookieName,
    keys: [config.session.cookieSecret],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
  });
}

/**
 * Dev-only bypass: when SUZIELAW_AUTH_BYPASS=true, requireAuth and
 * getSessionUser pretend the demo user is always logged in. Useful when you
 * want to browse the app without a session cookie (e.g. taking screenshots).
 * MUST NOT be enabled in production — leaks the demo identity to any caller.
 */
function bypassUser(): SessionUser | null {
  if (process.env.SUZIELAW_AUTH_BYPASS !== 'true') return null;
  return {
    email: config.demo.email,
    name: config.demo.name,
    role: config.demo.role,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // cookie-session attaches req.session
  const user = (req.session as { user?: SessionUser } | null)?.user ?? bypassUser();
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export function getSessionUser(req: Request): SessionUser | null {
  return (req.session as { user?: SessionUser } | null)?.user ?? bypassUser();
}

export function createAuthRouter(opts?: { budget?: TokenBudgetStore }): Router {
  const router: Router = Router();

  router.post('/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (email !== config.demo.email.toLowerCase() || password !== config.demo.password) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const user: SessionUser = {
      email: config.demo.email,
      name: config.demo.name,
      role: config.demo.role,
    };
    opts?.budget?.upsertAccount({
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: 'demo',
      authSubject: user.email,
    });
    (req.session as { user?: SessionUser }).user = user;
    res.json({ ok: true, user });
  });

  router.post('/auth/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  router.get('/session', (req, res) => {
    const user = getSessionUser(req);
    res.json({
      user,
      tokenBudget: user && opts?.budget ? opts.budget.getSummary(user.email) : null,
    });
  });

  return router;
}
