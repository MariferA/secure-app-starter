function checkedUrl(value: string, label: string) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`${label} cannot contain credentials, query parameters, or fragments`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error(`${label} requires HTTPS outside localhost`);
  return url;
}

export function endpointConfig(env: Record<string, string | undefined>) {
  const frontend = checkedUrl(env.FRONTEND_URL || 'http://localhost:__WEB_PORT__', 'FRONTEND_URL');
  const api = checkedUrl(env.API_BASE_URL || 'http://localhost:__API_PORT__/api', 'API_BASE_URL');
  if (frontend.pathname !== '/') throw new Error('FRONTEND_URL must be an origin without a path');
  if (api.pathname.replace(/\/$/, '') !== '/api') throw new Error('API_BASE_URL must end in /api');
  if (frontend.protocol !== api.protocol)
    throw new Error('Frontend and API must use the same scheme to support secure session cookies');
  return {
    origin: frontend.origin,
    apiUrl: `${api.origin}/api`,
    secureCookies: api.protocol === 'https:',
  };
}
