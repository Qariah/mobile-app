#!/usr/bin/env node
// @ai
//
// scripts/release-health.mjs
// --------------------------
// Sentry Release Health → GitHub issue + promote gate for Qariah v2.
//
// The richest, denominator-honest, measurement-artifact-immune health signal —
// already instrumented (`enableAutoSessionTracking: true` in app/_layout.tsx)
// and documented as the §3 go/no-go gate in
// docs/operations/diagnostics-and-release-health.md — but until now queried by
// nothing. This lane reads crash-free SESSIONS + crash-free USERS per release
// from the Sentry Sessions API, files a `release-health` issue when a release
// with real traffic falls below the documented thresholds, and emits a
// `GITHUB_OUTPUT health_ok=true/false` so `promote-beta-to-prod.yml` can BLOCK
// a promotion on a regression.
//
// Documented thresholds (§3):
//   crash-free sessions >= 99.5%
//   crash-free users    >= 99.0%
//
//   set -a && source .env.local && set +a
//   node scripts/release-health.mjs --dry-run             # print the table, file nothing
//   node scripts/release-health.mjs                       # file issues for failing releases
//   node scripts/release-health.mjs --release=3.1.8+1318  # gate ONE release (promote check)
//
// Flags:
//   --dry-run                 query + evaluate + print, but DO NOT create issues
//   --window=14d              Sentry stats window
//   --min-sessions=50         ignore a release with fewer sessions (too small to trust)
//   --session-threshold=0.995 crash-free-session gate (0.995 = 99.5%)
//   --user-threshold=0.99     crash-free-user gate
//   --release=VER+BUILD       evaluate only this release (sets health_ok for the promote gate)
//   --min-version-code=500    only evaluate v2 builds (versionCode >= floor)
//   --max=10                  max issues to file in one run
//   --help
//
// Env:  SENTRY_READ_TOKEN (org:read + project:read), SENTRY_ORG, SENTRY_PROJECT,
//       SENTRY_REGION_HOST, GH_REPO, GH_TOKEN

import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => {
  const hit = argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

if (flag('help')) {
  console.log(
    [
      'Usage: node scripts/release-health.mjs [--dry-run] [--window=14d] [--min-sessions=50]',
      '                                       [--session-threshold=0.995] [--user-threshold=0.99]',
      '                                       [--release=VER+BUILD] [--max=10]',
      '',
      'Reads Sentry crash-free sessions/users per release, files a release-health issue',
      'for failing releases, and emits GITHUB_OUTPUT health_ok for the promote gate.',
      'Env: SENTRY_READ_TOKEN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_REGION_HOST, GH_REPO, GH_TOKEN.',
    ].join('\n'),
  );
  process.exit(0);
}

const TOKEN = process.env.SENTRY_READ_TOKEN;
const ORG = process.env.SENTRY_ORG || 'qariah';
const PROJECT = process.env.SENTRY_PROJECT || 'qariahv2';
const HOST = (process.env.SENTRY_REGION_HOST || 'https://de.sentry.io').replace(
  /\/$/,
  '',
);
const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

const DRY_RUN = flag('dry-run');
const SENTRY_WINDOWS = ['', '24h', '14d', '90d'];
const WINDOW_RAW = opt('window', '14d');
const WINDOW = SENTRY_WINDOWS.includes(WINDOW_RAW) ? WINDOW_RAW : '14d';
const MIN_SESSIONS = parseInt(opt('min-sessions', '50'), 10) || 50;
const SESSION_THRESHOLD = parseFloat(opt('session-threshold', '0.995'));
const USER_THRESHOLD = parseFloat(opt('user-threshold', '0.99'));
const ONLY_RELEASE = opt('release', '');
const MIN_VERSION_CODE = Number(opt('min-version-code', '500')) || 500;
const MAX = parseInt(opt('max', '10'), 10) || 10;

if (!TOKEN) {
  console.error(
    '❌ SENTRY_READ_TOKEN is not set. Source .env.local or set the secret.',
  );
  process.exit(2);
}

const MARKER_PREFIX = 'release-health-id:';
const LABEL = 'release-health';

function gh(args, {input} = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    throw new Error(`gh ${args.join(' ')} failed: ${msg.slice(0, 400)}`);
  }
}

