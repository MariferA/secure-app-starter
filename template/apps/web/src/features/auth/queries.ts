import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { endLocalSession, broadcastSession } from './sessionState';

export interface User {
  googleId: string;
  email: string;
  name?: string;
  picture?: string;
  role?: string;
}
export interface SessionData {
  authenticated: boolean;
  user?: User;
  idleExpiresAt?: number;
  idleTimeoutMs?: number;
}
export async function fetchSession(signal?: AbortSignal): Promise<SessionData> {
  try {
    return await api<SessionData>('/auth/me', { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { authenticated: false };
    throw error;
  }
}
export function useSession(enabled = true, activeInterval: number | false = false) {
  return useQuery({
    queryKey: ['auth', 'session'],
    enabled,
    queryFn: ({ signal }) => fetchSession(signal),
    // Recover the session gate after a temporary API/network outage, even when
    // the dashboard (and its WebSocket subscription) has been unmounted.
    refetchInterval: (query) =>
      query.state.error ? 15000 : query.state.data?.authenticated ? activeInterval : false,
  });
}
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth', 'config'],
    queryFn: ({ signal }) => api<{ googleEnabled: boolean }>('/auth/config', { signal }),
  });
}
export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      endLocalSession(client);
      broadcastSession({ type: 'logout' });
      navigate('/login', { replace: true });
    },
  });
}
