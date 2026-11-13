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
//
// ascJwt() reads the environment only, so its caller sources `.env.local`. A
// caller that must work in a shell with no sourced `.env.local` (the Promoter's
// TestFlight step: the publish guard admits only the plain command) uses
// ascJwtFromSettings(), which finds the settings itself (ascKeySettings()).

import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** The names of the App Store Connect key settings. */
export const ASC_KEY_VARS = Object.freeze({
  keyId: 'APP_STORE_CONNECT_API_KEY_ID',
  issuer: 'APP_STORE_CONNECT_ISSUER_ID',
  p8B64: 'APP_STORE_CONNECT_API_KEY_P8_B64',
});

/**
 * The `.env.local` files that ascKeySettings() reads, in order: the checkout
 * that holds `fromDir`, then the main checkout. `.env.local` is not in git, so a
 * worktree that `git worktree add` made has no copy of it. Paths only: this
 * function reads no file.
 */
export function envLocalFiles(
  fromDir = dirname(fileURLToPath(import.meta.url)),
) {
  const out = [];
  const add = dir => {
    const p = join(dir, '.env.local');
    if (!out.includes(p)) out.push(p);
  };
  const git = args => {
    try {
      return execFileSync('git', ['-C', fromDir, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const top = git(['rev-parse', '--show-toplevel']);
  // Not a git checkout: this file is <root>/scripts/lib/asc-client.mjs.
  add(top || resolve(fromDir, '..', '..'));
  const common = git([
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  if (common) add(dirname(common));
  return out;
}

/**
 * The values of `names` in the text of an env file. It reads the lines that
 * `set -a && . .env.local` reads: `NAME=value`, with an optional `export`,
 * optional quotes and an optional ` # comment`. The last line for a name wins,
 * as in the shell. An empty value counts as no value.
 */
export function readEnvText(text, names) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
    );
    if (!m || !names.includes(m[1])) continue;
    let raw = m[2];
    let quoted = raw.match(/^(["'])(.*)\1$/);
    if (!quoted) {
      raw = raw.replace(/\s+#.*$/, '');
      quoted = raw.match(/^(["'])(.*)\1$/);
    }
    const value = quoted ? quoted[2] : raw;
    if (value) out[m[1]] = value;
    else delete out[m[1]];
  }
  return out;
}

/**
 * The App Store Connect key settings, in the order of the "Portable paths" rule
 * (CLAUDE.md): each name from the environment, then from the first `.env.local`
 * in `files` that has it. The private key then comes from
 * APP_STORE_CONNECT_API_KEY_P8_B64 or the documented default
 * ~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8 (loadP8 below).
 *
 * → {keyId, issuer, p8B64, from, files}. `from` names the source of each
 * setting ('env' or a file path); it never holds a value.
 */
export function ascKeySettings({
  env = process.env,
  files = envLocalFiles(),
  read = p => readFileSync(p, 'utf8'),
} = {}) {
  const names = Object.values(ASC_KEY_VARS);
  const found = {};
  const from = {};
  for (const n of names) {
    if (env[n]) {
      found[n] = env[n];
      from[n] = 'env';
    }
  }
  for (const f of files) {
    if (names.every(n => found[n])) break;
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    const values = readEnvText(text, names);
    for (const n of names) {
      if (!found[n] && values[n]) {
        found[n] = values[n];
        from[n] = f;
      }
    }
  }
  return {
    keyId: found[ASC_KEY_VARS.keyId],
    issuer: found[ASC_KEY_VARS.issuer],
    p8B64: found[ASC_KEY_VARS.p8B64],
    from,
    files,
  };
}

/** ascJwt() with the settings that ascKeySettings() found. */
export function ascJwtFromSettings(settings = ascKeySettings()) {
  if (!settings.keyId || !settings.issuer) {
    // The file paths come first: a caller may cut a long message at 300 characters.
    throw new Error(
      `No App Store Connect key. Looked in: the environment, ${
        settings.files.join(', ') || '.env.local'
      }. ` +
        `Set ${ASC_KEY_VARS.keyId} and ${ASC_KEY_VARS.issuer} in one of them.`,
    );
  }
  return ascJwt({
    keyId: settings.keyId,
    issuer: settings.issuer,
    p8B64: settings.p8B64,
  });
}

const b64u = o =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString(
    'base64url',
  );

function loadP8(keyId, p8B64 = process.env.APP_STORE_CONNECT_API_KEY_P8_B64) {
  if (p8B64) {
    return Buffer.from(p8B64, 'base64').toString('utf8');
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

// A caller with its own key (scripts/signals/asc-reports-copy.mjs uses a
// Sales-role key) passes {keyId, issuer, p8B64}; everyone else uses the
// APP_STORE_CONNECT_* variables.
export function ascJwt({
  keyId = process.env.APP_STORE_CONNECT_API_KEY_ID,
  issuer = process.env.APP_STORE_CONNECT_ISSUER_ID,
  p8B64,
} = {}) {
  if (!keyId || !issuer) {
    throw new Error(
      'Set APP_STORE_CONNECT_API_KEY_ID and APP_STORE_CONNECT_ISSUER_ID.',
    );
  }
  const p8 = loadP8(keyId, p8B64 || process.env.APP_STORE_CONNECT_API_KEY_P8_B64);
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
// The bundleId filter also matches longer ids: the production bundle id
// returns the beta app (its id plus .beta) first. Match the bundle id exactly.
export async function resolveAppId(bundleId, jwt) {
  const body = await ascGet(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(
      bundleId,
    )}&fields[apps]=bundleId&limit=20`,
    jwt,
  );
  return (body.data || []).find(a => a.attributes?.bundleId === bundleId)?.id || null;
}
