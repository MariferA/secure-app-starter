import type { FastifyInstance } from 'fastify';
import type { SecurityConfig } from '../security/config';
import { requireSession, SessionError } from '../security/session';
import { PolicyError } from '../security/errors';
import { recordAudit } from '../security/audit';

declare module 'fastify' {
  interface FastifyRequest {
    liveSession?: Awaited<ReturnType<typeof requireSession>>;
  }
}

export default async function eventRoutes(
  app: FastifyInstance,
  { security }: { security: SecurityConfig },
) {
  app.route({
    method: 'GET',
    url: '/events',
    preValidation: async (request, reply) => {
      if (!request.ws) return reply.code(426).send({ error: 'WebSocket upgrade required' });
      if (request.headers.origin !== security.origin)
        return reply.code(403).send({ error: 'Origin not allowed' });
      if (Object.keys(request.query as object).length)
        return reply.code(400).send({ error: 'Subscriptions do not accept query parameters' });
      try {
        request.liveSession = await requireSession(request);
      } catch (error) {
        if (error instanceof SessionError)
          return reply.code(401).send({ error: 'Sign in required' });
        throw error;
      }
      if (!app.realtime?.hasCapacity(request.liveSession.userId))
        throw new PolicyError(
          429,
          'subscription_limit',
          'Too many live connections. Close another tab and retry.',
        );
      await recordAudit(request, request.liveSession.userId, 'realtime.connected', 'success');
    },
    handler: async (_request, reply) =>
      reply.code(426).send({ error: 'WebSocket upgrade required' }),
    wsHandler(socket, request) {
      const current = request.liveSession!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastPong = Date.now();
      let unsubscribe: (() => void) | null = null;
      const send = (event: object) => {
        if (socket.readyState !== 1) return;
        if (socket.bufferedAmount > 64 * 1024) {
          socket.close(1013, 'Reconnect to sync');
          return;
        }
        socket.send(JSON.stringify(event));
      };
      socket.on('message', () => socket.close(1008, 'This subscription is read-only'));
      socket.on('error', () => socket.terminate());
      socket.on('pong', () => {
        lastPong = Date.now();
      });
      socket.once('close', (code) => {
        clearTimeout(timer);
        clearInterval(heartbeat);
        unsubscribe?.();
        void recordAudit(request, current.userId, 'realtime.disconnected', 'success', {
          reason: code === 4001 ? 'session_ended' : 'connection_closed',
        }).catch(() => {});
      });
      unsubscribe = app.realtime!.subscribe(current.userId, send, {
        sessionId: current.sessionId,
        close: () => socket.close(4001, 'Session ended'),
      });
      if (!unsubscribe) {
        socket.close(1013, 'Connection limit reached');
        return;
      }
      const verify = async () => {
        if (socket.readyState !== 1) return;
        try {
          const session = await requireSession(request);
          if (socket.readyState === 1) {
            timer = setTimeout(
              () => void verify(),
              Math.max(
                1,
                Math.min(
                  15000,
                  session.idleExpiresAt.getTime() - Date.now(),
                  session.expiresAt.getTime() - Date.now(),
                ),
              ),
            );
            timer.unref();
          }
        } catch (error) {
          socket.close(
            error instanceof SessionError ||
              (error instanceof PolicyError && error.statusCode === 403)
              ? 4001
              : 1011,
            'Reconnect to verify your session',
          );
        }
      };
      timer = setTimeout(
        () => void verify(),
        Math.max(
          1,
          Math.min(
            15000,
            current.idleExpiresAt.getTime() - Date.now(),
            current.expiresAt.getTime() - Date.now(),
          ),
        ),
      );
      timer.unref();
      const heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 45000) socket.terminate();
        else if (socket.readyState === 1) socket.ping();
      }, 20000);
      heartbeat.unref();
      send({ type: 'ready' });
    },
  });
}
