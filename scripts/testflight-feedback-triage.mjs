#!/usr/bin/env node
// @ai
//
// scripts/testflight-feedback-triage.mjs
// --------------------------------------
// TestFlight tester feedback → GitHub issue triage for Qariah v2 (iOS).
//
// Pulls beta-tester feedback (screenshot submissions + crash submissions) via
// the App Store Connect API and files a deduplicated GitHub issue for each.
// Unlike reviews, EVERY submission is filed: a tester explicitly chose to send
// it, so it is all signal and low-volume. File-only — the local /loop triages.
//
// Covers BOTH app records that ship TestFlight builds:
//   1594917787  com.qariah.app       (public-beta + prod TestFlight)
//   6770301971  com.qariah.app.beta  (internal beta)
//
// Auth: the same ASC API key the release pipeline uses (see lib/asc-client.mjs).
//
// Run:
//   set -a && source .env.local && set +a
//   node scripts/testflight-feedback-triage.mjs --dry-run
//   node scripts/testflight-feedback-triage.mjs
//
// Flags: --dry-run, --max=20, --help
// Env:   ASC_TF_APP_IDS (default "1594917787,6770301971")

import {ascJwt, ascGet} from './lib/asc-client.mjs';
import {
  existingMarkers,
  fileIssues,
  emitOutput,
  parseArgs,
  ghTitle,
  firstWords,
  looksLikeFeatureRequest,
} from './lib/triage-common.mjs';

const args = parseArgs(process.argv);
if (args.help) {
  console.log(
    'Usage: node scripts/testflight-feedback-triage.mjs [--dry-run] [--max=20]',
  );
  process.exit(0);
}

const APP_IDS = (process.env.ASC_TF_APP_IDS || '1594917787,6770301971')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const MARKER = 'testflight-feedback-id:';
const LABEL = 'testflight';

// Free-text categorizer (the 2026-06-14 expert review's #10 rec). Ordered =
// priority; the first match wins. A category becomes a label and can bump
// severity. CONTENT defects (the #115+#110 first-ayah/Bismillah pair) and
// explicit UX REGRESSIONS ("it used to…", #123) deserve higher signal than a
// flat-severity transcription.
const CATEGORIES = [
  {
    key: 'ux-regression',
    label: 'ux-regression',
    // "used to / no longer / since the update / stopped doing X" — an explicit
    // behavioral regression. High value: something that worked, broke.
    re: /\bused to\b|no longer|since (the )?(last )?update|stopped (auto|pulling|working|showing)|doesn'?t .* anymore|used to (auto|pull|show|work)/i,
    severityFloor: 'high',
  },
  {
    key: 'content',
    label: 'content-defect',
    // first ayah / Bismillah / vowels / wrong reciter / missing verse — a
    // catalog/data-rendering correctness defect (public-launch ★1 risk).
    re: /first ayah|first verse|bismillah|missing (vowel|verse|ayah)|wrong (reciter|surah|name)|vowels?\b|tashkeel|harakat|supposed to be/i,
    severityFloor: 'high',
  },
  {
    key: 'loading',
    label: 'loading',
    re: /not loading|won'?t load|stuck on|loading forever|spinner|won'?t open|not opening|frozen|hang|black screen|blank/i,
    severityFloor: 'high',
  },
  {
    key: 'audio',
    label: 'audio',
    re: /audio|sound|playback|recitation|play(s|ed|ing)? |volume|stops? (mid|playing)|cuts? out|no sound/i,
  },
  {
    key: 'download',
    label: 'download',
    re: /download|tafsir|tafseer|translation .*(download|install)|offline/i,
  },
];
function categorize(comment) {
  const text = String(comment || '');
  for (const c of CATEGORIES) if (c.re.test(text)) return c;
  // A tester asking for something ("please add X", multilingual) is a feature
  // request, not a bug — tag it so the digest's "🌟 Feature requests" section
  // surfaces it (and the fix-loop's taxonomy routes it out of `bug`).
  if (looksLikeFeatureRequest(text))
    return {key: 'feature-request', label: 'feature-request', re: null};
  return {key: 'other', label: 'feedback', re: null};
}

// Near-duplicate key for cross-tester dedup — normalize the comment to a small
// token (lowercase, strip punctuation/numbers/time, first ~8 words). Two
// submissions that normalize to the same key are the same report from different
// testers; we file the first and note the others.
function nearDupKey(comment) {
  return String(comment || '')
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}\s*(am|pm)?/gi, '') // times like "11:01am"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
}

