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
// It prints two things:
//   1. the track as an edit sees it (what the developer asked for), and
//   2. the review state of each release (what Google Play serves): a line with
//      `lifecycle`. A release that is not PUBLISHED is not live, whatever the
//      track says (scripts/lib/play-release-state.mjs has the 2026-11 case).
//
// Exit 0 = printed, 1 = an API error, 2 = usage error, 3 = printed, and a
// release waits for the owner (APPROVED_NOT_PUBLISHED or NOT_APPROVED): the
// last lines start with `OWNER ACTION`.

// The repo's eslint config declares no Node globals; this is a Node 18+ builtin.
/* global AbortSignal */

import {ANDROID_PACKAGE_NAME} from './lib/app-ids.mjs';
import {getPlayAccessToken} from './lib/google-play-auth.mjs';
import {needsOwner, releaseStates} from './lib/play-release-state.mjs';

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
      // A hung request must end as an API error (exit 1), not as a hung run.
      signal: AbortSignal.timeout(30_000),
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
  // What Google Play serves. A failure here is an API error (exit 1): a
  // caller must never read "no lifecycle line" as "live".
  const rows = releaseStates(await call('GET', `tracks/${m[1]}/releases`));
  for (const r of rows) {
    console.log(
      JSON.stringify({
        track: m[1],
        release: r.name,
        versionCodes: r.versionCodes,
        lifecycle: r.state,
        live: r.live,
      }),
    );
  }
  for (const r of rows) {
    if (r.ownerAction) {
      console.log(`OWNER ACTION (${m[1]} release ${r.name}): ${r.ownerAction}`);
    }
  }
  if (needsOwner(rows)) process.exitCode = 3;
}

main().catch(e => {
  console.error(`❌ ${String(e.message || e).slice(0, 300)}`);
  process.exit(1);
});
