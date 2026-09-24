#!/usr/bin/env node
// @ai
//
// scripts/appstore-reviews-triage.mjs
// -----------------------------------
// App Store customer-reviews → GitHub issue triage for Qariah v2 (iOS).
//
// Pulls the most recent App Store customer reviews via the App Store Connect
// API and files a deduplicated GitHub issue for each one that reads like a USER
// ISSUE — a low-star review with text, or any review with an explicit feature
// ask. Pure praise (4–5★ with no ask) is ignored. File-only: root-causing is
// the local /loop's job, not this bot's.
//
// Auth: the same ASC API key the release pipeline uses (see lib/asc-client.mjs).
//
// Run:
//   set -a && source .env.local && set +a   # ASC key id/issuer (+ local .p8)
//   node scripts/appstore-reviews-triage.mjs --dry-run     # preview, files nothing
//   node scripts/appstore-reviews-triage.mjs               # file issues
//
// Flags: --dry-run, --max=15 (cap per run), --help
// Env:   ASC_APP_ID (default 1594917787 = com.qariah.app, the released app)

import {ascJwt, ascGet} from './lib/asc-client.mjs';
import {
  existingMarkers,
  fileIssues,
  emitOutput,
  parseArgs,
  ghTitle,
  firstWords,
  looksLikeFeatureRequest,
  severityForRating,
  gh,
  GH_REPO,
} from './lib/triage-common.mjs';

const args = parseArgs(process.argv);
// One-shot maintenance flag (not part of the normal collector run): close the
// known v1-phantom issues with a v1-attribution comment. Phase-5 cleanup runs
// this; the daily workflow never does.
const CLOSE_V1_PHANTOMS = process.argv.includes('--close-v1-phantoms');
if (args.help) {
  console.log(
    [
      'Usage: node scripts/appstore-reviews-triage.mjs [--dry-run] [--max=15]',
      '       node scripts/appstore-reviews-triage.mjs --close-v1-phantoms [--dry-run]',
      '',
      'The lane is PAUSED until v2 is public on the App Store (every current App',
      'Store review is of the v1 Flutter build). --close-v1-phantoms closes the',
      'known v1-phantom issues (#99/#111/#114) as v1, not v2, bugs.',
    ].join('\n'),
  );
  process.exit(0);
}

const APP_ID = process.env.ASC_APP_ID || '1594917787';
const MARKER = 'appstore-review-id:';
const LABEL = 'app-store';
const REVIEWS_URL = `https://appstoreconnect.apple.com/apps/${APP_ID}/distribution/reviews`;

// The known v1-phantom issues — App Store reviews of the v1 Flutter build that
// the lane filed as v2 bugs before the pause sentinel was added. Confirmed v1
// by their review dates (2025-03 / 2026-02 / 2026-03, all pre-v2-public) and
// content (e.g. #114 "Zaynab Talha surah removed" is a 2025-03-03 v1 review).
// Closed by --close-v1-phantoms.
const V1_PHANTOM_ISSUES = [
  {
    n: 99,
    why: 'a 2026-03 review of the v1 (Flutter) App Store build ("Couldn’t get it to work")',
  },
  {
    n: 111,
    why: 'a 2026-02 review of the v1 (Flutter) App Store build ("Blank app")',
  },
  {
    n: 114,
    why: 'a 2025-03-03 review of the v1 (Flutter) App Store build ("Zaynab Talha surah removed")',
  },
];

// Legacy-v1 guard. The public App Store build of com.qariah.app is still
// Qariah v1 (Flutter); v2 (the codebase in THIS repo) has only ever shipped to
// TestFlight, with 4.0.0 pending public release. So every App Store *review*
// today is a review of v1 — filing them as v2 issues manufactures phantom bugs
// (#99/#111/#114 + #118/#121/#124/#126/#127 were all v1-era reviews mis-filed
// against v2). The customerReviews API carries NO app-version field (verified:
// only rating/title/body/nickname/createdDate/territory), so a createdDate
// cutoff is the only attribution lever available — there is no per-review build
// to gate on. Mirrors the Play-vitals lane's versionCode<500 legacy filter.
//
// The default FAR-FUTURE sentinel PAUSES the lane until v2 is public — set
// V2_APPSTORE_LAUNCH_DATE (ISO date) to 4.0.0's App Store release date to
// resume. Reviews before that date stay v1-attributed forever. A robust
// far-future check (year >= 2099) treats any sentinel-ish value as "paused".
const V2_APPSTORE_LAUNCH_DATE =
  process.env.V2_APPSTORE_LAUNCH_DATE || '2099-01-01';
