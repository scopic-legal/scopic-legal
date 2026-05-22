import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AppShell,
  AppShellMain,
  SidePanelSurface,
  Button,
  PersonaAvatar,
  PersonaPicker,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarNav,
  SidebarNavItem,
  StatusDot,
  cn,
  usePersonas,
  useSelectedPersona,
  useTheme,
} from '@teamsuzie/ui';
import { Protected } from './components/protected.js';
import { useAssistantChats } from './hooks/use-assistant-chats.js';
import { useBilling } from './hooks/use-billing.js';
import { useSession } from './hooks/use-session.js';
import { AssistantPage } from './pages/assistant.js';
import { HistoryPage } from './pages/history.js';
import { KnowledgeBasePage } from './pages/knowledge-base.js';
import { LibraryPage } from './pages/library.js';
import { BillingPage } from './pages/billing.js';
import { BillingReturnPage } from './pages/billing-return.js';
import { MattersPage } from './pages/matters.js';
import { MatterDetailPage } from './pages/matter-detail.js';
import { ReviewDetailPage } from './pages/review-detail.js';
import { MatterChatPage } from './pages/matter-chat.js';
import { ReviewChatPage } from './pages/review-chat.js';
import { PersonasPage } from './pages/personas.js';
import { AdminPage } from './pages/admin.js';
import { SettingsPage } from './pages/settings.js';

interface HealthResponse {
  title: string;
  agent: {
    name: string;
    description?: string;
    model?: string;
    reachable: boolean;
    error?: string;
  };
  kb?: { enabled: boolean; documents?: number; chunks?: number };
  modelAgents?: Record<string, { baseUrl: string }>;
  cloudProviders?: { id: string; label: string; modelIds: string[]; hint?: string; keyUrl?: string }[];
  demo?: { email: string; password: string };
}

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}
const BASE_NAV_TAIL: NavItem[] = [
  { to: '/matters', label: 'Matters' },
  { to: '/library', label: 'Library' },
  { to: '/personas', label: 'Personas' },
];
const KB_NAV_ITEM: NavItem = { to: '/knowledge-base', label: 'Knowledge Base' };
const TAIL_NAV: NavItem[] = [
  { to: '/history', label: 'History' },
  { to: '/admin', label: 'Admin' },
];

function AssistantChatRoute(props: {
  agentName: string;
  persona: ReturnType<typeof usePersonas>['personas'][number] | null;
  onOpenPicker: () => void;
  onSelectPersonaId: (id: string | null) => void;
  defaultModel?: string;
}) {
  const { chatId } = useParams<{ chatId: string }>();
  return <AssistantPage {...props} chatId={chatId} />;
}

/**
 * Assistant sidebar link. NavLink's built-in active matcher only handles a
 * single path pattern; we want the row highlighted when the user is on `/`
 * (greeting) OR any `/c/:chatId` chat. So we drive `aria-current` ourselves
 * — SidebarNavItem reads it for active styling.
 *
 * SidebarNavItem with `asChild` uses Radix `Slot`, which clones className /
 * data-slot props onto the child *element*. So this component must spread
 * `props` onto the inner Link — otherwise the sidebar's row styling never
 * reaches the anchor and the row looks unstyled.
 */
function AssistantNavLink({
  to,
  label,
  ...props
}: { to: string; label: string } & React.ComponentPropsWithoutRef<'a'>) {
  const location = useLocation();
  const isActive =
    location.pathname === '/' || location.pathname.startsWith('/c/');
  return (
    <Link to={to} aria-current={isActive ? 'page' : undefined} {...props}>
      {label}
    </Link>
  );
}

/**
 * Bauhaus theme toggle — inline because the sidebar is inverted and the
 * generic ThemeToggle component is styled for non-inverted surfaces. Three
 * letters, hairline border, saffron active fill.
 */
