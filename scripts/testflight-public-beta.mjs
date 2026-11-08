#!/usr/bin/env node
// @ai
//
// scripts/testflight-public-beta.mjs — put an uploaded build in front of the
// TestFlight group "Public Beta".
// ---------------------------------------------------------------------------
// An upload with `ios-archive.sh --upload --public-beta` reaches App Store
// Connect only. External testers get the build after three more steps: the
// "What to Test" text, the group, and Beta App Review. Until 2026-11-01 a session
// did these by hand. The Promoter needs a command, and the publish guard needs a
// name to police.
//
//   node scripts/testflight-public-beta.mjs --build=3790
//       read only: the build state, its groups, its review state.
//   node scripts/testflight-public-beta.mjs --build=3790 --wait-minutes=45
//       read only: waits until Apple has processed the build. Exit 1 when it has not.
//   node scripts/testflight-public-beta.mjs --build=3790 --apply [--whats-new-file=<path>]
//       does the three steps, then reads the state back. Each step is skipped
//       when it is already done, so a second run after a failure is safe.
//   node scripts/testflight-public-beta.mjs --train=3.2.3
//       read only: can TestFlight still take builds of this marketing version?
//
// Env: APP_STORE_CONNECT_API_KEY_ID, APP_STORE_CONNECT_ISSUER_ID (.env.local).
// Exit 0 = done, 1 = an API error or the build is not ready, 2 = usage error.

import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {IOS_BUNDLE_ID} from './lib/app-ids.mjs';
import {ascGet, ascJwt, ascPost, resolveAppId} from './lib/asc-client.mjs';

const BUNDLE_ID = IOS_BUNDLE_ID;
const GROUP = 'Public Beta';
const API = 'https://api.appstoreconnect.apple.com';

// App Store versions in these states do not close the TestFlight train. Apple
// closes a train when it approves the version.
const OPEN_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
  'DEVELOPER_REJECTED',
]);

/** @returns {boolean} true when TestFlight cannot take more builds of this version. */
export const trainClosed = state => Boolean(state) && !OPEN_STATES.has(state);

async function ascPatch(path, data, jwt) {
  const r = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`ASC ${r.status} on PATCH ${path.split('?')[0]}`);
}

export async function trainState(version, jwt) {
  const appId = await resolveAppId(BUNDLE_ID, jwt);
  const res = await ascGet(
    `/v1/apps/${appId}/appStoreVersions?filter[versionString]=${encodeURIComponent(version)}&filter[platform]=IOS&limit=1`,
    jwt,
  );
  const state = res.data?.[0]?.attributes?.appStoreState || null;
  return {version, state, closed: trainClosed(state)};
}

/** The highest build number on the app record (public beta and production share it). */
export async function latestBuildNumber(jwt) {
  const appId = await resolveAppId(BUNDLE_ID, jwt);
  const res = await ascGet(
    `/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=20&fields[builds]=version`,
    jwt,
  );
  return Math.max(
    0,
    ...(res.data || []).map(b => Number(b.attributes?.version) || 0),
  );
}

async function readState(build, jwt) {
  const appId = await resolveAppId(BUNDLE_ID, jwt);
  if (!appId) throw new Error(`no app for ${BUNDLE_ID}`);
  const builds = await ascGet(
    `/v1/builds?filter[app]=${appId}&filter[version]=${build}&limit=1&include=preReleaseVersion`,
    jwt,
  );
  const b = builds.data?.[0];
  if (!b) return {appId, found: false};
  // /v1/builds/{id}/betaGroups answers empty for a build in a group: use include.
  const withGroups = await ascGet(`/v1/builds/${b.id}?include=betaGroups`, jwt);
  const review = await ascGet(
    `/v1/builds/${b.id}/betaAppReviewSubmission`,
    jwt,
  ).catch(() => ({data: null}));
  const loc = await ascGet(
    `/v1/builds/${b.id}/betaBuildLocalizations?limit=10`,
    jwt,
  );
  return {
    appId,
    found: true,
    id: b.id,
    processing: b.attributes?.processingState,
    expired: b.attributes?.expired,
    groups: (withGroups.included || [])
      .filter(g => g.type === 'betaGroups')
      .map(g => g.attributes?.name),
    review: review.data?.attributes?.betaReviewState || null,
    whatsNew: loc.data?.[0]?.attributes?.whatsNew || null,
    localizationId: loc.data?.[0]?.id || null,
  };
}