const LANE_PAUSED =
  !Number.isFinite(Date.parse(V2_APPSTORE_LAUNCH_DATE)) ||
  new Date(V2_APPSTORE_LAUNCH_DATE).getUTCFullYear() >= 2099;

function classify(rating, title, body) {
  const text = `${title || ''} ${body || ''}`.trim();
  const hasText = text.length > 0;
  const feature = looksLikeFeatureRequest(text);
  // File rule: any low-star (≤3) review with text, OR any rating with an
  // explicit feature ask. 4–5★ pure praise is skipped.
  const file = hasText && (rating <= 3 || feature);
  return {file, feature, severity: severityForRating(rating)};
}

function fmtBody({
  id,
  rating,
  title,
  body,
  nickname,
  territory,
  created,
  severity,
  feature,
}) {
  return `**App Store customer review** — auto-filed by \`appstore-reviews-triage\`.

- **Rating:** ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)
- **Territory:** ${territory || 'unknown'}
- **Reviewer:** ${nickname || 'anonymous'}
- **Date:** ${created || 'unknown'}
- **Type:** ${
    feature ? 'feature request' : 'problem report'
  }  ·  **Severity:** ${severity}

> ${title ? `**${title}**\n> \n> ` : ''}${(body || '(no text)').replace(
    /\n/g,
    '\n> ',
  )}

### Triage
- [ ] Confirm whether this is a real bug, a UX gap, or a feature ask
- [ ] Reproduce on a release build / link any matching Sentry or TestFlight signal
- [ ] Reply in App Store Connect if a response helps the user
- [ ] Fix (or convert to a tracked enhancement), then resolve

[Open in App Store Connect → Ratings & Reviews](${REVIEWS_URL})

<!-- ${MARKER}${id} -->`;
}

// One-shot: close the known v1-phantom issues with a v1-attribution comment.
// Only touches issues that are currently OPEN (idempotent on re-run).
function closeV1Phantoms() {
  console.log(
    `▶ appstore-reviews --close-v1-phantoms${args.dryRun ? '  (DRY RUN)' : ''}`,
  );
  let openNums = new Set();
  try {
    const open = JSON.parse(
      gh([
        'issue',
        'list',
        '--repo',
        GH_REPO,
        '--label',
        LABEL,
        '--state',
        'open',
        '--limit',
        '200',
        '--json',
        'number',
      ]),
    );
    openNums = new Set(open.map(o => o.number));
  } catch (e) {
    console.warn(`  ⚠ could not list open app-store issues: ${e.message}`);
  }
  let closed = 0;
  for (const {n, why} of V1_PHANTOM_ISSUES) {
    if (!openNums.has(n)) {
      console.log(`  · #${n} not open (already closed / not found) — skip`);
      continue;
    }
    const reason =
      `Closing as a **v1 phantom**: this issue was auto-filed from ${why}. The ` +
      `public App Store build of \`com.qariah.app\` is still Qariah **v1 (Flutter)**; ` +
      `v2 (this repo) is TestFlight-only, so this review is NOT a v2 bug. The ` +
      `App Store reviews lane is now paused until v2 is public. Reopen only if the ` +
      `same complaint surfaces against a v2 build (TestFlight feedback / a v2 App Store review).`;
    console.log(
      `  ${args.dryRun ? 'WOULD close' : 'close'} #${n} — v1 phantom`,
    );
    if (!args.dryRun) {
      gh(['issue', 'comment', String(n), '--repo', GH_REPO, '--body', reason]);
      gh([
        'issue',
        'close',
        String(n),
        '--repo',
        GH_REPO,
        '--reason',
        'not planned',
      ]);
    }
    closed++;
  }
  console.log(
    `\n▶ done — ${args.dryRun ? 'would close' : 'closed'} ${closed} v1-phantom issue(s).`,
  );
}

