#!/usr/bin/env node
// @ai
//
// scripts/review-reply.mjs — draft, approve, post developer replies to store reviews.
// ---------------------------------------------------------------------------
// Owner decision 2026-09-07: answering reviews drives engagement, so every
// filed store review gets a drafted reply; the OWNER approves before anything
// posts. Three subcommands, one file, so the approval seam is visible:
//
//   list  [--json]                      review issues that still need a draft
//   draft --issue=<n> --text=<s> | --text-file=<path> [--dry-run]
//                                       post the draft as an issue comment
//                                       (<!-- reply-draft --> marker) + label `reply-draft`;
//                                       --dry-run (or shadow mode) prints it only
//   post  --issue=<n> [--dry-run]       POST the latest draft comment to the store,
//                                       swap labels reply-draft → replied, audit-log
//
// WHO RUNS WHAT. The daily loop (qariah-triage-loop Step 4) runs `list` and
// `draft` — the prose is the loop's, written per review. `post` runs ONLY in a
// session where the owner named the numbers from the daily card's REPLY DRAFTS
// section. Nothing here posts on a schedule. The owner may edit the draft
// comment on GitHub first; `post` reads the LATEST reply-draft comment.
//
// Platform is read from the issue's labels (`play-store` | `app-store`); the
// review id from the lane's dedup marker (`play-review-id:` | `appstore-review-id:`).
// Play limit 350 chars (Google enforces it; one reply per review, a re-post
// overwrites). App Store limit 5970; one response per review (Apple rejects a
// second — delete in ASC first).
//
// Env: GH_REPO · Play: GOOGLE_PLAY_SA_JSON (string) or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
// (path) or ~/.android/play-service-account.json; ANDROID_PACKAGE · App Store:
// APP_STORE_CONNECT_API_KEY_ID / _ISSUER_ID / (_API_KEY_P8_B64 or the .p8 file).

import {appendFileSync, mkdirSync, readFileSync} from 'node:fs';
import {ANDROID_PACKAGE_NAME} from './lib/app-ids.mjs';
import {ascJwt, ascPost} from './lib/asc-client.mjs';
import {getPlayAccessToken} from './lib/google-play-auth.mjs';
import {
  addIssueLabels,
  commentOnIssue,
  getIssue,
  isCloudSession,
  isShadowRun,
  listIssues,
  removeIssueLabel,
} from './lib/triage-common.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const cmd = process.argv.slice(2).find(a => !a.startsWith('--'));
const PACKAGE = process.env.ANDROID_PACKAGE || ANDROID_PACKAGE_NAME;
// Shadow mode (scripts/run-start.sh triage --shadow) forces a dry run.
const DRY = !!args['dry-run'] || isShadowRun();
const MARK = '<!-- reply-draft -->';
const LIMITS = {'play-store': 350, 'app-store': 5970};

const usage = () => {
  console.error(
    'usage:\n  review-reply.mjs list [--json]\n  review-reply.mjs draft --issue=<n> (--text=<s> | --text-file=<path>) [--dry-run]\n  review-reply.mjs post --issue=<n> [--dry-run]',
  );
  process.exit(2);
};

function platformOf(labels) {
  const names = labels.map(l => (typeof l === 'string' ? l : l.name));
  if (names.includes('play-store')) return 'play-store';
  if (names.includes('app-store')) return 'app-store';
  return null;
}
function reviewIdOf(body, platform) {
  const re =
    platform === 'play-store'
      ? /play-review-id:([^\s>]+)/
      : /appstore-review-id:([^\s>]+)/;
  return (body || '').match(re)?.[1] || null;
}
function reviewTextOf(body) {
  return (body || '')
    .split('\n')
    .filter(l => l.startsWith('> '))
    .map(l => l.slice(2).replace(/^\*\*|\*\*$/g, ''))
    .join(' ')
    .trim();
}
function ratingOf(body) {
  return Number((body || '').match(/\((\d)\/5\)/)?.[1]) || null;
}

// ---------------------------------------------------------------- list
function list() {
  const rows = listIssues({state: 'open', labels: 'user-review', limit: 100});
  const need = rows
    .filter(
      r =>
        !r.labels.some(l =>
          ['reply-draft', 'replied', 'legacy-v1', 'wontfix'].includes(l.name),
        ),
    )
    .map(r => {
      const platform = platformOf(r.labels);
      return {
        number: r.number,
        title: r.title,
        platform,
        reviewId: reviewIdOf(r.body, platform),
        rating: ratingOf(r.body),
        text: reviewTextOf(r.body).slice(0, 600),
        limit: LIMITS[platform] || 350,
        url: r.url,
      };
    })
    .filter(r => r.platform && r.reviewId);
  if (args.json) console.log(JSON.stringify(need, null, 2));
  else if (!need.length) console.log('no reviews need a draft');
  else
    for (const r of need)
      console.log(
        `#${r.number}  ${r.platform}  ★${r.rating ?? '?'}  ${r.title.slice(0, 70)}`,
      );
}

