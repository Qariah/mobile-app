#!/usr/bin/env node
// @ai
//
// scripts/sentry-hygiene.mjs
// --------------------------
// One-shot Sentry dashboard cleanup: resolve already-fixed issues and mute the
// best-effort-sync / dev-only noise cluster so the dashboard shows real signal.
//
// This is the WRITE-scoped companion to the read-only `sentry-triage.mjs`.
// It needs a token with `event:read` + `event:write` (the existing
// SENTRY_READ_TOKEN is read-only). Provide it as SENTRY_WRITE_TOKEN, OR add
// `event:write` to the existing token and it will be picked up via
// SENTRY_READ_TOKEN.
//
//   set -a && source .env.local && set +a
//   node scripts/sentry-hygiene.mjs --dry-run     # preview, change nothing
//   node scripts/sentry-hygiene.mjs               # apply
//
// The curated lists below reflect the 2026-06 triage (see
// planning/user-feedback-triage-2026-06.md). The app-side `beforeSend` filter
// added in app/_layout.tsx prevents the sync noise from recurring; this script
// clears the existing backlog. Safe + idempotent — re-running is a no-op.

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const TOKEN = process.env.SENTRY_WRITE_TOKEN || process.env.SENTRY_READ_TOKEN;
const ORG = process.env.SENTRY_ORG || 'qariah';
const PROJECT = process.env.SENTRY_PROJECT || 'qariahv2';
const HOST = (process.env.SENTRY_REGION_HOST || 'https://de.sentry.io').replace(
  /\/$/,
  '',
);

if (!TOKEN) {
  console.error('❌ Set SENTRY_WRITE_TOKEN (event:read + event:write).');
  process.exit(2);
}

// shortId → why. Each issue is matched to a live Sentry id at runtime.
const RESOLVE = {
  'QARIAHV2-A':
    '/posts/feed 403 — fixed by the client_credentials token switch (Sprint 27 post-close)',
  'QARIAHV2-B': '/posts/feed 403 — same cc-token fix',
  'QARIAHV2-6':
    "CommunityReflectionsSheet doesn't exist — resolved dev-only path (sprint-21)",
};
const IGNORE = {
  'QARIAHV2-7':
    'postsRestore best-effort sync (Network request failed) — now dropped at beforeSend',
  'QARIAHV2-8': 'postsRestore 403 — best-effort sync noise',
  'QARIAHV2-E': '502 on reflections feed — transient Cloudflare blip',
  'QARIAHV2-D': 'generic Network request failed — single transient event',
  'QARIAHV2-4': 'Metro dev-server asset 404 — local development only',
  'QARIAHV2-5':
    'iOS simulator-only SIGABRT (swift_abortRetainUnowned) — dev artifact, hard-rule #13',
};

async function sentry(path, init) {
  const res = await fetch(`${HOST}/api/0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `Sentry ${res.status} ${init?.method || 'GET'} ${path}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  console.log(
    `▶ sentry-hygiene  org=${ORG} project=${PROJECT}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  // Build a shortId → numeric id map across all statuses (14d covers the set).
  const idByShort = {};
  for (const q of ['is:unresolved', 'is:resolved', 'is:ignored']) {
    const list = await sentry(
      `/projects/${ORG}/${PROJECT}/issues/?statsPeriod=14d&query=${encodeURIComponent(q)}&limit=100`,
    );
    for (const i of list) idByShort[i.shortId] = {id: i.id, status: i.status};
  }

  const plan = [
    ...Object.entries(RESOLVE).map(([s, why]) => ['resolved', s, why]),
    ...Object.entries(IGNORE).map(([s, why]) => ['ignored', s, why]),
  ];

  let changed = 0;
  for (const [status, shortId, why] of plan) {
    const hit = idByShort[shortId];
    if (!hit) {
      console.log(`  · ${shortId} — not found in the last 14d (skip)`);
      continue;
    }
    if (hit.status === status) {
      console.log(`  · ${shortId} — already ${status} (skip)`);
      continue;
    }
    console.log(`  → ${shortId}: ${hit.status} → ${status}  (${why})`);
    if (!DRY_RUN) {
      await sentry(`/organizations/${ORG}/issues/${hit.id}/`, {
        method: 'PUT',
        body: JSON.stringify({status}),
      });
      changed++;
    }
  }

  console.log(
    `\n▶ done — ${DRY_RUN ? 'would change' : 'changed'} ${DRY_RUN ? plan.length : changed} issue(s).`,
  );
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