const SEV_RANK = {critical: 4, high: 3, medium: 2, low: 1};
function maxSeverity(a, b) {
  return (SEV_RANK[a] || 0) >= (SEV_RANK[b] || 0) ? a : b;
}

// Render the collapsed near-duplicate submissions (same complaint, other testers).
function dupBlock(dupes) {
  if (!dupes || !dupes.length) return '';
  const rows = dupes
    .map(
      d =>
        `- ${d.tester || 'anonymous'} on ${d.device || 'device'} ${
          d.os || ''
        } (${d.created || '—'}): ` + `“${firstWords(d.comment, 14)}”`,
    )
    .join('\n');
  return `\n\n### Also reported by ${dupes.length} other tester(s)\n${rows}\n`;
}

// Resolve a related build version / tester name from the JSON:API `included` set.
function relName(included, rel) {
  const ref = rel?.data;
  if (!ref) return null;
  const inc = included.find(i => i.type === ref.type && i.id === ref.id);
  if (!inc) return null;
  if (ref.type === 'builds') return inc.attributes?.version || null;
  if (ref.type === 'betaTesters') {
    return (
      [inc.attributes?.firstName, inc.attributes?.lastName]
        .filter(Boolean)
        .join(' ') || null
    );
  }
  return null;
}

function fmtBody({
  kind,
  appId,
  comment,
  device,
  os,
  locale,
  uptime,
  build,
  tester,
  created,
  screenshots,
  id,
}) {
  const tfUrl = `https://appstoreconnect.apple.com/apps/${appId}/testflight/feedback`;
  const shots = (screenshots || []).length
    ? '\n' +
      screenshots
        .map(
          (u, i) =>
            `- [Screenshot ${
              i + 1
            }](${u})  _(Apple link — expires; canonical copy is in App Store Connect)_`,
        )
        .join('\n')
    : '';
  return `**TestFlight ${kind} submission** — auto-filed by \`testflight-feedback-triage\`.

- **App record:** ${appId}
- **Build:** ${build || 'unknown'}
- **Device:** ${device || 'unknown'} · **iOS:** ${os || 'unknown'}${
    locale ? ` · ${locale}` : ''
  }
- **Tester:** ${tester || 'anonymous'}
- **Submitted:** ${created || 'unknown'}${
    uptime != null ? ` · app uptime ${Math.round(uptime / 1000)}s` : ''
  }

> ${(comment || '(no comment)').replace(/\n/g, '\n> ')}
${shots}

### Triage
- [ ] Reproduce on a release build / link any matching Sentry crash for the same build
- [ ] ${
    kind === 'crash'
      ? 'Symbolicate + identify the failing frame'
      : 'Confirm the issue shown in the screenshot'
  }
- [ ] Fix, then resolve and (optionally) reply to the tester

[Open in App Store Connect → TestFlight Feedback](${tfUrl})

<!-- ${MARKER}${id} -->`;
}

async function fetchKind(appId, kind, jwt) {
  // kind: 'screenshot' | 'crash'
  const path =
    kind === 'screenshot'
      ? `/v1/apps/${appId}/betaFeedbackScreenshotSubmissions?limit=50&sort=-createdDate&include=build,tester` +
        `&fields[betaFeedbackScreenshotSubmissions]=comment,createdDate,deviceModel,osVersion,locale,appUptimeInMilliseconds,screenshots,build,tester` +
        `&fields[builds]=version&fields[betaTesters]=firstName,lastName`
      : `/v1/apps/${appId}/betaFeedbackCrashSubmissions?limit=50&sort=-createdDate&include=build,tester` +
        `&fields[betaFeedbackCrashSubmissions]=comment,createdDate,deviceModel,osVersion,locale,appUptimeInMilliseconds,build,tester` +
        `&fields[builds]=version&fields[betaTesters]=firstName,lastName`;
  const resp = await ascGet(path, jwt);
  const included = resp.included || [];
  return (resp.data || []).map(d => {
    const a = d.attributes || {};
    const shots = Array.isArray(a.screenshots)
      ? a.screenshots.map(s => s.url).filter(Boolean)
      : [];
    return {
      id: d.id,
      kind,
      appId,
      comment: a.comment,
      device: a.deviceModel,
      os: a.osVersion,
      locale: a.locale,
      uptime: a.appUptimeInMilliseconds,
      created: a.createdDate,
      screenshots: shots,
      build: relName(included, d.relationships?.build),
      tester: relName(included, d.relationships?.tester),
    };
  });
}

