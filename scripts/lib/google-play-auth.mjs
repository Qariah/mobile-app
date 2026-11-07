// @ai
//
// scripts/lib/google-play-auth.mjs
// --------------------------------
// One Google OAuth token helper for the Google Play APIs. Before this file,
// nine scripts each signed their own service-account JWT (TECH_DEBT #234).
//
// Two scopes are in use:
//   publisher — androidpublisher: edits, tracks, reviews, replies
//   reporting — playdeveloperreporting: crash and ANR rates, error issues
//
// Where the service account comes from, in this order:
//   1. `saFile` (or `--sa-file=`), a path. An explicit argument always wins.
//   2. GOOGLE_PLAY_SA_JSON — the JSON text. CI and the Claude Cloud routine use it.
//   3. GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — a path. A leading `~` means $HOME.
//   4. ~/.android/play-service-account.json — the documented default.
// This file never reads `.env.local`. The caller sources it.
//
// This file never prints, and never puts in an error message, the private key
// or the token. An error carries the HTTP status and the non-secret fields of
// Google's failure body.
//
// CLI, for shell callers (scripts/android-upload-play.sh):
//   node scripts/lib/google-play-auth.mjs --print-token --scope=publisher|reporting [--sa-file=PATH]
// It prints only the token on stdout. A failure goes to stderr with exit 1.

import {Buffer} from 'node:buffer';
import {createSign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const PLAY_SCOPES = {
  publisher: 'https://www.googleapis.com/auth/androidpublisher',
  reporting: 'https://www.googleapis.com/auth/playdeveloperreporting',
};

export const DEFAULT_TTL_SECONDS = 3600;

export class PlayAuthError extends Error {
  /**
   * @param {string} message
   * @param {{code:string, status?:number, detail?:string, bodyText?:string}} o
   *   code     — 'no-service-account' | 'invalid-service-account' |
   *              'bad-scope' | 'token-mint-failed'
   *   status   — the HTTP status of the token endpoint; 0 when no request ran
   *   detail   — a short non-secret reason: "<error> <error_description>", or
   *              "HTTP <status>" when Google sent neither field
   *   bodyText — the raw failure body of the token endpoint (never holds a token)
   */
  constructor(message, {code, status = 0, detail = '', bodyText = ''} = {}) {
    super(message);
    this.name = 'PlayAuthError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.bodyText = bodyText;
  }
}

/** Turn a scope alias (`publisher`, `reporting`) or a full scope URL into the URL. */
export function resolveScope(scope) {
  if (PLAY_SCOPES[scope]) return PLAY_SCOPES[scope];
  if (/^https:\/\/www\.googleapis\.com\/auth\/[\w.-]+$/.test(scope || ''))
    return scope;
  throw new PlayAuthError(
    `Unknown Google Play scope "${scope}". Use one of: ${Object.keys(PLAY_SCOPES).join(', ')}.`,
    {code: 'bad-scope'},
  );
}

function expandHome(p) {
  return p.replace(/^~(?=$|\/)/, homedir());
}

/**
 * The service-account file path that loadServiceAccount() reads when it reads a
 * file: the explicit `saFile`, else GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, else the
 * default. Does not look at GOOGLE_PLAY_SA_JSON.
 */
export function serviceAccountPath({saFile, env = process.env} = {}) {
  return expandHome(
    saFile ||
      env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ||
      join(homedir(), '.android', 'play-service-account.json'),
  );
}

function checkShape(sa, where) {
  if (
    !sa ||
    typeof sa !== 'object' ||
    typeof sa.client_email !== 'string' ||
    typeof sa.private_key !== 'string'
  )
    throw new PlayAuthError(
      `${where} is not a service-account key (client_email and private_key are required)`,
      {code: 'invalid-service-account'},
    );
  return sa;
}

/**
 * Load the service-account key. See the order at the top of this file.
 * @param {{saFile?:string, env?:object, readFile?:(p:string)=>string}} [o]
 * @returns {{client_email:string, private_key:string}}
 * @throws {PlayAuthError} 'no-service-account' when nothing is configured or
 *   the file is missing; 'invalid-service-account' when the JSON is bad
 */
export function loadServiceAccount({
  saFile,
  env = process.env,
  readFile = p => readFileSync(p, 'utf8'),
} = {}) {
  const inline = env.GOOGLE_PLAY_SA_JSON;
  if (!saFile && inline && inline.trim()) {
    let sa;
    try {
      sa = JSON.parse(inline);
    } catch (e) {
      // Never echo the raw value: it holds the private key.
      throw new PlayAuthError(
        `GOOGLE_PLAY_SA_JSON is set but is not valid JSON: ${e.message}`,
        {code: 'invalid-service-account'},
      );
    }
    return checkShape(sa, 'GOOGLE_PLAY_SA_JSON');
  }
  const path = serviceAccountPath({saFile, env});
  let text;
  try {
    text = readFile(path);
  } catch (e) {
    throw new PlayAuthError(
      `No service account: set GOOGLE_PLAY_SA_JSON (JSON string) or ` +
        `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (path), or place the file at ${path}. (${e.message})`,
      {
        code:
          e.code === 'ENOENT'
            ? 'no-service-account'
            : 'invalid-service-account',
      },
    );
  }
  let sa;
  try {
    sa = JSON.parse(text);
  } catch (e) {
    throw new PlayAuthError(
      `The service-account file ${path} is not valid JSON: ${e.message}`,
      {code: 'invalid-service-account'},
    );
  }
  return checkShape(sa, `The service-account file ${path}`);
}

const b64u = o =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString(
    'base64url',
  );

/**
 * Sign a JWT with the service account and exchange it for an access token.
 * @param {{client_email:string, private_key:string}} sa
 * @param {{scope:string, ttlSeconds?:number, fetchImpl?:typeof fetch,
 *   nowMs?:number, signal?:AbortSignal}} o
 *   scope — 'publisher', 'reporting' or a full scope URL
 * @returns {Promise<string>} the access token
 * @throws {PlayAuthError} 'token-mint-failed' when Google refuses the request.
 *   A network failure (fetch throws) propagates unchanged.
 */
export async function mintPlayToken(
  sa,
  {
    scope,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    fetchImpl = fetch,
    nowMs = Date.now(),
    signal,
  } = {},
) {
  const now = Math.floor(nowMs / 1000);
  const unsigned =
    b64u({alg: 'RS256', typ: 'JWT'}) +
    '.' +
    b64u({
      iss: sa.client_email,
      scope: resolveScope(scope),
      aud: TOKEN_URL,
      exp: now + ttlSeconds,
      iat: now,
    });
  const sig = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key)
    .toString('base64url');
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
    ...(signal ? {signal} : {}),
  });
  const bodyText = await res.text().catch(() => '');
  let tok = null;
  try {
    tok = JSON.parse(bodyText);
  } catch {
    /* not JSON: detail falls back to the HTTP status */
  }
  if (res.ok && tok && tok.access_token) return tok.access_token;
  const detail =
    tok && (tok.error_description || tok.error)
      ? `${tok.error || ''} ${tok.error_description || ''}`.trim()
      : `HTTP ${res.status}`;
  throw new PlayAuthError(`Play token mint failed (${detail})`, {
    code: 'token-mint-failed',
    status: res.status,
    detail,
    // A failure body never holds a token. Drop one anyway if a stub put it there.
    bodyText: tok && tok.access_token ? '' : bodyText,
  });
}

