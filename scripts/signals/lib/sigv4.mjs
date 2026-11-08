// @ai
//
// scripts/signals/lib/sigv4.mjs
// -----------------------------
// A small AWS Signature Version 4 signer and one JSON put to the private
// signals bucket (the S3 API on Cloudflare R2), with node:crypto and fetch only.
//
// Why not scripts/signals/lib/bucket.mjs: that module needs the AWS SDK, so a
// job must run `npm ci` first (about 3 minutes). scripts/pipeline-status.mjs
// runs after each Daily card comment, so its workflow installs nothing.
//
//   await putSignalsJson('pipeline/status.json', obj, process.env);
// The name, the account and the key come from SIGNALS_R2_* only (bucket.mjs,
// BUCKET_ENV); no doc or log holds them.
// The repo's eslint config declares no Node globals; Buffer is a Node builtin.
/* global Buffer */

import {createHash, createHmac} from 'node:crypto';
import {missingBucketEnv} from './bucket.mjs';

const sha256hex = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** S3 URI encoding of a key: each byte except A-Z a-z 0-9 - _ . ~ and `/`. */
export function encodeKey(key) {
  return String(key)
    .split('/')
    .map(seg =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

/**
 * The Authorization header of one request (no query string).
 * @param {object} o
 * @param {string} o.method
 * @param {string} o.path  the encoded path, with a leading `/`
 * @param {Record<string,string>} o.headers  every header to sign, host and x-amz-date included
 * @param {string} o.payloadHash  hex SHA-256 of the body
 * @param {string} o.accessKeyId
 * @param {string} o.secretAccessKey
 * @param {string} o.region
 * @param {string} [o.service]
 * @returns {{authorization: string, signature: string, signedHeaders: string}}
 */
export function signV4({
  method,
  path,
  headers,
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region,
  service = 's3',
}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k.toLowerCase(),
      String(v).trim().replace(/\s+/g, ' '),
    ]),
  );
  const names = Object.keys(lower).sort();
  const signedHeaders = names.join(';');
  const amzDate = lower['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const canonical = [
    method,
    path,
    '',
    names.map(n => `${n}:${lower[n]}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonical),
  ].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signature,
    signedHeaders,
  };
}

const amzDateOf = d =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/**
 * PUT one JSON object in the signals bucket. Throws on a non-2xx answer;
 * the message holds the status only, never the host or the key.
 */
export async function putSignalsJson(
  key,
  obj,
  env = process.env,
  {fetchImpl = fetch, now = new Date()} = {},
) {
  const missing = missingBucketEnv(env);
  if (missing.length)
    throw new Error(`a SIGNALS_R2_* key is missing (${missing.join(', ')})`);
  const body = JSON.stringify(obj);
  const host = `${env.SIGNALS_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/${encodeKey(env.SIGNALS_R2_BUCKET)}/${encodeKey(key)}`;
  const payloadHash = sha256hex(body);
  const headers = {
    'content-type': 'application/json',
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDateOf(now),
  };
  const {authorization} = signV4({
    method: 'PUT',
    path,
    headers,
    payloadHash,
    accessKeyId: env.SIGNALS_R2_ACCESS_KEY_ID,
    secretAccessKey: env.SIGNALS_R2_SECRET_ACCESS_KEY,
    region: 'auto',
  });
  const send = {...headers};
  delete send.host; // fetch sets it
  const res = await fetchImpl(`https://${host}${path}`, {
    method: 'PUT',
    headers: {...send, authorization},
    body,
  });
  if (!res.ok) throw new Error(`the bucket answered ${res.status} to a put`);
  return {status: res.status, bytes: Buffer.byteLength(body)};
}
