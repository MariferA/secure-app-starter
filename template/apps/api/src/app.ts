import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { loadSecurity } from './security/config';
import { PolicyError } from './security/errors';
import { SessionError } from './security/session';
import { recordAudit, type AuditAction } from './security/audit';
import { AccountWriteLimitError } from './security/account-limits';
import authRoutes from './routes/auth';
import auditRoutes from './routes/audit';
import adminRoutes from './routes/admin';
import eventRoutes from './routes/events';
import { LiveBroker } from './realtime/broker';
export function buildApp() {
  const security = loadSecurity();
  const app = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: security.policy.trustProxy,
    bodyLimit: 16384,
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.decorate('realtime', new LiveBroker());
  app.register(websocket, { options: { maxPayload: 1024, perMessageDeflate: false } });
  app.register(cors, {
    origin: security.origin,
    credentials: true,
    methods: ['GET', 'POST'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.register(rateLimit, {
    max: (request) => (request.routeOptions.url?.startsWith('/api/auth/google') ? 20 : 120),
    timeWindow: '1 minute',
    keyGenerator: (request) => normalizeIP(request.ip, 64),
  });
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Request-Id', request.id)
      .header(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== security.origin
    )
      return reply.code(403).send({ error: 'Origin not allowed' });
  });
  app.register(cookie, { secret: security.cookieSecret });
  app.register(jwt, {
    secret: { private: security.privateKey, public: security.publicKey },
    sign: { algorithm: 'RS256', expiresIn: '8h', iss: '__APP_SLUG__', aud: '__APP_SLUG__-web' },
    verify: { algorithms: ['RS256'], allowedIss: '__APP_SLUG__', allowedAud: '__APP_SLUG__-web' },
    cookie: { cookieName: security.cookieName, signed: false },
  });
  const actions: Record<string, AuditAction> = {
    'GET /api/auth/me': 'auth.profile_viewed',
    'GET /api/auth/sessions': 'auth.sessions_listed',
    'GET /api/audit': 'audit.viewed',
  };
  app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode === 401)
      reply.clearCookie(security.cookieName, {
        path: '/',
        httpOnly: true,
        secure: security.secureCookies,
        sameSite: 'lax',
      });
    const action = actions[request.method + ' ' + request.routeOptions.url];
    if (action && request.auditActor && !request.auditRecorded) {
      try {
        await recordAudit(
          request,
          request.auditActor,
          action,
          reply.statusCode < 400 ? 'success' : 'denied',
          { statusCode: reply.statusCode },
        );
      } catch {
        reply.code(503).type('application/json');
        return JSON.stringify({
          error: 'Security history is unavailable.',
          code: 'audit_unavailable',
        });
      }
    }
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof SessionError
        ? 401
        : error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
          ? error.statusCode
          : 500;
    if (error instanceof AccountWriteLimitError) reply.header('Retry-After', error.retryAfter);
    if (status >= 500) request.log.error({ requestId: request.id }, 'Request failed');
    return reply.code(status).send({
      error:
        error instanceof PolicyError
          ? error.message
          : status === 401
            ? 'Sign in required'
            : status >= 500
              ? 'Service unavailable. Please try again.'
              : 'Invalid request',
      code: error instanceof PolicyError ? error.code : 'request_failed',
      requestId: request.id,
    });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'Endpoint not found' }),
  );
  app.register(authRoutes, { prefix: '/api', security });
  app.register(auditRoutes, { prefix: '/api', security });
  app.register(adminRoutes, { prefix: '/api', security });
  app.register(eventRoutes, { prefix: '/api', security });
  return app;
}