/**
 * Load the service account and mint a token in one call.
 * @param {{scope:string, saFile?:string, sa?:object, env?:object,
 *   ttlSeconds?:number, fetchImpl?:typeof fetch, signal?:AbortSignal}} o
 *   sa — a service-account object you loaded already; it wins over saFile and env
 */
export async function getPlayAccessToken({scope, sa, saFile, env, ...rest}) {
  resolveScope(scope); // fail on a bad scope before any file read
  return mintPlayToken(sa || loadServiceAccount({saFile, env}), {
    scope,
    ...rest,
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const USAGE =
  'usage: node scripts/lib/google-play-auth.mjs --print-token --scope=publisher|reporting [--sa-file=PATH]\n' +
  '  Prints one Google Play access token on stdout. Nothing else goes to stdout.\n' +
  '  Service account: --sa-file, else GOOGLE_PLAY_SA_JSON (JSON text), else\n' +
  '  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (path), else ~/.android/play-service-account.json.\n';

export async function main(
  argv,
  {stdout = process.stdout, stderr = process.stderr} = {},
) {
  const flag = name => {
    const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
    return hit === undefined ? undefined : hit.slice(name.length + 3) || true;
  };
  if (flag('help') || argv.includes('-h')) {
    stdout.write(USAGE);
    return 0;
  }
  if (!flag('print-token') || typeof flag('scope') !== 'string') {
    stderr.write(USAGE);
    return 2;
  }
  const saFile = flag('sa-file');
  try {
    const token = await getPlayAccessToken({
      scope: flag('scope'),
      saFile: typeof saFile === 'string' ? saFile : undefined,
    });
    stdout.write(`${token}\n`);
    return 0;
  } catch (e) {
    stderr.write(`google-play-auth: ${e.message}\n`);
    return e.code === 'bad-scope' ? 2 : 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
