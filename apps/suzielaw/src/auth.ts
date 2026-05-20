import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import type { SessionService } from '@teamsuzie/shared-auth';
import { createAuthRouter as createSharedAuthRouter } from '@teamsuzie/shared-auth';
import { config, sharedAuthConfig } from './config.js';
import type { TokenBudgetStore } from '@teamsuzie/hosted-demo';

export interface SessionUser {
  email: string;
  name: string;
  role: string;
}

/**
 * Shape of the session object once shared-auth's AuthController.login has run.
 * (See open_teamsuzie/packages/shared-auth/src/controllers/auth.ts → `login`.)
 * The hosted-demo OAuth router writes a different shape (`session.user`) — both
 * are handled by `getSessionUser` below.
 */
interface SharedAuthSessionShape {
  userId?: string;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  user?: SessionUser;
}

/**
 * Session middleware comes from shared-auth's SessionService (Redis-backed
 * express-session). We accept it as an argument rather than constructing it
 * here so `src/index.ts` can call `sessionService.init(app)` directly when it
 * wants the standard wiring, or grab the raw middleware via this helper for
 * tests / non-standard mounts.
 */
export function createSessionMiddleware(sessionService: SessionService): RequestHandler {
  return sessionService.getMiddleware();
}

/**
 * Dev-only bypass: when SCOPIC_AUTH_BYPASS=true, requireAuth and
 * getSessionUser pretend the demo user is always logged in. Useful when you
 * want to browse the app without a session cookie (e.g. taking screenshots).
 * MUST NOT be enabled in production — leaks the demo identity to any caller.
 */
function bypassUser(): SessionUser | null {
  if (process.env.SCOPIC_AUTH_BYPASS !== 'true') return null;
  return {
    email: config.demo.email,
    name: config.demo.name,
    role: config.demo.role,
  };
}

function readSessionUser(req: Request): SessionUser | null {
  const session = req.session as SharedAuthSessionShape | undefined;
  if (!session) return bypassUser();
  // OAuth path (hosted-demo router): session.user is set directly.
  if (session.user?.email) return session.user;
  // Email/password path (shared-auth AuthController.login): individual fields.
  if (session.userId && session.userEmail) {
    return {
      email: session.userEmail,
      name: session.userName ?? session.userEmail,
      role: session.userRole ?? 'user',
    };
  }
  return bypassUser();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!readSessionUser(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

/**
 * The 50+ call sites in `src/index.ts` (and submodules) treat this as a sync
 * accessor. Keep it sync — shared-auth's login writes the user identity
 * directly into `req.session`, so no DB lookup is needed.
 *
 * Side effect: lazily registers the user with the token-budget store on first
 * sighting, so the existing `TokenBudgetStore.upsertAccount` glue (previously
 * called inside the stub's POST /auth/login handler) still fires regardless
 * of whether the user signed in via password, OAuth, or the dev bypass.
 */
export function getSessionUser(req: Request): SessionUser | null {
  const user = readSessionUser(req);
  if (user && tokenBudget && !tokenBudget.getSummary(user.email)) {
    tokenBudget.upsertAccount({
      email: user.email,
      name: user.name,
      role: user.role,
      // TokenBudgetStore's enum only knows about hosted-demo provider ids.
      // Mark shared-auth-issued sessions as 'demo' for accounting — they're
      // distinguished from real OAuth accounts by absence of an OAuth row.
      authProvider: 'demo',
      authSubject: user.email,
    });
  }
  return user;
}

// Module-level handle to the budget store so getSessionUser can hit it
// without every call site threading it through. Wired by createAuthRouter.
let tokenBudget: TokenBudgetStore | undefined;

/**
 * Mounts shared-auth's auth routes (POST /auth/login, /auth/logout,
 * /auth/register, GET /auth/me, /auth/introspect, …) plus the Scopic-specific
 * GET /session route that the React client reads. Mount under `/api`:
 *
 *   app.use('/api', createAuthRouter({ budget: tokenBudget }));
 */
export function createAuthRouter(opts?: { budget?: TokenBudgetStore }): Router {
  if (opts?.budget) tokenBudget = opts.budget;
  const router: Router = Router();

  // Mount the shared-auth controller under /auth so the URLs the client
  // already uses (/api/auth/login, /api/auth/logout) keep working.
  router.use('/auth', createSharedAuthRouter(sharedAuthConfig));

  // Client-facing session endpoint. Returns the same shape the stub used
  // ({ user, tokenBudget }) so the existing useSession() hook is unchanged.
  router.get('/session', (req, res) => {
    const user = getSessionUser(req);
    res.json({
      user,
      tokenBudget: user && opts?.budget ? opts.budget.getSummary(user.email) : null,
    });
  });

  return router;
}