// ---------------------------------------------------------------- draft
function draft() {
  const n = Number(args.issue);
  if (!n) usage();
  const text = args['text-file']
    ? readFileSync(args['text-file'], 'utf8').trim()
    : String(args.text || '').trim();
  if (!text) usage();
  const issue = getIssue(n);
  const platform = platformOf(issue.labels);
  if (!platform) throw new Error(`#${n} has no play-store/app-store label`);
  const limit = LIMITS[platform];
  if (text.length > limit)
    throw new Error(
      `draft is ${text.length} chars; ${platform} allows ${limit}`,
    );
  if (/https?:\/\//i.test(text)) throw new Error('no links in a store reply');
  const comment = `${MARK}\n**Reply draft** — ${platform}, ${text.length}/${limit} chars. Edit this comment to change the wording; \`post\` reads the latest draft. Posting needs the owner's go from the daily card.\n\n${text}`;
  if (DRY) {
    console.log(
      `· DRY RUN — would post this draft on #${n} and add label reply-draft:\n---\n${comment}\n---`,
    );
    return;
  }
  commentOnIssue(n, comment);
  addIssueLabels(n, ['reply-draft']);
  console.log(`✓ draft posted on #${n} (${platform}, ${text.length} chars)`);
}

// ---------------------------------------------------------------- post
async function postPlay(reviewId, text) {
  const token = await getPlayAccessToken({scope: 'publisher'});
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/reviews/${encodeURIComponent(reviewId)}:reply`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({replyText: text}),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `Play reply ${res.status}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  return body?.result?.replyText ? 'ok' : JSON.stringify(body).slice(0, 120);
}

async function postAppStore(reviewId, text) {
  const jwt = ascJwt();
  const body = await ascPost(
    '/v1/customerReviewResponses',
    {
      data: {
        type: 'customerReviewResponses',
        attributes: {responseBody: text},
        relationships: {
          review: {data: {type: 'customerReviews', id: reviewId}},
        },
      },
    },
    jwt,
  );
  return body?.data?.id ? `ok (${body.data.id})` : 'ok';
}

async function post() {
  const n = Number(args.issue);
  if (!n) usage();
  const issue = getIssue(n, {comments: true});
  const platform = platformOf(issue.labels);
  if (!platform) throw new Error(`#${n} has no play-store/app-store label`);
  if (!issue.labels.some(l => l.name === 'reply-draft'))
    throw new Error(`#${n} carries no reply-draft label — draft first`);
  const reviewId = reviewIdOf(issue.body, platform);
  if (!reviewId) throw new Error(`#${n} has no review id marker`);
  const drafts = (issue.comments || []).filter(c =>
    (c.body || '').includes(MARK),
  );
  if (!drafts.length) throw new Error(`#${n} has no ${MARK} comment`);
  const latest = drafts[drafts.length - 1].body;
  const text = latest
    .split('\n')
    .slice(1)
    .join('\n')
    .replace(/^\*\*Reply draft\*\*[^\n]*\n\n?/, '')
    .trim();
  if (!text) throw new Error('draft comment has no text');
  if (text.length > LIMITS[platform])
    throw new Error(
      `draft is ${text.length} chars; ${platform} allows ${LIMITS[platform]}`,
    );

  console.log(
    `▶ post #${n} → ${platform} review ${reviewId} (${text.length} chars)${DRY ? '  (DRY RUN)' : ''}\n---\n${text}\n---`,
  );
  if (DRY) return;
  const result =
    platform === 'play-store'
      ? await postPlay(reviewId, text)
      : await postAppStore(reviewId, text);
  const at = new Date().toISOString();
  removeIssueLabel(n, 'reply-draft');
  addIssueLabels(n, ['replied']);
  commentOnIssue(
    n,
    `Reply posted to ${platform === 'play-store' ? 'Google Play' : 'App Store Connect'} at ${at} by \`scripts/review-reply.mjs\` (${result}).`,
  );
  if (!isCloudSession()) {
    mkdirSync('build', {recursive: true});
    appendFileSync(
      'build/review-replies.ndjson',
      JSON.stringify({
        at,
        issue: n,
        platform,
        reviewId,
        chars: text.length,
        result,
      }) + '\n',
    );
  }
  console.log(`✓ posted — ${result}`);
}

(async () => {
  if (cmd === 'list') list();
  else if (cmd === 'draft') draft();
  else if (cmd === 'post') await post();
  else usage();
})().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
