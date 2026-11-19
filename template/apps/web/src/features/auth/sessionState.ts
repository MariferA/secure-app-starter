import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from './store';
export function clearPrivateState(client: QueryClient) {
  const privateQuery = (q: { queryKey: readonly unknown[] }) =>
    !(q.queryKey[0] === 'auth' && ['session', 'config'].includes(String(q.queryKey[1])));
  void client.cancelQueries({ predicate: privateQuery });
  client.removeQueries({ predicate: privateQuery });
  client.getMutationCache().clear();
  useAuthStore.getState().resetUi();
}
export function endLocalSession(client: QueryClient) {
  clearPrivateState(client);
  client.setQueryData(['auth', 'session'], { authenticated: false });
}
export function broadcastSession(
  message: { type: 'logout' } | { type: 'activity'; userId: string; idleExpiresAt: number },
) {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('__APP_SLUG__-session');
  channel.postMessage(message);
  channel.close();
}
