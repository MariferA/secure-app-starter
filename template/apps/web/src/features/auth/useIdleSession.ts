import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { fetchSession } from './queries';
import type { SessionData } from './queries';
import { broadcastSession, endLocalSession } from './sessionState';
import { useAuthStore } from './store';

export function useIdleSession(session: SessionData | undefined, enabled: boolean) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const redirect = useRef(navigate);
  useEffect(() => {
    redirect.current = navigate;
  }, [navigate]);
  const deadline = useRef(0);
  const activity = useMutation({
    mutationFn: () =>
      api<{ idleExpiresAt: number; idleTimeoutMs: number }>('/auth/activity', { method: 'POST' }),
    onSuccess: (value) => {
      client.setQueryData<SessionData>(['auth', 'session'], (old) =>
        old?.authenticated ? { ...old, ...value } : old,
      );
      const userId = client.getQueryData<SessionData>(['auth', 'session'])?.user?.googleId;
      if (userId)
        broadcastSession({ type: 'activity', userId, idleExpiresAt: value.idleExpiresAt });
    },
  });
  const sendActivity = useRef(activity.mutate);
  useEffect(() => {
    sendActivity.current = activity.mutate;
  }, [activity.mutate]);
  useEffect(() => {
    deadline.current = session?.idleExpiresAt || 0;
  }, [session?.idleExpiresAt]);

  const userId = session?.user?.googleId;
  useEffect(() => {
    if (!enabled || !userId) return;
    let disposed = false;
    let checking = false;
    let lastSentAt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('__APP_SLUG__-session') : null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void checkExpiry(), Math.max(0, deadline.current - Date.now()));
    };
    const expire = () => {
      // Lock/clear private UI even if the network is unavailable. The server also
      // rejects the expired session; token access is never needed in JavaScript.
      channel?.close();
      endLocalSession(client);
      broadcastSession({ type: 'logout' });
      redirect.current('/login?reason=idle', { replace: true });
      void api('/auth/logout', { method: 'POST' }).catch(() => {
        /* Server-side idle expiry still applies. */
      });
    };
    const checkExpiry = async () => {
      if (disposed || checking) return;
      if (Date.now() < deadline.current) {
        schedule();
        return;
      }
      checking = true;
      useAuthStore.getState().setSessionLocked(true);
      try {
        // A different active tab may have extended the session. This read never
        // records activity or extends the server deadline.
        const current = await client.fetchQuery({
          queryKey: ['auth', 'idle-check'],
          queryFn: ({ signal }) => fetchSession(signal),
          staleTime: 0,
        });
        if (disposed) return;
        if (current.authenticated && current.idleExpiresAt && current.idleExpiresAt > Date.now()) {
          deadline.current = current.idleExpiresAt;
          client.setQueryData(['auth', 'session'], current);
          useAuthStore.getState().setSessionLocked(false);
          schedule();
        } else expire();
      } catch {
        if (!disposed) expire();
      } finally {
        checking = false;
      }
    };
    const onActivity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== 'visible' || checking) return;
      if (Date.now() >= deadline.current) {
        void checkExpiry();
        return;
      }
      // Only human input sends a heartbeat. Query refetches and readiness polling
      // cannot keep a session alive. Throttling may expire up to 30s early.
      if (Date.now() - lastSentAt >= 30_000) {
        lastSentAt = Date.now();
        sendActivity.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkExpiry();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'logout') {
        endLocalSession(client);
        redirect.current('/login', { replace: true });
      } else if (
        event.data?.type === 'activity' &&
        event.data.userId === userId &&
        typeof event.data.idleExpiresAt === 'number'
      ) {
        deadline.current = event.data.idleExpiresAt;
        schedule();
      }
    };
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'session') return;
      const data = event.query.state.data as SessionData | undefined;
      if (data?.authenticated && data.idleExpiresAt) {
        deadline.current = data.idleExpiresAt;
        schedule();
      }
    });
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
    events.forEach((name) =>
      window.addEventListener(name, onActivity, { passive: true, capture: true }),
    );
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    if (channel) channel.onmessage = onMessage;
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      events.forEach((name) => window.removeEventListener(name, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
      channel?.close();
    };
    // The declarative router's navigate function changes with the pathname.
    // Retain this owner-scoped throttle and expiry check across tab navigation.
  }, [enabled, userId, client]);
}
