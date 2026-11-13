#!/usr/bin/env node
// @ai
//
// scripts/pipeline-status.mjs — one status of the whole pipeline, with no model.
// ---------------------------------------------------------------------------
// It reads what each run leaves behind and gives each of the eight stages a
// verdict (rules: scripts/lib/pipeline-status.mjs). The ops console shows the
// result on its Pipeline page, and the Steward reads the same JSON to find a
// stuck stage.
//
//   node scripts/pipeline-status.mjs                a short text summary
//   node scripts/pipeline-status.mjs --json         the full status as JSON on stdout
//   node scripts/pipeline-status.mjs --upload       also writes pipeline/status.json and
//                                                   pipeline/daily/<LA date>.json to the
//                                                   private signals bucket
//   --out=<file>           also write the JSON to this file
//   --sources=<file>       read the inputs from a file (tests), not from GitHub
//   --save-sources=<file>  write the inputs that it read, to make a test fixture
//   --now=<ISO time>       compute as of this time (tests)
//
// What it reads, with REST `gh api` only (the Claude Cloud proxy refuses GraphQL):
//   - the comments of the last 21 days on the pinned issue "Daily card" (label `ops`):
//     the `run-health` lines, the `release-audit:` and `promotion:` lines, the cards;
//   - the open issues (the `owner-queue` items, `investigate`, `fixed-in:<build>`,
//     `anomaly`), and the `owner-queue` issues that closed in the last 7 days;
//   - the open pull requests;
//   - docs/operations/active-rollout.json and auto-sprint-policy.json on the trunk;
//   - the scheduled runs of the Diagnostics Watch and Signals snapshot workflows;
//   - the stores, read only: the newest TestFlight builds of the app and of the
//     beta app, and the Play tracks internal, beta and production. This finds an
//     internal or a public beta that a person made by hand. A store that does
//     not answer gives an `errors` line; the status is still written.
//   --no-store             do not read the stores
//
// Env: GH_REPO (else the origin remote), GH_TOKEN in CI, SIGNALS_R2_* for --upload,
// APP_STORE_CONNECT_API_KEY_ID + _ISSUER_ID + _P8_B64 and GOOGLE_PLAY_SA_JSON for the stores.
// Exit 0 = done. 1 = a read or the upload failed. 2 = a usage error.

import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ANDROID_PACKAGE_NAME, IOS_BUNDLE_ID} from './lib/app-ids.mjs';
import {ascGet, ascJwt, resolveAppId} from './lib/asc-client.mjs';
import {getPlayAccessToken} from './lib/google-play-auth.mjs';
import {COLLECT_WORKFLOWS, computeStatus} from './lib/pipeline-status.mjs';
import {putSignalsJson} from './signals/lib/sigv4.mjs';

const DAY = 864e5;
const COMMENT_DAYS = 21;
const CARD_TITLE = 'Daily card';
const CARD_LABEL = 'ops';

export function parseArgs(argv) {
  const a = {
    json: false,
    upload: false,
    out: null,
    sources: null,
    saveSources: null,
    now: null,
    store: true,
  };
  for (const arg of argv) {
    if (arg === '--json') a.json = true;
    else if (arg === '--no-store') a.store = false;
    else if (arg === '--upload') a.upload = true;
    else if (arg.startsWith('--out=')) a.out = arg.slice(6);
    else if (arg.startsWith('--sources=')) a.sources = arg.slice(10);
    else if (arg.startsWith('--save-sources=')) a.saveSources = arg.slice(15);
    else if (arg.startsWith('--now=')) {
      a.now = Date.parse(arg.slice(6));
      if (Number.isNaN(a.now)) throw new Error('--now needs an ISO time');
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (a.upload && a.sources)
    throw new Error(
      '--upload reads live data; do not combine it with --sources',
    );
  return a;
}

function repoName() {
  if (process.env.GH_REPO) return process.env.GH_REPO;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
  }).trim();
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (!m)
    throw new Error(
      'set GH_REPO: the origin remote is not a GitHub repository',
    );
  return m[1];
}

function gh(args) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return execFileSync('gh', ['api', ...args], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      last = e;
    }
  }
  const why = String(last?.stderr || last?.message || '').split('\n')[0];
  throw new Error(
    `gh api ${args.filter(x => !x.startsWith('-')).pop()}: ${why}`,
  );
}

