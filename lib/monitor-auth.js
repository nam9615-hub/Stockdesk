import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
export const MONITOR_AUDIENCE = 'stockdesk-paper-monitor';
const DEFAULT_REPOSITORY = 'nam9615-hub/Stockdesk';
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { expiresAt: 0, keys: [] };

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function audienceIncludes(aud, expected) {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

export function validateMonitorClaims(payload, now = Math.floor(Date.now() / 1000), repository = DEFAULT_REPOSITORY) {
  if (!payload || payload.iss !== ISSUER) return false;
  if (!audienceIncludes(payload.aud, MONITOR_AUDIENCE)) return false;
  if (payload.repository !== repository || payload.ref !== 'refs/heads/main') return false;
  if (!['schedule', 'workflow_dispatch', 'push'].includes(payload.event_name)) return false;
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return false;
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 30) return false;
  if (Number.isFinite(payload.iat) && payload.iat > now + 30) return false;
  return true;
}

async function githubJwks() {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetch(`${ISSUER}/.well-known/jwks`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`GitHub OIDC JWKS ${response.status}`);
  const json = await response.json();
  jwksCache = { expiresAt: Date.now() + JWKS_TTL_MS, keys: Array.isArray(json.keys) ? json.keys : [] };
  return jwksCache.keys;
}

export async function githubActionsAuthorized(req) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token === req.headers?.authorization) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== 'RS256' || !header.kid || !validateMonitorClaims(payload, undefined, process.env.GH_REPO || DEFAULT_REPOSITORY)) return false;
    const key = (await githubJwks()).find((item) => item.kid === header.kid && item.kty === 'RSA');
    if (!key) return false;
    return verifySignature(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
  } catch {
    return false;
  }
}
