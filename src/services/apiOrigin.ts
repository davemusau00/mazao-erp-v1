const configuredApiBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
if (configuredApiBase) {
  let parsed: URL;
  try { parsed = new URL(configuredApiBase); }
  catch { throw new Error('VITE_API_BASE_URL must be an absolute HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTP(S) origin without credentials, path, query, or fragment.');
  }
  const explicitlyAllowedLoopbackHttp = import.meta.env.VITE_API_ALLOW_HTTP_LOOPBACK === 'true'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (import.meta.env.PROD && parsed.protocol !== 'https:' && !explicitlyAllowedLoopbackHttp) {
    throw new Error('Production VITE_API_BASE_URL must use HTTPS.');
  }
}

export const API_BASE_URL = configuredApiBase ? new URL(configuredApiBase).origin : '';

export function apiRequestUrl(path: string): string {
  return `${API_BASE_URL}/api/v1${path}`;
}

export function resolveApiAssetUrl(source: string): string {
  return API_BASE_URL && source.startsWith('/api/v1/') ? `${API_BASE_URL}${source}` : source;
}

export function apiAssetUsesCredentials(source: string): boolean {
  if (!API_BASE_URL || !source.startsWith('/api/v1/') || typeof window === 'undefined') return false;
  return new URL(API_BASE_URL).origin !== window.location.origin;
}
