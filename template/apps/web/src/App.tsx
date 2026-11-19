import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  ChevronDown,
  Compass,
  LogOut,
  ShieldCheck,
  Users,
  Mountain,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { ScrollArea } from './components/ui/scroll-area';
import { ConfirmModal } from './components/ConfirmModal';
import { useAuthConfig, useLogout, useSession } from './features/auth/queries';
import { useIdleSession } from './features/auth/useIdleSession';
import { useLiveSession } from './features/auth/useLiveSession';
import { useAuthStore } from './features/auth/store';
import { endLocalSession, broadcastSession } from './features/auth/sessionState';
import { appConfig, apiEndpoint } from './lib/config';
import { api, ApiError } from './lib/api';
function Brand() {
  return (
    <Link className="brand" to="/">
      <Mountain size={27} aria-hidden="true" />
      {appConfig.name}
    </Link>
  );
}
function Message({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="notice">
      {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
      {error instanceof ApiError && error.status === 428 && (
        <>
          {' '}
          <a className="text-link" href={apiEndpoint('/auth/reauth')}>
            Verify with Google
          </a>
        </>
      )}
    </p>
  ) : null;
}
function AuthPage({ register = false }: { register?: boolean }) {
  const config = useAuthConfig();
  const session = useSession();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const status = params.get('status');
  const error = params.get('error');
  if (session.data?.authenticated) return <Navigate to="/dashboard" replace />;
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div className="story-copy">
          <p className="eyebrow">A fresh perspective</p>
          <h1>
            A little curiosity.
            <br />A new direction.
          </h1>
          <p>Make room for what comes next.</p>
          <div className="trail-lines" aria-hidden="true">
            <svg viewBox="0 0 560 250">
              <path d="M-20 240C100 90 130 290 230 130S390 120 580 0" />
              <path d="M-20 270C100 120 130 320 230 160S390 150 580 30" />
              <path d="M-20 300C100 150 130 350 230 190S390 180 580 60" />
            </svg>
          </div>
        </div>
        <span className="story-footer">Built for the journey ahead.</span>
      </section>
      <section className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form">
          <p className="eyebrow">{register ? 'Your next chapter' : 'Your space, your pace'}</p>
          <h2>{register ? 'Let’s get you started.' : 'Welcome back.'}</h2>
          <p className="muted">
            {register
              ? 'Request access with your Google account. An administrator will approve your registration.'
              : 'Sign in to your personal workspace.'}
          </p>
          {status && (
            <p role="status" className="notice">
              {status === 'approved'
                ? 'Your access is approved. You can sign in.'
                : status === 'pending'
                  ? 'Your request is with the administrator. Come back after your access is approved.'
                  : 'Your request is not approved. Contact the administrator.'}
            </p>
          )}
          {error && (
            <p role="alert" className="notice">
              {error.startsWith('registration_')
                ? 'Your registration needs administrator approval.'
                : 'We couldn’t sign you in. Check your setup or try again.'}
            </p>
          )}
          <Message error={config.error} />
          <Button
            className="google-button"
            disabled={!config.data?.googleEnabled}
            asChild={Boolean(config.data?.googleEnabled)}
          >
            {config.data?.googleEnabled ? (
              <a href={apiEndpoint(register ? '/auth/register' : '/auth/google')}>
                <span className="google-mark" aria-hidden="true">
                  G
                </span>
                Continue with Google
                <ArrowUpRight size={18} />
              </a>
            ) : (
              <span>
                <span className="google-mark" aria-hidden="true">
                  G
                </span>
                {config.isPending ? 'Checking sign-in…' : 'Google sign-in needs setup'}
              </span>
            )}
          </Button>
          {config.data && !config.data.googleEnabled && (
            <p className="setup-note">
              Add this app’s Google credentials and MongoDB connection to its local .env, then
              restart the API.
            </p>
          )}
          <div className="auth-divider" />
          <p className="auth-switch">
            {register ? 'Already approved?' : 'New here?'}{' '}
            <Link to={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Request access'}
              <ArrowRight size={14} />
            </Link>
          </p>
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>Google sign-in. Private sessions. Your own space.</span>
          </div>
        </div>
        <small className="auth-bottom">{appConfig.name} · A fresh start.</small>
      </section>
    </main>
  );
}
function Protected() {
  const session = useSession(true, 30000);
  const locked = useAuthStore((s) => s.isSessionLocked);
  useIdleSession(session.data, true);
  useLiveSession(session.data?.user?.googleId);
  if (session.isPending)
    return (
      <div className="state-page" role="status">
        Opening your workspace…
      </div>
    );
  if (session.error)
    return (
      <div className="state-page">
        <h1>We couldn’t check your session.</h1>
        <p>Check that the API and database are running.</p>
        <Button onClick={() => void session.refetch()}>Try again</Button>
        <Link to="/login">Back to sign in</Link>
      </div>
    );
  if (!session.data?.authenticated) return <Navigate to="/login" replace />;
  if (locked)
    return (
      <div className="state-page" role="status">
        Checking your session…
      </div>
    );
  return <Layout />;
}
function Layout() {
  const session = useSession();
  const user = session.data?.user;
  const location = useLocation();
  const logout = useLogout();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const page = location.pathname.endsWith('/security')
      ? 'security'
      : location.pathname.endsWith('/approvals')
        ? 'approvals'
        : 'workspace';
    void api('/activity-events', {
      method: 'POST',
      body: JSON.stringify({ action: 'ui.navigation', page }),
    }).catch(() => {});
  }, [location.pathname]);
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">Personal workspace</div>
        <nav aria-label="Workspace">
          <NavLink to="/dashboard" end>
            <Compass />
            Workspace
          </NavLink>
          <NavLink to="/dashboard/security">
            <ShieldCheck />
            Security & audit
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/dashboard/approvals">
              <Users />
              Access requests
            </NavLink>
          )}
        </nav>
        <div className="sidebar-note">
          <Mountain />
          <p>
            A fresh start.
            <br />
            Make it your own.
          </p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <span>/</span>{' '}
            {location.pathname.endsWith('security')
              ? 'Security & audit'
              : location.pathname.endsWith('approvals')
                ? 'Access requests'
                : 'Home'}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="profile-button">
                <span className="avatar">{user?.name?.slice(0, 1) || 'U'}</span>
                <span className="profile-copy">
                  {user?.name || user?.email}
                  <small>{user?.role === 'admin' ? 'Administrator' : 'Member'}</small>
                </span>
                <ChevronDown size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/dashboard/security">
                  <ShieldCheck />
                  Security & audit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirm(true)}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="workspace-content">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          {appConfig.name}
          <span>Your workspace. Your next chapter.</span>
        </footer>
      </div>
      {confirm && (
        <ConfirmModal
          title="Sign out?"
          description="You can sign in again with your Google account."
          confirmLabel="Sign out"
          pending={logout.isPending}
          error={logout.error?.message}
          onCancel={() => setConfirm(false)}
          onConfirm={() => logout.mutate()}
        />
      )}
    </div>
  );
}
function Workspace() {
  return (
    <div className="empty-workspace">
      <div className="empty-icon">
        <Compass size={36} />
      </div>
      <p className="eyebrow">Ready when you are</p>
      <h1>A space for your next idea.</h1>
      <p>Your workspace is ready. Build your first feature here.</p>
      <Button variant="outline" asChild>
        <Link to="/dashboard/security">
          View security & audit
          <ArrowUpRight size={17} />
        </Link>
      </Button>
    </div>
  );
}
interface AuditEvent {
  id: string;
  action: string;
  outcome: string;
  evidence: string;
  createdAt: string;
  page?: string;
  reason?: string;
}
function Security() {
  const session = useSession();
  const client = useQueryClient();
  const [scope, setScope] = useState('account');
  const [cursor, setCursor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const audit = useQuery({
    queryKey: ['audit', session.data?.user?.googleId, scope, cursor],
    queryFn: ({ signal }) =>
      api<{ events: AuditEvent[]; nextCursor: string | null; retentionDays: number }>(
        '/audit?scope=' + scope + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        { signal },
      ),
  });
  const sessions = useQuery({
    queryKey: ['sessions', session.data?.user?.googleId],
    queryFn: ({ signal }) =>
      api<{ sessions: { current: boolean; authenticatedAt: string; idleExpiresAt: string }[] }>(
        '/auth/sessions',
        { signal },
      ),
  });
  const revoke = useMutation({
    mutationFn: () =>
      api('/auth/sessions/revoke-all', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
    onSuccess: () => {
      endLocalSession(client);
      broadcastSession({ type: 'logout' });
    },
  });
  return (
    <div className="page-stack">
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>
            Sessions expire after 10 minutes without activity, with an 8-hour maximum.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Message error={sessions.error} />
          <ul className="session-list">
            {sessions.data?.sessions.map((s, i) => (
              <li key={i}>
                <ShieldCheck size={20} />
                <div>
                  {s.current ? 'This session' : 'Another active session'}
                  <small>Signed in {new Date(s.authenticatedAt).toLocaleString()}</small>
                </div>
                <span className="badge">Active</span>
              </li>
            ))}
          </ul>
          <div className="security-actions">
            <Button variant="outline" asChild>
              <a href={apiEndpoint('/auth/reauth')}>Verify with Google</a>
            </Button>
            <Button variant="destructive" onClick={() => setConfirm(true)}>
              Sign out all sessions
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="section-heading">
            <div>
              <CardTitle>Audit trail</CardTitle>
              <CardDescription>
                Account activity, security decisions, and session events.
              </CardDescription>
            </div>
            {session.data?.user?.role === 'admin' && (
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v);
                  setCursor(null);
                }}
              >
                <SelectTrigger aria-label="Audit scope" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="account">My account</SelectItem>
                  <SelectItem value="anonymous">Sign-in attempts</SelectItem>
                  <SelectItem value="system">System events</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Message error={audit.error} />
          <ScrollArea className="h-96 audit-scroll">
            <div className="audit-list">
              {audit.isPending ? (
                <p role="status">Loading activity…</p>
              ) : audit.data?.events.length ? (
                audit.data.events.map((e) => (
                  <article key={e.id}>
                    <div>
                      <strong>{e.action.replaceAll('.', ' / ').replaceAll('_', ' ')}</strong>
                      <small>
                        {new Date(e.createdAt).toLocaleString()} ·{' '}
                        {e.evidence === 'client' ? 'Reported by browser' : 'Recorded by server'}
                      </small>
                    </div>
                    <span className="badge">{e.outcome}</span>
                  </article>
                ))
              ) : (
                <p className="muted">No activity in this view yet.</p>
              )}
            </div>
          </ScrollArea>
          <div className="audit-pagination">
            <small className="muted">Retention: {audit.data?.retentionDays || 180} days</small>
            <Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>
              Latest
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!audit.data?.nextCursor}
              onClick={() => setCursor(audit.data?.nextCursor || null)}
            >
              Older events
            </Button>
          </div>
        </CardContent>
      </Card>
      {confirm && (
        <ConfirmModal
          title="Sign out all sessions?"
          description="This includes your current session. Verify with Google again if your sign-in is more than five minutes old."
          destructive
          confirmLabel="Sign out all sessions"
          pending={revoke.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => revoke.mutate()}
          error={revoke.error?.message}
        >
          <Message
            error={
              revoke.error instanceof ApiError && revoke.error.status === 428 ? revoke.error : null
            }
          />
        </ConfirmModal>
      )}
    </div>
  );
}
interface Registration {
  id: string;
  name: string;
  email: string;
  status: string;
}
function Approvals() {
  const session = useSession();
  const client = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [decision, setDecision] = useState<{ user: Registration; action: string } | null>(null);
  const allowed = session.data?.user?.role === 'admin';
  const requests = useQuery({
    queryKey: ['registrations', session.data?.user?.googleId, status],
    enabled: allowed,
    queryFn: ({ signal }) =>
      api<{ registrations: Registration[]; hasMore: boolean }>(
        '/admin/registrations?status=' + status,
        { signal },
      ),
  });
  const mutation = useMutation({
    mutationFn: () =>
      api('/admin/registrations/' + encodeURIComponent(decision!.user.id) + '/decision', {
        method: 'POST',
        body: JSON.stringify({ decision: decision!.action, confirm: true }),
      }),
    onSuccess: () => {
      setDecision(null);
      void client.invalidateQueries({ queryKey: ['registrations'] });
    },
  });
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return (
    <Card>
      <CardHeader>
        <div className="section-heading">
          <div>
            <CardTitle>Access requests</CardTitle>
            <CardDescription>Approve registration or revoke a member’s access.</CardDescription>
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label="Registration status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['pending', 'approved', 'rejected', 'revoked', 'all'].map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <Message error={requests.error} />
        <ScrollArea className="max-h-[60dvh]">
          <div className="registration-list">
            {requests.isPending ? (
              <p role="status">Loading requests…</p>
            ) : requests.data?.registrations.length ? (
              requests.data.registrations.map((u) => (
                <article key={u.id}>
                  <div>
                    <strong>{u.name}</strong>
                    <small>
                      {u.email} · {u.status}
                    </small>
                  </div>
                  <div className="security-actions">
                    {u.status === 'approved' ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          mutation.reset();
                          setDecision({ user: u, action: 'revoke' });
                        }}
                      >
                        Revoke
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            mutation.reset();
                            setDecision({ user: u, action: 'approve' });
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            mutation.reset();
                            setDecision({ user: u, action: 'reject' });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">No {status === 'all' ? '' : status + ' '}registrations.</p>
            )}
            {requests.data?.hasMore && (
              <p className="muted">
                Showing the first 100 requests. Narrow the status filter to see more.
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
      {decision && (
        <ConfirmModal
          title={decision.action.charAt(0).toUpperCase() + decision.action.slice(1) + ' access?'}
          description={
            'Change access for ' +
            decision.user.email +
            '. Existing sessions for this member will end.'
          }
          confirmLabel="Confirm decision"
          destructive={decision.action !== 'approve'}
          pending={mutation.isPending}
          error={mutation.error?.message}
          onCancel={() => setDecision(null)}
          onConfirm={() => mutation.mutate()}
        >
          <Message
            error={
              mutation.error instanceof ApiError && mutation.error.status === 428
                ? mutation.error
                : null
            }
          />
        </ConfirmModal>
      )}
    </Card>
  );
}
export function NotFound() {
  return (
    <main className="state-page not-found">
      <Brand />
      <span className="error-code">404</span>
      <h1>A little off the trail.</h1>
      <p>We couldn’t find that page. Let’s get you back.</p>
      <Button asChild>
        <Link to="/">
          <ArrowLeft size={17} />
          Back to home
        </Link>
      </Button>
    </main>
  );
}
export function App() {
  useEffect(() => {
    document.title = appConfig.name;
  }, []);
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/dashboard" element={<Protected />}>
        <Route index element={<Workspace />} />
        <Route path="security" element={<Security />} />
        <Route path="approvals" element={<Approvals />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
