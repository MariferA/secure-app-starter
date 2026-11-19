import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiEndpoint } from '../../lib/config';
export function useLiveSession(userId: string | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let closed = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const url = new URL(apiEndpoint('/events'));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onmessage = () => {
        void client.invalidateQueries({ queryKey: ['auth', 'session'] });
        void client.invalidateQueries({ queryKey: ['audit'] });
        void client.invalidateQueries({ queryKey: ['sessions'] });
        void client.invalidateQueries({ queryKey: ['registrations'] });
      };
      socket.onclose = () => {
        if (!closed) timer = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.close();
    };
  }, [client, userId]);
}
