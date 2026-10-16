import { isIP } from 'node:net';

/** Validate before Fastify can listen; never include supplied secrets in errors. */
export function readRuntimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const production = environment.NODE_ENV === 'production';
  const allowedOrigins = (environment.APP_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (production && allowedOrigins.length === 0) throw new Error('APP_ORIGINS must contain the exact public application origin in production.');
  if (allowedOrigins.some(origin => { try { return new URL(origin).origin !== origin; } catch { return true; } })) {
    throw new Error('APP_ORIGINS entries must be exact origins such as https://erp.example.com.');
  }
  if (production && !/^[a-f0-9]{64}$/i.test(environment.CREDENTIAL_FINGERPRINT_KEY ?? '')) {
    throw new Error('CREDENTIAL_FINGERPRINT_KEY must be configured as exactly 64 hexadecimal characters in production.');
  }

  // Trust only explicitly verified ingress socket addresses, never arbitrary
  // private networks or a client-supplied forwarding header on its own.
  const proxySetting = environment.TRUSTED_PROXY_IPS?.trim() ?? '';
  const trustedProxyIps = proxySetting ? proxySetting.split(',').map(value => value.trim().toLowerCase()) : [];
  if (trustedProxyIps.length > 16 || trustedProxyIps.some(address => !isIP(address))) {
    throw new Error('TRUSTED_PROXY_IPS must contain at most 16 comma-separated literal ingress IP addresses; CIDRs and blanket trust are not supported.');
  }
  return { production, allowedOrigins, trustedProxyIps };
}