async function main() {
  if (CLOSE_V1_PHANTOMS) {
    closeV1Phantoms();
    return;
  }
  console.log(
    `▶ appstore-reviews  app=${APP_ID} max=${args.max}${
      args.dryRun ? '  (DRY RUN)' : ''
    }`,
  );

  // Hard pause while v2 is not public — every App Store review is v1. Don't even
  // hit the ASC API (saves a call + makes the pause unmistakable).
  if (LANE_PAUSED) {
    console.log(
      '  ⚠ lane PAUSED — v2 is not yet public on the App Store, so every App Store review is\n' +
        '    legacy v1 (the customerReviews API exposes no per-review app-version to gate on).\n' +
        '    Set V2_APPSTORE_LAUNCH_DATE to 4.0.0’s release date to resume filing.\n' +
        '    To close the known v1 phantoms (#99/#111/#114): --close-v1-phantoms',
    );
    emitOutput({filed: 0, fresh: 0, deferred: 0, dryRun: args.dryRun});
    return;
  }

  const jwt = ascJwt();

  // Most-recent reviews (one page of 100 is ample for a twice-daily cadence).
  const resp = await ascGet(
    `/v1/apps/${APP_ID}/customerReviews?limit=100&sort=-createdDate` +
      `&fields[customerReviews]=rating,title,body,reviewerNickname,createdDate,territory`,
    jwt,
  );
  const reviews = resp.data || [];
  console.log(`  fetched: ${reviews.length} recent review(s)`);

  // Lane is active (v2 is public). Still skip any review created before the
  // launch date — those are v1, the only attribution lever this API gives us.
  const cutoff = Date.parse(V2_APPSTORE_LAUNCH_DATE);
  console.log(
    `  v1/v2 cutoff: skipping reviews before ${V2_APPSTORE_LAUNCH_DATE}`,
  );

  const already = existingMarkers(LABEL, MARKER, {dryRun: args.dryRun});
  console.log(`  already filed: ${already.size}`);

  const candidates = [];
  let skippedV1 = 0;
  for (const r of reviews) {
    const a = r.attributes || {};
    // Legacy-v1 date guard — drop reviews of the pre-v2 public App Store app.
    const created = Date.parse(a.createdDate || '');
    if (
      Number.isFinite(cutoff) &&
      Number.isFinite(created) &&
      created < cutoff
    ) {
      skippedV1++;
      continue;
    }
    const rating = Number(a.rating) || 0;
    const c = classify(rating, a.title, a.body);
    if (!c.file) continue;
    if (already.has(r.id)) continue;
    candidates.push({
      id: r.id,
      rating,
      title: a.title,
      body: a.body,
      nickname: a.reviewerNickname,
      territory: a.territory,
      created: a.createdDate,
      ...c,
    });
  }
  // Worst ratings first.
  candidates.sort((x, y) => x.rating - y.rating);
  const fresh = candidates.length;
  const toFile = candidates.slice(0, args.max);
  const deferred = fresh - toFile.length;
  console.log(
    `  new user-issue reviews: ${fresh}${
      deferred > 0 ? ` (capping at ${args.max}, +${deferred} next run)` : ''
    }${skippedV1 > 0 ? `  ·  skipped ${skippedV1} legacy-v1 review(s)` : ''}`,
  );

  const items = toFile.map(c => ({
    id: c.id,
    title: ghTitle(
      `[App Store ★${c.rating}] ${c.title || firstWords(c.body)}${
        c.territory ? ` (${c.territory})` : ''
      }`,
    ),
    labels: [
      'app-store',
      'user-review',
      c.feature ? 'enhancement' : 'bug',
      `severity:${c.severity}`,
      'ios',
    ],
    body: fmtBody(c),
  }));

  const filed = fileIssues(items, {dryRun: args.dryRun});
  console.log(
    `\n▶ done — ${reviews.length} fetched, ${fresh} new, ${
      args.dryRun ? 'would file' : 'filed'
    } ${filed}${deferred > 0 ? ` (+${deferred} deferred)` : ''}.`,
  );
  emitOutput({filed, fresh, deferred, dryRun: args.dryRun});
}

main().catch(e => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
