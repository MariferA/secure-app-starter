export function publicConfig(env, app) {
  const apiUrl = env.API_BASE_URL || 'http://localhost:__API_PORT__/api';
  const url = new URL(apiUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api' ||
    !/^[a-z0-9.[\]:-]+$/i.test(url.hostname) ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('API_BASE_URL must be an HTTP(S) origin followed by /api');
  return { name: app.name, slug: app.slug, apiUrl: url.href.replace(/\/$/, ''), description: app.description || 'A personal workspace built for your next idea.' };
}