/** Every element of a paginated REST list (an array, or an object with `key`). */
function ghList(path, key = null) {
  const jq = key ? `.${key}[] | tojson` : '.[] | tojson';
  return gh(['--paginate', path, '--jq', jq])
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

function ghRaw(path) {
  return gh(['-H', 'Accept: application/vnd.github.raw+json', path]);
}

/** Read the inputs from GitHub. */
export function readSources(repo, now) {
  const trunk = gh([`repos/${repo}`, '--jq', '.default_branch']).trim();
  const all = ghList(`repos/${repo}/issues?state=open&per_page=100`);
  const issues = all.filter(i => !i.pull_request);
  const card = issues.find(
    i =>
      i.title === CARD_TITLE &&
      (i.labels || []).some(l => (l.name || l) === CARD_LABEL),
  );
  if (!card)
    throw new Error(
      `no open issue "${CARD_TITLE}" with the label ${CARD_LABEL}`,
    );
  const since = new Date(now - COMMENT_DAYS * DAY).toISOString();
  const comments = ghList(
    `repos/${repo}/issues/${card.number}/comments?since=${since}&per_page=100`,
  );
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const closedQueue = ghList(
    `repos/${repo}/issues?state=closed&labels=owner-queue&since=${weekAgo}&per_page=100`,
  ).filter(i => !i.pull_request && (i.closed_at || '') >= weekAgo);
  const pulls = ghList(`repos/${repo}/pulls?state=open&per_page=100`);
  const file = p =>
    JSON.parse(ghRaw(`repos/${repo}/contents/${p}?ref=${trunk}`));
  const rollout = file('docs/operations/active-rollout.json');
  const policy = file('docs/operations/auto-sprint-policy.json');
  const workflows = {};
  // The newest manual run that passed: it clears a failed scheduled run that came
  // before it (2026-11-11: a fixed Diagnostics Watch stayed LATE for a day).
  const workflowsManual = {};
  const runsOf = query =>
    gh([
      `repos/${repo}/actions/workflows/${query}`,
      '--jq',
      '.workflow_runs[] | {status, conclusion, created_at, html_url} | tojson',
    ])
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l));
  for (const wf of Object.keys(COLLECT_WORKFLOWS)) {
    workflows[wf] = runsOf(`${wf}/runs?event=schedule&per_page=5`);
    workflowsManual[wf] = runsOf(
      `${wf}/runs?event=workflow_dispatch&status=success&per_page=1`,
    );
  }
  // Keep only the fields that the rules read: a saved fixture stays small.
  const slimIssue = i => ({
    number: i.number,
    title: i.title,
    body: (i.labels || []).some(l => (l.name || l) === 'owner-queue')
      ? i.body
      : '',
    labels: (i.labels || []).map(l => l.name || l),
    assignees: (i.assignees || []).map(a => a.login),
    created_at: i.created_at,
    updated_at: i.updated_at,
    closed_at: i.closed_at || null,
    html_url: i.html_url,
  });
  return {
    repo,
    trunk,
    cardIssue: card.number,
    now,
    comments: comments.map(c => ({
      id: c.id,
      body: c.body,
      user: {login: c.user?.login || ''},
      created_at: c.created_at,
      updated_at: c.updated_at,
      html_url: c.html_url,
    })),
    issues: issues.map(slimIssue),
    closedQueue: closedQueue.map(slimIssue),
    pulls: pulls.map(p => ({
      number: p.number,
      title: p.title,
      draft: p.draft,
      head: {ref: p.head?.ref || ''},
      labels: (p.labels || []).map(l => l.name || l),
      created_at: p.created_at,
      html_url: p.html_url,
    })),
    rollout,
    policy,
    workflows,
    workflowsManual,
  };
}

const STORE_TIMEOUT_MS = 45000;