async function apply(build, whatsNew, jwt) {
  const s = await readState(build, jwt);
  if (!s.found)
    throw new Error(`build ${build} is not on App Store Connect yet`);
  if (s.processing !== 'VALID')
    throw new Error(
      `build ${build} is ${s.processing}, not VALID. Run again later.`,
    );

  if (whatsNew && s.whatsNew !== whatsNew) {
    if (s.localizationId) {
      await ascPatch(
        `/v1/betaBuildLocalizations/${s.localizationId}`,
        {
          data: {
            type: 'betaBuildLocalizations',
            id: s.localizationId,
            attributes: {whatsNew},
          },
        },
        jwt,
      );
    } else {
      await ascPost(
        '/v1/betaBuildLocalizations',
        {
          data: {
            type: 'betaBuildLocalizations',
            attributes: {locale: 'en-US', whatsNew},
            relationships: {build: {data: {type: 'builds', id: s.id}}},
          },
        },
        jwt,
      );
    }
    console.log('  What to Test: set');
  }

  if (!s.groups.includes(GROUP)) {
    const g = await ascGet(
      `/v1/apps/${s.appId}/betaGroups?filter[name]=${encodeURIComponent(GROUP)}&limit=5`,
      jwt,
    );
    const group = (g.data || []).find(x => x.attributes?.name === GROUP);
    if (!group) throw new Error(`no TestFlight group "${GROUP}"`);
    const r = await fetch(
      `${API}/v1/betaGroups/${group.id}/relationships/builds`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({data: [{type: 'builds', id: s.id}]}),
      },
    );
    if (!r.ok)
      throw new Error(`ASC ${r.status} when it added the build to "${GROUP}"`);
    console.log(`  group "${GROUP}": added`);
  }

  if (!s.review) {
    await ascPost(
      '/v1/betaAppReviewSubmissions',
      {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: {build: {data: {type: 'builds', id: s.id}}},
        },
      },
      jwt,
    );
    console.log('  Beta App Review: submitted');
  }
}

async function main() {
  const flags = Object.fromEntries(
    process.argv
      .slice(2)
      .map(a => a.match(/^--([^=]+)(?:=(.*))?$/))
      .filter(Boolean)
      .map(m => [m[1], m[2] ?? true]),
  );
  const jwt = ascJwt();
  if (typeof flags.train === 'string') {
    console.log(JSON.stringify(await trainState(flags.train, jwt)));
    return;
  }
  if (!/^\d+$/.test(String(flags.build))) {
    console.error(
      'usage: testflight-public-beta.mjs --build=<n> [--wait-minutes=<m>] [--apply] [--whats-new-file=<path>] | --train=<version>',
    );
    process.exit(2);
  }
  if (flags['wait-minutes']) {
    const end = Date.now() + Number(flags['wait-minutes']) * 60000;
    for (;;) {
      const s = await readState(flags.build, ascJwt());
      if (s.found && s.processing === 'VALID') break;
      if (Date.now() > end) {
        console.error(
          `build ${flags.build} is ${s.found ? s.processing : 'not on App Store Connect'} after the wait`,
        );
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 60000));
    }
  }
  if (flags.apply) {
    const text =
      typeof flags['whats-new-file'] === 'string'
        ? readFileSync(flags['whats-new-file'], 'utf8').trim()
        : null;
    await apply(flags.build, text, jwt);
  }
  const s = await readState(flags.build, jwt);
  const shown = {...s};
  for (const k of ['appId', 'id', 'localizationId']) delete shown[k];
  console.log(JSON.stringify(shown));
  if (flags.apply && (!s.groups.includes(GROUP) || !s.review)) {
    console.error('the read back does not show the group and the review');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => {
    console.error(`❌ ${String(e.message || e).slice(0, 300)}`);
    process.exit(1);
  });
}
