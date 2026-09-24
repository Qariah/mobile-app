// @ai
//
// scripts/lib/asc-client.mjs
// --------------------------
// Minimal App Store Connect API client (ES256 JWT, no deps) shared by the iOS
// user-voice lanes: appstore-reviews-triage + testflight-feedback-triage.
//
// Auth (read-only use here):
//   CI    — APP_STORE_CONNECT_API_KEY_ID + _ISSUER_ID + _API_KEY_P8_B64 (base64 of the .p8)
//   local — APP_STORE_CONNECT_API_KEY_ID + _ISSUER_ID + the .p8 file at
//           ~/.appstoreconnect/private_keys/AuthKey_<id>.p8
//
// The JWT is signed locally and short-lived (10 min); the private key and the
// token are never logged. The same key the release pipeline uses for altool
// uploads also reads customerReviews + betaFeedback*Submissions (App Manager
// role) — no extra credential.

import {Buffer} from 'node:buffer';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';

const b64u = o =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString(
    'base64url',
  );

function loadP8(keyId) {
  if (process.env.APP_STORE_CONNECT_API_KEY_P8_B64) {
    return Buffer.from(
      process.env.APP_STORE_CONNECT_API_KEY_P8_B64,
      'base64',
    ).toString('utf8');
  }
  const p = `${homedir()}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    throw new Error(
      `No ASC private key: set APP_STORE_CONNECT_API_KEY_P8_B64 (base64 of the .p8) ` +
        `or place the key at ${p}.`,
    );
  }
}

export function ascJwt() {
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const issuer = process.env.APP_STORE_CONNECT_ISSUER_ID;
  if (!keyId || !issuer) {
    throw new Error(
      'Set APP_STORE_CONNECT_API_KEY_ID and APP_STORE_CONNECT_ISSUER_ID.',
    );
  }
  const p8 = loadP8(keyId);
  const now = Math.floor(Date.now() / 1000);
  const header = b64u({alg: 'ES256', kid: keyId, typ: 'JWT'});
  const payload = b64u({
    iss: issuer,
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  });
  const sig = crypto
    .createSign('SHA256')
    .update(`${header}.${payload}`)
    .sign({key: p8, dsaEncoding: 'ieee-p1363'})
    .toString('base64url');
  return `${header}.${payload}.${sig}`;
}

export async function ascGet(path, jwt) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: {Authorization: `Bearer ${jwt}`},
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      body.errors?.[0]?.detail || body.errors?.[0]?.title || `HTTP ${r.status}`;
    throw new Error(
      `ASC ${r.status} on ${path.split('?')[0]}: ${String(msg).slice(0, 300)}`,
    );
  }
  return body;
}

// POST a JSON:API document. Used by scripts/review-reply.mjs to create a
// customerReviewResponse (the developer reply under an App Store review).
export async function ascPost(path, data, jwt) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      body.errors?.[0]?.detail || body.errors?.[0]?.title || `HTTP ${r.status}`;
    throw new Error(
      `ASC ${r.status} on POST ${path}: ${String(msg).slice(0, 300)}`,
    );
  }
  return body;
}

// Resolve the numeric ASC app id for a bundle id (cached by the caller if needed).
export async function resolveAppId(bundleId, jwt) {
  const body = await ascGet(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(
      bundleId,
    )}&fields[apps]=bundleId&limit=1`,
    jwt,
  );
  return body.data?.[0]?.id || null;
}