async function sentry(path) {
  const res = await fetch(`${HOST}/api/0${path}`, {
    headers: {Authorization: `Bearer ${TOKEN}`},
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Sentry ${res.status} on ${path.split('?')[0]}: ${body.slice(0, 300)}`,
    );
  }
  return res.json();
}

// Recover the versionCode from a release id "com.qariah.app@3.1.8+1318".
function versionCodeOf(release) {
  const m = String(release).match(/\+(\d+)\b/);
  return m ? Number(m[1]) : NaN;
}

function ensureLabels(labels) {
  if (DRY_RUN) return;
  const palette = {
    'release-health': 'b60205',
    'severity:critical': 'b60205',
    'severity:high': 'd93f0b',
    'severity:medium': 'fbca04',
    bug: 'd73a4a',
  };
  for (const l of labels) {
    try {
      gh([
        'label',
        'create',
        l,
        '--repo',
        GH_REPO,
        '--color',
        palette[l] || 'ededed',
        '--force',
      ]);
    } catch {
      /* exists / race — fine */
    }
  }
}

const fpct = x => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);

function fmtBody(r) {
  const sessOk = r.cfSession >= SESSION_THRESHOLD;
  const userOk = r.cfUser >= USER_THRESHOLD;
  return `> Filed automatically by \`scripts/release-health.mjs\` (see \`.github/workflows/diagnostics-watch.yml\`).

## Release health below gate: \`${r.release}\`

This release's crash-free rate is under the documented §3 promote gate
(\`docs/operations/diagnostics-and-release-health.md\`). **It is the richest,
denominator-honest, measurement-artifact-immune health signal** — unlike the
PostHog ratios, it cannot be deflated by a fresh-install wave.

| Metric | This release | Gate | |
|---|---|---|---|
| **Crash-free sessions** | ${fpct(r.cfSession)} | ≥ ${fpct(SESSION_THRESHOLD)} | ${sessOk ? '✅' : '❌'} |
| **Crash-free users** | ${fpct(r.cfUser)} | ≥ ${fpct(USER_THRESHOLD)} | ${userOk ? '✅' : '❌'} |
| **Sessions (window ${WINDOW})** | ${r.sessions} | — | |

### What this means
A release below either bar should **not be promoted** to wider rollout / prod
until the regression is understood. Cross-check the Sentry crash issues filed
for this build (the \`sentry\` lane) and the Play vitals rate for the matching
versionCode (the \`play-store\` lane) — the crash-free drop is the aggregate of
those specific crashes.

### Checklist
- [ ] Identify the crash(es) driving the drop (Sentry issues for \`${r.release}\`)
- [ ] Decide hold vs. hotfix vs. accept (small-sample releases can be noisy — check the session count)
- [ ] If promoting anyway, document why the gate was waived
- [ ] Re-run \`release-health.mjs --release=${r.release}\` after the fix to confirm recovery

<!-- ${MARKER_PREFIX}${r.release} -->`;
}

async function main() {
  console.log(
    `▶ release-health  org=${ORG} project=${PROJECT} window=${WINDOW} ` +
      `gates=[sess≥${fpct(SESSION_THRESHOLD)}, user≥${fpct(USER_THRESHOLD)}]` +
      `${ONLY_RELEASE ? ` release=${ONLY_RELEASE}` : ''}${DRY_RUN ? '  (DRY RUN)' : ''}`,
  );

  // 1. Pull crash-free sessions + users per release.
  const data = await sentry(
    `/organizations/${ORG}/sessions/?field=${encodeURIComponent('crash_free_rate(session)')}` +
      `&field=${encodeURIComponent('crash_free_rate(user)')}` +
      `&field=${encodeURIComponent('sum(session)')}` +
      `&groupBy=release&statsPeriod=${WINDOW}&project=-1`,
  );
  const groups = data.groups || [];
  const releases = groups
    .map(g => ({
      release: g.by.release,
      cfSession: g.totals['crash_free_rate(session)'],
      cfUser: g.totals['crash_free_rate(user)'],
      sessions: g.totals['sum(session)'] || 0,
    }))
    .filter(r => r.release);
  console.log(`  scanned ${releases.length} release(s)`);

  // 2. Evaluate. Skip legacy v1 (versionCode < floor) + low-sample releases.
  //    When --release is set, evaluate ONLY that one (the promote gate).
  const failing = [];
  let gatedRelease = null;
  for (const r of releases) {
    if (ONLY_RELEASE && !r.release.includes(ONLY_RELEASE)) continue;
    const vc = versionCodeOf(r.release);
    if (Number.isFinite(vc) && vc < MIN_VERSION_CODE) continue;
    if (ONLY_RELEASE) gatedRelease = r;
    const small = r.sessions < MIN_SESSIONS;
    const sessOk = r.cfSession == null || r.cfSession >= SESSION_THRESHOLD;
    const userOk = r.cfUser == null || r.cfUser >= USER_THRESHOLD;
    const ok = sessOk && userOk;
    const tag = small ? '(small sample)' : ok ? 'OK' : '❌ BELOW GATE';
    console.log(
      `   • ${r.release.padEnd(28)} sess=${fpct(r.cfSession)} user=${fpct(r.cfUser)} n=${r.sessions} ${tag}`,
    );
    // File only when a real-traffic release fails. Small-sample failures are
    // printed but not filed (one crashy session on a 5-session build is noise).
    if (!ok && !small) failing.push(r);
  }

  // Promote-gate output: health_ok reflects the --release target (or, with no
  // target, whether ANY real-traffic release is failing).
  let healthOk;
  if (ONLY_RELEASE) {
    if (!gatedRelease) {
      console.log(
        `  ⚠ release ${ONLY_RELEASE} not found in the window — treating as UNKNOWN (health_ok=false to be safe).`,
      );
      healthOk = false;
    } else {
      const small = gatedRelease.sessions < MIN_SESSIONS;
      healthOk =
        small || // not enough data to fail it
        ((gatedRelease.cfSession == null ||
          gatedRelease.cfSession >= SESSION_THRESHOLD) &&
          (gatedRelease.cfUser == null ||
            gatedRelease.cfUser >= USER_THRESHOLD));
    }
  } else {
    healthOk = failing.length === 0;
  }

  // 3. Dedup + file (skip when only gating one release for the promote check —
  //    --release is a read-only gate, not a filing run, unless it's failing).
  if (!DRY_RUN) ensureLabels([LABEL]);
  let alreadyFiled = new Set();
  try {
    const existing = JSON.parse(
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
        'body',
      ]),
    );
    for (const e of existing) {
      const m = (e.body || '').match(
        new RegExp(`${MARKER_PREFIX}([^\\s>]+)`, 'g'),
      );
      if (m) m.forEach(s => alreadyFiled.add(s.slice(MARKER_PREFIX.length)));
    }
  } catch (e) {
    console.warn(`  ⚠ could not list existing issues for dedup: ${e.message}`);
    if (!DRY_RUN) {
      console.error('  refusing to file without a working dedup check.');
      process.exit(1);
    }
  }
  const fresh = failing.filter(r => !alreadyFiled.has(r.release)).slice(0, MAX);
  console.log(
    `  failing releases to file: ${fresh.length}  [${alreadyFiled.size} already filed]`,
  );

  let filed = 0;
  const tmp = DRY_RUN ? null : mkdtempSync(join(tmpdir(), 'release-health-'));
  for (const r of fresh) {
    const userOk = r.cfUser == null || r.cfUser >= USER_THRESHOLD;
    const severity = !userOk && r.cfUser < 0.95 ? 'critical' : 'high';
    const labels = [LABEL, 'bug', `severity:${severity}`];
    const title = `[Release health] ${r.release} below gate — ${fpct(r.cfSession)} sessions / ${fpct(r.cfUser)} users`;
    const body = fmtBody(r);
    if (DRY_RUN) {
      console.log('\n' + '─'.repeat(72));
      console.log(`WOULD FILE: ${title}`);
      console.log(`  labels: ${labels.join(', ')}`);
      console.log(
        body
          .split('\n')
          .map(l => '  ' + l)
          .join('\n'),
      );
      filed++;
      continue;
    }
    ensureLabels(labels);
    const bodyFile = join(tmp, `${r.release.replace(/[^\w.+-]/g, '_')}.md`);
    writeFileSync(bodyFile, body);
    const url = gh([
      'issue',
      'create',
      '--repo',
      GH_REPO,
      '--title',
      title.slice(0, 140),
      '--body-file',
      bodyFile,
      ...labels.flatMap(l => ['--label', l]),
    ]);
    console.log(`  ✅ filed ${r.release} → ${url}`);
    filed++;
  }

  console.log(
    `\n▶ done — ${DRY_RUN ? 'would file' : 'filed'} ${filed}; health_ok=${healthOk}.`,
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `filed=${DRY_RUN ? 0 : filed}\nhealth_ok=${healthOk}\nfailing=${failing.length}\n`,
      {flag: 'a'},
    );
  }
}

main().catch(e => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
