#!/usr/bin/env node
// @ai
//
// scripts/play-reviews-triage.mjs
// -------------------------------
// Google Play reviews → GitHub issue triage for Qariah v2 (Android).
//
// Pulls recent Play Store reviews (Android Publisher reviews.list — text
// reviews from roughly the last week) and files a deduplicated GitHub issue for
// each one that reads like a USER ISSUE: a low-star review with text, or any
// review with an explicit feature ask. Pure praise is ignored. File-only — the
// local /loop does the root-causing.
//
// Auth: the SAME service account the Play-vitals lane uses — it already carries
// app-level access, which covers reviews. Only the OAuth SCOPE differs
// (androidpublisher here vs playdeveloperreporting for vitals). No new secret.
//
// Run:
//   GOOGLE_PLAY_SA_JSON="$(cat ~/.android/play-service-account.json)" \
//     node scripts/play-reviews-triage.mjs --dry-run
//   node scripts/play-reviews-triage.mjs            # file issues (local: reads the file below)
//
// Flags: --dry-run, --max=15, --help
// Env:   GOOGLE_PLAY_SA_JSON (JSON string, how CI passes it) OR
//        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (path) OR ~/.android/play-service-account.json
//        ANDROID_PACKAGE (default com.qariah.app)

import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {
  existingMarkers,
  fileIssues,
  emitOutput,
  parseArgs,
  ghTitle,
  firstWords,
  looksLikeFeatureRequest,
  severityForRating,
} from './lib/triage-common.mjs';

const args = parseArgs(process.argv);
if (args.help) {
  console.log(
    'Usage: node scripts/play-reviews-triage.mjs [--dry-run] [--max=15]',
  );
  process.exit(0);
}

const PACKAGE = process.env.ANDROID_PACKAGE || 'com.qariah.app';
const MARKER = 'play-review-id:';
const LABEL = 'play-store';

// Legacy-v1 cutoff. v1 and v2 ship on the SAME Play package (com.qariah.app), so
// reviews.list returns reviews from BOTH apps. Qariah v1 (Flutter) is versionCode
// ≤ ~100; v2 (RN) is ≥ ~800 (never below 812). A review whose appVersionCode is
// below this floor is a v1 review the v2 codebase can't action — skip it. Reviews
// with NO version metadata are kept (don't silently drop real v2 reviews).
// Mirrors the Play-vitals lane's MIN_VERSION_CODE floor (TECH_DEBT v1-attribution).
const MIN_VERSION_CODE = Number(process.env.MIN_VERSION_CODE) || 500;

function loadServiceAccount() {
  const raw = process.env.GOOGLE_PLAY_SA_JSON;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `GOOGLE_PLAY_SA_JSON is set but is not valid JSON: ${e.message}`,
      );
    }
  }
  const path =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.replace(/^~/, homedir()) ||
    `${homedir()}/.android/play-service-account.json`;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(
      `No service account: set GOOGLE_PLAY_SA_JSON (JSON string) or ` +
        `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (path), or place the file at ${path}. (${e.message})`,
    );
  }
}

const b64u = o =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString(
    'base64url',
  );

async function mintToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64u({alg: 'RS256', typ: 'JWT'}) +
    '.' +
    b64u({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    });
  const sig = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(sa.private_key)
    .toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const tok = await res.json().catch(() => null);
  if (!tok || !tok.access_token) {
    const why =
      tok && (tok.error_description || tok.error)
        ? `${tok.error || ''} ${tok.error_description || ''}`.trim()
        : `HTTP ${res.status}`;
    throw new Error(
      `Failed to mint androidpublisher token (${why}). Check the service-account's review permissions in Play Console.`,
    );
  }
  return tok.access_token;
}

function fmtBody({
  id,
  rating,
  text,
  author,
  lang,
  device,
  osVer,
  appVersion,
  modified,
  thumbsUp,
  severity,
  feature,
}) {
  return `**Google Play review** — auto-filed by \`play-reviews-triage\`.

- **Rating:** ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)
- **Author:** ${author || 'anonymous'}${lang ? ` · lang ${lang}` : ''}
- **Device:** ${device || 'unknown'}${osVer ? ` · Android API ${osVer}` : ''}${
    appVersion ? ` · app ${appVersion}` : ''
  }
- **Updated:** ${modified || 'unknown'}${thumbsUp ? ` · 👍 ${thumbsUp}` : ''}
- **Type:** ${
    feature ? 'feature request' : 'problem report'
  }  ·  **Severity:** ${severity}

> ${(text || '(no text)').replace(/\n/g, '\n> ')}

### Triage
- [ ] Confirm whether this is a real bug, a UX gap, or a feature ask
- [ ] Reproduce on a release build / link any matching Play-vitals or Sentry signal
- [ ] Reply in Play Console if a response helps the user
- [ ] Fix (or convert to a tracked enhancement), then resolve

Find it in **Play Console → Qariah → Ratings and reviews → Reviews** (review id \`${id}\`).

<!-- ${MARKER}${id} -->`;
}

async function main() {
  console.log(
    `▶ play-reviews  pkg=${PACKAGE} max=${args.max}${
      args.dryRun ? '  (DRY RUN)' : ''
    }`,
  );
  const sa = loadServiceAccount();
  const token = await mintToken(sa);

  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/reviews?maxResults=100`,
    {headers: {Authorization: `Bearer ${token}`}},
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Reviews API ${res.status}: ${String(
        body.error?.message || res.status,
      ).slice(0, 300)}`,
    );
  }
  const reviews = body.reviews || [];
  console.log(`  fetched: ${reviews.length} review(s) with text`);

  const already = existingMarkers(LABEL, MARKER, {dryRun: args.dryRun});
  console.log(`  already filed: ${already.size}`);

  const candidates = [];
  let skippedV1 = 0;
  for (const r of reviews) {
    const uc = r.comments?.[0]?.userComment;
    if (!uc) continue;
    // Legacy-v1 guard: drop reviews left on the v1 (Flutter) build that shares
    // this package. Reviews with no/zero appVersionCode are kept (don't drop a
    // real v2 review just because the API omitted the version).
    const vc = Number(uc.appVersionCode) || 0;
    if (vc && vc < MIN_VERSION_CODE) {
      skippedV1++;
      continue;
    }
    const rating = Number(uc.starRating) || 0;
    const text = (uc.text || '').trim();
    const feature = looksLikeFeatureRequest(text);
    const file = text.length > 0 && (rating <= 3 || feature);
    if (!file) continue;
    if (already.has(r.reviewId)) continue;
    candidates.push({
      id: r.reviewId,
      rating,
      text,
      author: r.authorName,
      lang: uc.reviewerLanguage,
      device: uc.device,
      osVer: uc.androidOsVersion,
      appVersion: uc.appVersionName,
      modified: uc.lastModified?.seconds
        ? new Date(Number(uc.lastModified.seconds) * 1000)
            .toISOString()
            .slice(0, 10)
        : null,
      thumbsUp: uc.thumbsUpCount,
      feature,
      severity: severityForRating(rating),
    });
  }
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
      `[Play ★${c.rating}] ${firstWords(c.text)}${
        c.lang ? ` (${c.lang})` : ''
      }`,
    ),
    labels: [
      'play-store',
      'user-review',
      c.feature ? 'enhancement' : 'bug',
      `severity:${c.severity}`,
      'android',
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