async function main() {
  console.log(
    `▶ testflight-feedback  apps=[${APP_IDS.join(',')}] max=${args.max}${
      args.dryRun ? '  (DRY RUN)' : ''
    }`,
  );
  const jwt = ascJwt();

  let all = [];
  for (const appId of APP_IDS) {
    for (const kind of ['crash', 'screenshot']) {
      try {
        const rows = await fetchKind(appId, kind, jwt);
        console.log(`  app ${appId} ${kind}: ${rows.length}`);
        all = all.concat(rows);
      } catch (e) {
        console.warn(`  ⚠ app ${appId} ${kind}: ${e.message}`);
      }
    }
  }

  const already = existingMarkers(LABEL, MARKER, {dryRun: args.dryRun});
  console.log(`  already filed: ${already.size}`);

  // crash submissions first (higher severity), then newest.
  const freshAll = all
    .filter(r => !already.has(r.id))
    .sort(
      (a, b) =>
        (b.kind === 'crash') - (a.kind === 'crash') ||
        String(b.created).localeCompare(String(a.created)),
    );

  // NEAR-DUPLICATE COLLAPSE — the same complaint from different testers (e.g.
  // the #115+#110 first-ayah pair) collapses to ONE issue listing the other
  // submissions. Crashes are never collapsed (each crash dump is distinct).
  const seenDup = new Map();
  const fresh = [];
  for (const r of freshAll) {
    if (r.kind === 'crash' || !r.comment) {
      fresh.push(r);
      continue;
    }
    const key = nearDupKey(r.comment);
    if (key && seenDup.has(key)) {
      seenDup.get(key).dupes.push(r);
      continue;
    }
    const rep = {...r, dupes: []};
    if (key) seenDup.set(key, rep);
    fresh.push(rep);
  }
  const collapsed = freshAll.length - fresh.length;
  if (collapsed > 0)
    console.log(
      `  collapsed ${collapsed} near-duplicate submission(s) across testers`,
    );

  const toFile = fresh.slice(0, args.max);
  const deferred = fresh.length - toFile.length;
  console.log(
    `  new submissions: ${fresh.length}${
      deferred > 0 ? ` (capping at ${args.max}, +${deferred} next run)` : ''
    }`,
  );

  const items = toFile.map(r => {
    const cat = categorize(r.comment);
    // Base severity: crash=high, else medium. Floor up to the category's floor.
    // A feature request is not a defect → severity:low.
    let severity = r.kind === 'crash' ? 'high' : 'medium';
    if (cat.key === 'feature-request') severity = 'low';
    else if (cat.severityFloor)
      severity = maxSeverity(severity, cat.severityFloor);
    const dupCount = (r.dupes || []).length;
    return {
      id: r.id,
      title: ghTitle(
        `[TestFlight ${cat.key !== 'other' ? cat.key : r.kind}] ${
          r.comment
            ? firstWords(r.comment)
            : r.kind === 'crash'
              ? 'Crash submission'
              : 'Screenshot feedback'
        }${dupCount ? ` (×${dupCount + 1} testers)` : ''} — ${
          r.device || 'device'
        } ${r.os || ''}`,
      ),
      labels: [
        'testflight',
        r.kind === 'crash' ? 'crash' : 'feedback',
        // crash → bug; a tester feature-ask → enhancement (NOT bug); a categorized
        // defect → bug; uncategorized note → feedback.
        r.kind === 'crash'
          ? 'bug'
          : cat.key === 'feature-request'
            ? 'enhancement'
            : cat.key === 'other'
              ? 'feedback'
              : 'bug',
        `severity:${severity}`,
        cat.label,
        'ios',
      ].filter((v, i, a2) => a2.indexOf(v) === i),
      body: fmtBody(r) + dupBlock(r.dupes),
    };
  });

  const filed = fileIssues(items, {dryRun: args.dryRun});
  console.log(
    `\n▶ done — ${all.length} fetched, ${fresh.length} new, ${
      args.dryRun ? 'would file' : 'filed'
    } ${filed}${deferred > 0 ? ` (+${deferred} deferred)` : ''}.`,
  );
  emitOutput({filed, fresh: fresh.length, deferred, dryRun: args.dryRun});
}

main().catch(e => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