function InvertedThemeToggle() {
  const [theme, setTheme] = useTheme();
  const options: { value: 'light' | 'system' | 'dark'; label: string }[] = [
    { value: 'light', label: 'L' },
    { value: 'system', label: 'S' },
    { value: 'dark', label: 'D' },
  ];
  return (
    <div className="inline-flex items-center border border-background/20" role="radiogroup" aria-label="Color theme">
      {options.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(opt.value)}
            title={`${opt.value[0].toUpperCase() + opt.value.slice(1)} theme`}
            className={cn(
              'h-5 w-6 font-mono text-[10px] leading-none transition-colors',
              active
                ? 'bg-saffron-400 text-ink-900'
                : 'text-background/60 hover:bg-background/10 hover:text-background',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Wordmark({ title }: { title: string }) {
  const parts = title.toUpperCase().split(' ');
  const head = parts.slice(0, parts.length - 1).join(' ') || parts[0] || 'SUZIE';
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  return (
    <div className="flex items-center gap-3 text-background">
      <img
        src="/logos/scopic-white.png"
        alt=""
        className="size-9 shrink-0 object-contain"
        aria-hidden="true"
      />
      <div className="flex flex-col leading-none">
        <span className="font-display text-[1.05rem] font-bold tracking-[-0.02em]">
          {head}
        </span>
        {tail && (
          <>
            <span className="my-1.5 inline-block h-px w-7 bg-background/60" aria-hidden />
            <span className="font-display text-[1.05rem] font-bold tracking-[-0.02em]">
              {tail}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoaded, setHealthLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const session = useSession();
  const billing = useBilling();
  const navigate = useNavigate();
  const { personas, loading: personasLoading } = usePersonas();
  const personaList = Array.isArray(personas) ? personas : [];
  const [selectedPersonaId, setSelectedPersonaId] = useSelectedPersona('scopic:selected-persona');
  const selectedPersona = useMemo(
    () => personaList.find((p) => p.id === selectedPersonaId) ?? null,
    [personaList, selectedPersonaId],
  );
  // The "Assistant" sidebar link resumes the most recent chat when one
  // exists — clicking it shouldn't blow away the chat the user was in.
  // The "New chat" button on the Assistant page navigates to bare `/` to
  // get a fresh greeting, which then creates a chat on first send.
  const assistantChats = useAssistantChats();
  const mostRecentChatId = assistantChats.chats[0]?.id;
  const assistantTo = mostRecentChatId
    ? `/c/${encodeURIComponent(mostRecentChatId)}`
    : '/';
  const nav = useMemo(() => {
    const head: NavItem[] = [
      // `end: false` here so the link stays highlighted on `/c/*` too —
      // matches the user expectation that "Assistant" is the active tab
      // whenever you're inside a top-level chat.
      { to: assistantTo, label: 'Assistant', end: false },
      ...BASE_NAV_TAIL,
    ];
    return health?.kb?.enabled ? [...head, KB_NAV_ITEM, ...TAIL_NAV] : [...head, ...TAIL_NAV];
  }, [health?.kb?.enabled, assistantTo]);

  useEffect(() => {
    let cancelled = false;

    async function refreshHealth() {
      try {
        const response = await fetch('/api/health');
        const next = (await response.json()) as HealthResponse;
        if (!cancelled) setHealth(next);
      } catch {
        if (!cancelled) {
          setHealth((current) =>
            current
              ? { ...current, agent: { ...current.agent, reachable: false } }
              : current,
          );
        }
      } finally {
        if (!cancelled) setHealthLoaded(true);
      }
    }

    void refreshHealth();
    const interval = window.setInterval(() => {
      void refreshHealth();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const title = health?.title || 'Scopic';
  const agentName = health?.agent?.name || 'Counsel';
  const agentReachable = health?.agent?.reachable ?? false;
  const statusState: 'online' | 'offline' | 'pending' = !healthLoaded
    ? 'pending'
    : agentReachable
      ? 'online'
      : 'offline';

  return (
    <Routes>
      <Route
        path="/login"
        element={<Navigate to="/" replace />}
      />
      {/* Stripe Checkout returns here. Outside <Protected> because Stripe's
          redirect is the only thing on the page — the session cookie is
          still present from before the user left, so the inner /api/billing
          calls still authenticate. */}
      <Route path="/billing/return" element={<BillingReturnPage />} />
      <Route
        path="/*"
        element={
          <Protected user={session.user} loading={session.loading}>
            <AppShell>
              {/* Bauhaus sidebar shell — ink-black block, ivory type, saffron
                  active marker. The upstream Sidebar primitive accepts a
                  className override so we don't have to fork it. */}
              <Sidebar className="scopic-sidebar w-64 border-r-0 bg-foreground text-background">
                <SidebarHeader className="h-auto px-5 pb-6 pt-6">
                  <Wordmark title={title} />
                </SidebarHeader>
                <div className="mx-5 mb-4 h-px bg-background/15" aria-hidden />
                <SidebarNav className="px-3">
                  {nav.map((item) => (
                    <SidebarNavItem
                      key={item.label}
                      asChild
                      className={cn(
                        // IBM Plex Sans (sans, not display) at 600 — quieter
                        // than the previous Archivo Black, still bauhaus.
                        'group relative my-0.5 rounded-none px-4 py-1.5 font-sans text-[12px] font-semibold uppercase tracking-[0.12em]',
                        // Override the upstream muted/foreground rules so the row
                        // reads correctly on the ink-black ground.
                        'text-background/60 hover:bg-background/5 hover:text-background',
                        // Active row gets a saffron leading bar and white type.
                        'aria-[current=page]:bg-transparent aria-[current=page]:text-background aria-[current=page]:shadow-none',
                        'aria-[current=page]:before:absolute aria-[current=page]:before:left-0 aria-[current=page]:before:top-1/2 aria-[current=page]:before:h-5 aria-[current=page]:before:w-1 aria-[current=page]:before:-translate-y-1/2 aria-[current=page]:before:bg-saffron-400',
                      )}
                    >
                      {item.label === 'Assistant' ? (
                        <AssistantNavLink to={item.to} label={item.label} />
                      ) : (
                        <NavLink to={item.to} end={item.end}>
                          {item.label}
                        </NavLink>
                      )}
                    </SidebarNavItem>
                  ))}
                </SidebarNav>

                <SidebarFooter className="border-t border-background/15 px-5 py-4 text-background">
                  {/* Persona switcher — looks like a small "stamped" card */}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    title="Switch persona"
                    className="mb-3 flex w-full items-center gap-3 border border-background/20 bg-transparent px-3 py-2 text-left transition-colors hover:border-saffron-400 hover:bg-background/5"
                  >
                    <PersonaAvatar persona={selectedPersona} size="xs" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-background">
                        {selectedPersona ? selectedPersona.name : 'Default Counsel'}
                      </div>
                      <div className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-background/50">
                        Switch persona →
                      </div>
                    </div>
                  </button>

                  <SidebarNavItem
                    asChild
                    className={cn(
                      'rounded-none px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]',
                      'text-background/60 hover:bg-background/5 hover:text-background',
                      'aria-[current=page]:bg-transparent aria-[current=page]:text-background aria-[current=page]:shadow-none',
                    )}
                  >
                    <NavLink to="/settings" className="flex items-center gap-2">
                      Settings
                      {statusState === 'offline' && healthLoaded && (
                        <span
                          aria-label="Setup required"
                          className="inline-block size-1.5 rounded-full bg-destructive"
                        />
                      )}
                    </NavLink>
                  </SidebarNavItem>

                  {/* Billing pill — hidden when the server hasn't returned a
                      billing record yet (loading) or when billing is disabled
                      entirely (no Stripe key, no OrgBilling row). Shows the
                      credit balance and links to the full billing page. */}
                  {billing.billing && (
                    <Link
                      to="/billing"
                      className={cn(
                        'mt-2 flex items-center justify-between border border-background/20 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] transition-colors hover:border-saffron-400 hover:bg-background/5',
                        billing.billing.credit_balance < 1 && 'border-destructive/70 text-destructive',
                      )}
                    >
                      <span className="font-mono text-background/60">Credits</span>
                      <span className="font-mono font-semibold text-background">
                        ${billing.billing.credit_balance.toFixed(2)}
                      </span>
                    </Link>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          'inline-block size-2 rounded-full',
                          statusState === 'online'
                            ? 'bg-saffron-400'
                            : statusState === 'offline'
                              ? 'bg-destructive'
                              : 'bg-background/40',
                        )}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-background/60">
                        {agentName}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void session.logout().then(() => navigate('/login', { replace: true }));
                      }}
                      className="font-mono text-[10px] uppercase tracking-[0.10em] text-background/60 underline-offset-4 hover:text-background hover:underline"
                    >
                      Sign out
                    </button>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-background/40">
                      Theme
                    </span>
                    <InvertedThemeToggle />
                  </div>
                </SidebarFooter>
              </Sidebar>
              <AppShellMain>
                {statusState === 'offline' && healthLoaded && !bannerDismissed && (
                  <div className="flex items-center justify-between gap-4 border-b border-destructive/30 bg-destructive/5 px-6 py-2.5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.10em] text-destructive">
                      Counsel is not connected — add your API key in Settings to get started.
                    </p>
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => navigate('/settings')}
                        className="font-mono text-[11px] font-semibold uppercase tracking-[0.10em] text-destructive underline underline-offset-2 hover:text-destructive/70"
                      >
                        Go to Settings →
                      </button>
                      <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() => setBannerDismissed(true)}
                        className="font-mono text-[11px] text-destructive/50 hover:text-destructive"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
                <Routes>
                  <Route
                    path="/"
                    element={
                      <AssistantPage
                        agentName={agentName}
                        persona={selectedPersona}
                        onOpenPicker={() => setPickerOpen(true)}
                        onSelectPersonaId={setSelectedPersonaId}
                        defaultModel={health?.agent?.model}
                      />
                    }
                  />
                  <Route
                    path="/c/:chatId"
                    element={
                      <AssistantChatRoute
                        agentName={agentName}
                        persona={selectedPersona}
                        onOpenPicker={() => setPickerOpen(true)}
                        onSelectPersonaId={setSelectedPersonaId}
                        defaultModel={health?.agent?.model}
                      />
                    }
                  />
                  <Route path="/matters" element={<MattersPage />} />
                  <Route path="/matters/:matterId" element={<MatterDetailPage />} />
                  <Route
                    path="/matters/:matterId/reviews/:reviewId"
                    element={<ReviewDetailPage />}
                  />
                  <Route
                    path="/matters/:matterId/reviews/:reviewId/chats/:chatId"
                    element={<ReviewChatPage />}
                  />
                  <Route
                    path="/matters/:matterId/chats/:chatId"
                    element={<MatterChatPage />}
                  />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/personas" element={<PersonasPage />} />
                  {health?.kb?.enabled && (
                    <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
                  )}
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route
                    path="/settings"
                    element={
                      <SettingsPage
                        defaultModel={health?.agent?.model}
                        cloudProviders={health?.cloudProviders ?? []}
                      />
                    }
                  />
                  <Route path="/billing" element={<BillingPage />} />
                </Routes>
              </AppShellMain>
              <SidePanelSurface />
            </AppShell>
            <PersonaPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              personas={personaList}
              loading={personasLoading}
              selectedId={selectedPersonaId}
              onSelect={(p) => setSelectedPersonaId(p.id)}
              onClearSelection={() => setSelectedPersonaId(null)}
            />
          </Protected>
        }
      />
    </Routes>
  );
}
