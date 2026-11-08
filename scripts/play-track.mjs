#!/usr/bin/env node
// @ai
//
// scripts/play-track.mjs — read one Google Play track. Read only: it opens an
// edit, reads the track, and deletes the edit, so it never commits.
//
//   node scripts/play-track.mjs beta
//
// The track is a plain word and not `--track=`, because the publish guard denies a
// command with `--track=beta`.
//
// Exit 0 = printed, 1 = an API error, 2 = usage error.

import {ANDROID_PACKAGE_NAME} from './lib/app-ids.mjs';
import {getPlayAccessToken} from './lib/google-play-auth.mjs';

const m = process.argv
  .slice(2)
  .join(' ')
  .match(/^(internal|alpha|beta|production)$/);
if (m) m[1] = m[0];
if (!m) {
  console.error('usage: play-track.mjs <internal|alpha|beta|production>');
  process.exit(2);
}
const BASE = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}`;

async function main() {
  const token = await getPlayAccessToken({scope: 'publisher'});
  const call = async (method, path) => {
    const r = await fetch(`${BASE}/${path}`, {
      method,
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!r.ok)
      throw new Error(`Play ${r.status} on ${method} ${path.split('/').pop()}`);
    return method === 'DELETE' ? null : r.json();
  };
  const edit = await call('POST', 'edits');
  try {
    const track = await call('GET', `edits/${edit.id}/tracks/${m[1]}`);
    for (const rel of track.releases || []) {
      console.log(
        JSON.stringify({
          track: m[1],
          versionCodes: rel.versionCodes,
          status: rel.status,
          userFraction: rel.userFraction ?? null,
          name: rel.name,
        }),
      );
    }
  } finally {
    await call('DELETE', `edits/${edit.id}`).catch(() => null);
  }
}

main().catch(e => {
  console.error(`❌ ${String(e.message || e).slice(0, 300)}`);
  process.exit(1);
});