/** Reject after `ms`: one store that hangs must not stop the status. */
function withTimeout(p, ms, what) {
  let t;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      t = setTimeout(
        () => reject(new Error(`${what}: no answer in ${ms / 1000} s`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(t));
}

const firstLine = e =>
  String(e?.message || e)
    .split('\n')[0]
    .slice(0, 160);

/** The newest builds of one App Store Connect app → [{build, version, uploadedAt, internal, external, expired}]. */
async function ascBuilds(bundleId, jwt) {
  const app = await resolveAppId(bundleId, jwt);
  if (!app) return [];
  const body = await ascGet(
    `/v1/builds?filter[app]=${app}&sort=-uploadedDate&limit=6` +
      '&fields[builds]=version,uploadedDate,expired,buildBetaDetail,preReleaseVersion' +
      '&include=buildBetaDetail,preReleaseVersion' +
      '&fields[buildBetaDetails]=internalBuildState,externalBuildState&fields[preReleaseVersions]=version',
    jwt,
  );
  const inc = new Map(
    (body.included || []).map(x => [`${x.type}:${x.id}`, x.attributes || {}]),
  );
  return (body.data || []).map(b => {
    const rel = b.relationships || {};
    const beta =
      inc.get(`buildBetaDetails:${rel.buildBetaDetail?.data?.id}`) || {};
    const pre =
      inc.get(`preReleaseVersions:${rel.preReleaseVersion?.data?.id}`) || {};
    return {
      build: String(b.attributes?.version || ''),
      version: pre.version || null,
      uploadedAt: b.attributes?.uploadedDate
        ? new Date(b.attributes.uploadedDate).toISOString()
        : null,
      internal: beta.internalBuildState || null,
      external: beta.externalBuildState || null,
      expired: Boolean(b.attributes?.expired),
    };
  });
}

/** The Play tracks, read only: it opens an edit, reads, and deletes the edit. */
async function playTracks() {
  const token = await getPlayAccessToken({scope: 'publisher'});
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}`;
  const call = async (method, path) => {
    const r = await fetch(`${base}/${path}`, {
      method,
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!r.ok)
      throw new Error(`Play ${r.status} on ${method} ${path.split('/').pop()}`);
    return method === 'DELETE' ? null : r.json();
  };
  const edit = await call('POST', 'edits');
  try {
    const t = await call('GET', `edits/${edit.id}/tracks`);
    const out = {};
    for (const tr of t.tracks || [])
      if (['internal', 'beta', 'production'].includes(tr.track))
        out[tr.track] = (tr.releases || []).map(r => ({
          versionCodes: (r.versionCodes || []).map(String),
          status: r.status || null,
          name: r.name || null,
        }));
    return out;
  } finally {
    await call('DELETE', `edits/${edit.id}`).catch(() => null);
  }
}

/** The store state for the status. Never throws: a failure is an `errors` line. */
export async function readStore(env = process.env) {
  const out = {
    readAt: new Date().toISOString(),
    ios: null,
    android: null,
    errors: [],
  };
  if (env.APP_STORE_CONNECT_API_KEY_ID && env.APP_STORE_CONNECT_ISSUER_ID) {
    try {
      const jwt = ascJwt();
      const [app, beta] = await withTimeout(
        Promise.all([
          ascBuilds(IOS_BUNDLE_ID, jwt),
          ascBuilds(`${IOS_BUNDLE_ID}.beta`, jwt),
        ]),
        STORE_TIMEOUT_MS,
        'App Store Connect',
      );
      out.ios = {app, beta};
    } catch (e) {
      out.errors.push(`App Store Connect: ${firstLine(e)}`);
    }
  } else out.errors.push('App Store Connect: no credentials');
  try {
    out.android = await withTimeout(
      playTracks(),
      STORE_TIMEOUT_MS,
      'Google Play',
    );
  } catch (e) {
    out.errors.push(`Google Play: ${firstLine(e)}`);
  }
  return out;
}

export function summary(st) {
  const out = [
    `pipeline ${st.date}: ${st.overall.level} · ${st.overall.reason}`,
  ];
  for (const s of st.stages)
    out.push(`  ${s.n} ${s.name.padEnd(9)} ${s.verdict.padEnd(7)} ${s.who}`);
  const c = st.needsYou.counts;
  out.push(
    `needs you: ${c.decisions} decisions · ${c.actions} actions · ${c.approvals} approvals · ${c.reviews} reviews`,
  );
  for (const b of st.bottlenecks) out.push(`  - ${b}`);
  for (const e of st.builds?.errors || []) out.push(`store: ${e}`);
  return out.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`pipeline-status: ${e.message}`);
    process.exit(2);
  }
  let sources;
  if (args.sources) {
    sources = JSON.parse(readFileSync(resolve(args.sources), 'utf8'));
    if (args.now) sources.now = args.now;
    else if (!sources.now) sources.now = Date.now();
  } else {
    sources = readSources(repoName(), args.now || Date.now());
    if (args.store) sources.store = await readStore();
  }
  if (args.saveSources) {
    mkdirSync(dirname(resolve(args.saveSources)), {recursive: true});
    writeFileSync(resolve(args.saveSources), JSON.stringify(sources, null, 1));
  }
  const status = computeStatus(sources);
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), {recursive: true});
    writeFileSync(resolve(args.out), JSON.stringify(status, null, 2));
  }
  if (args.json) console.log(JSON.stringify(status, null, 2));
  else console.log(summary(status));
  if (args.upload) {
    await putSignalsJson('pipeline/status.json', status);
    await putSignalsJson(`pipeline/daily/${status.date}.json`, status);
    console.error(
      `uploaded pipeline/status.json and pipeline/daily/${status.date}.json`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(err => {
    console.error(`pipeline-status failed: ${err?.message || err}`);
    process.exit(1);
  });
}
