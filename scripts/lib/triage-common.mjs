// @ai
//
// scripts/lib/triage-common.mjs
// -----------------------------
// Shared GitHub-issue plumbing for the user-voice triage bots
// (appstore-reviews / testflight-feedback / play-reviews). The risky parts —
// dedup against already-filed issues, label creation, volume cap, CI output —
// live here so all three lanes behave identically and a first run can't flood
// the tracker. Each lane keeps its own source-specific fetch + classify code.
//
// Dedup is by an embedded HTML marker comment in the issue body, e.g.
//   <!-- play-review-id:gp:AOq... -->
// listing is scoped to the lane's primary label, and the marker prefix is
// matched exactly, so lanes that share a label (play-reviews + play-vitals both
// use `play-store`) never dedup against each other's markers.

import {execFileSync} from 'node:child_process';
import {existsSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

export function gh(args, {input} = {}) {
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

// ---------------------------------------------------------------------------
// GitHub REST. Every issue and pull-request call in the triage path goes
// through these helpers, never through `gh issue|pr list|view|edit|...`.
// Those `gh` subcommands use GraphQL, and the Claude Cloud GitHub proxy
// refuses GraphQL outside a small pull-request set
// (https://code.claude.com/docs/en/cloud-environments, "GitHub proxy").
// `gh api repos/...` is REST, so it works on the Mac, in GitHub Actions and
// in a cloud session (where GH_TOKEN reads `proxy-injected`).
//
// Note: the REST `issues` endpoints return pull requests too. listIssues()
// removes them.

// Pagination is done by hand, never with `gh api --paginate`. `--paginate`
// follows GitHub's `Link` headers, and those point at
// `repositories/{id}/...` URLs. The Claude Cloud GitHub proxy refuses every
// `repositories/{id}/...` path ("Numeric-ID repository paths ... are not
// supported through this proxy", HTTP 403), so each paginated call failed in
// the cloud (first shadow run, 2026-09-27). Each page here is a new request to
// the same `repos/{owner}/{repo}/...` path with `per_page=100&page=N`.
export const PAGE_SIZE = 100;
export const MAX_PAGES = 50;

/**
 * Read pages until a page has fewer than `perPage` items.
 * @param {(page:number) => any} fetchPage  returns the parsed page (an array)
 * @param {{perPage?:number, maxPages?:number, what?:string}} [o]
 * @returns {any[]} the items of every page, in order
 * @throws when a page is not an array, or when `maxPages` full pages arrive
 *   (the result would be incomplete, so the caller must not use it)
 */
export function collectPages(fetchPage, o = {}) {
  const perPage = o.perPage || PAGE_SIZE;
  const maxPages = o.maxPages || MAX_PAGES;
  const what = o.what || 'the list';
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = fetchPage(page);
    if (!Array.isArray(rows))
      throw new Error(`${what}: page ${page} is not a JSON array`);
    all.push(...rows);
    if (rows.length < perPage) return all;
  }
  throw new Error(
    `${what}: stopped after ${maxPages} full pages (${maxPages * perPage} items); the list is incomplete, so it was not used`,
  );
}

function ghOnce(method, path, query, o) {
  const a = ['api', '-X', method, path];
  for (const [k, v] of Object.entries(query || {})) a.push('-f', `${k}=${v}`);
  if (o.body !== undefined) a.push('--input', '-');
  let out;
  try {
    out = execFileSync('gh', a, {
      encoding: 'utf8',
      input: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: o.timeout || 120000,
    }).trim();
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    const err = new Error(
      `gh api ${method} ${path} failed: ${msg.slice(0, 400)}`,
    );
    err.notFound = /HTTP 404/.test(msg);
    throw err;
  }
  return out ? JSON.parse(out) : null;
}

/**
 * One REST call through `gh api`.
 * @param {string} path  e.g. `repos/${GH_REPO}/issues`
 * @param {{method?:string, query?:Record<string,string|number>, body?:object,
 *   paginate?:boolean, timeout?:number}} [o]
 *   query    — sent as URL parameters (GET only)
 *   body     — sent as the JSON request body (POST, PATCH, PUT, DELETE)
 *   paginate — read every page (100 items each, see collectPages); the
 *              response must be an array
 * @returns {any} the parsed JSON (an array when paginate), or null when empty
 */
export function ghApi(path, o = {}) {
  const method = o.method || 'GET';
  if (!o.paginate) return ghOnce(method, path, o.query, o);
  return collectPages(
    page =>
      ghOnce(method, path, {...o.query, per_page: PAGE_SIZE, page}, o) || [],
    {what: `gh api ${method} ${path}`},
  );
}

/**
 * Shadow mode (the first week of the cloud routine, planning/claude-cloud-
 * migration-plan.md §12 Phase 1 step 5): the run must write nothing on GitHub
 * except its card on the "Daily card (shadow)" issue. `bash scripts/run-start.sh
 * triage --shadow` writes the marker <repo root>/.claude/.shadow-run, and
 * `run-end.sh` removes it. QARIAH_SHADOW=1 does the same for one command.
 * Every write helper below refuses to write while shadow mode is on.
 */
export const SHADOW_CARD_TITLE = 'Daily card (shadow)';
export const DAILY_CARD_TITLE = 'Daily card';

let repoRootCache;
function repoRoot() {
  if (repoRootCache !== undefined) return repoRootCache;
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
    ).trim();
    repoRootCache = dirname(common);
  } catch {
    repoRootCache = join(here, '..', '..');
  }
  return repoRootCache;
}

export function isShadowRun() {
  return (
    process.env.QARIAH_SHADOW === '1' ||
    existsSync(join(repoRoot(), '.claude', '.shadow-run'))
  );
}

/** True in a Claude Cloud session. Skip local-only files (build/*) there. */
export function isCloudSession() {
  return process.env.CLAUDE_CODE_REMOTE === 'true';
}

function guardWrite(what, {allowInShadow = false} = {}) {
  if (isShadowRun() && !allowInShadow)
    throw new Error(
      `SHADOW: refused to ${what} (shadow mode writes only the "${SHADOW_CARD_TITLE}" card)`,
    );
}

// gh-CLI-like shape, so callers that read `labels[].name`, `url` and
// `comments[].body` work unchanged.
function slimIssue(i) {
  return {
    number: i.number,
    title: i.title || '',
    body: i.body || '',
    state: i.state,
    url: i.html_url,
    labels: (i.labels || []).map(l =>
      typeof l === 'string' ? {name: l} : {name: l.name},
    ),
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    closedAt: i.closed_at,
  };
}

/**
 * List issues (never pull requests), newest first — the order of
 * `gh issue list`.
 * @param {{state?:'open'|'closed'|'all', labels?:string|string[], limit?:number,
 *   since?:string}} [o] labels are ANDed, like `gh issue list --label a --label b`
 */
export function listIssues(o = {}) {
  const query = {state: o.state || 'open', per_page: 100};
  const labels = [].concat(o.labels || []).filter(Boolean);
  if (labels.length) query.labels = labels.join(',');
  if (o.since) query.since = o.since;
  const rows = ghApi(`repos/${GH_REPO}/issues`, {query, paginate: true})
    .filter(i => !i.pull_request)
    .map(slimIssue);
  return o.limit ? rows.slice(0, o.limit) : rows;
}

/** One issue; with {comments:true} also its comments (oldest first). */
export function getIssue(n, {comments = false} = {}) {
  const issue = slimIssue(ghApi(`repos/${GH_REPO}/issues/${n}`));
  if (comments)
    issue.comments = ghApi(`repos/${GH_REPO}/issues/${n}/comments`, {
      query: {per_page: 100},
      paginate: true,
    }).map(c => ({
      id: c.id,
      body: c.body || '',
      url: c.html_url,
      createdAt: c.created_at,
      author: {login: c.user && c.user.login},
    }));
  return issue;
}

/** @returns {string} the comment URL */
export function commentOnIssue(n, body, opts) {
  guardWrite(`comment on #${n}`, opts);
  return ghApi(`repos/${GH_REPO}/issues/${n}/comments`, {
    method: 'POST',
    body: {body},
  }).html_url;
}

export function addIssueLabels(n, labels) {
  guardWrite(`label #${n}`);
  ghApi(`repos/${GH_REPO}/issues/${n}/labels`, {
    method: 'POST',
    body: {labels: [].concat(labels)},
  });
}

/** Like `gh issue edit --remove-label`: a label the issue lacks is not an error. */
export function removeIssueLabel(n, label) {
  guardWrite(`unlabel #${n}`);
  try {
    ghApi(`repos/${GH_REPO}/issues/${n}/labels/${encodeURIComponent(label)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    if (!e.notFound) throw e;
  }
}

/** Like `gh issue close --reason <r> --comment <c>`: the comment first, then the close. */
export function closeIssue(n, {reason = 'completed', comment} = {}) {
  guardWrite(`close #${n}`);
  if (comment) commentOnIssue(n, comment);
  ghApi(`repos/${GH_REPO}/issues/${n}`, {
    method: 'PATCH',
    body: {
      state: 'closed',
      state_reason: reason === 'not planned' ? 'not_planned' : reason,
    },
  });
}

/** @returns {{number:number, url:string}} */
export function createIssue({title, body, labels = [], assignees}, opts) {
  guardWrite(`create issue "${title}"`, opts);
  const i = ghApi(`repos/${GH_REPO}/issues`, {
    method: 'POST',
    body: {title, body, labels, ...(assignees ? {assignees} : {})},
  });
  return {number: i.number, url: i.html_url};
}

export function updateIssue(n, fields, opts) {
  guardWrite(`edit #${n}`, opts);
  ghApi(`repos/${GH_REPO}/issues/${n}`, {method: 'PATCH', body: fields});
}

/** Like `gh label create --force`: create the label, or update its colour. */
export function upsertLabel(name, color, description, opts) {
  guardWrite(`create label ${name}`, opts);
  const body = {color, ...(description ? {description} : {})};
  try {
    ghApi(`repos/${GH_REPO}/labels`, {method: 'POST', body: {name, ...body}});
  } catch {
    ghApi(`repos/${GH_REPO}/labels/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body,
    });
  }
}

/**
 * Pin an issue. GitHub has no REST call for this, only GraphQL, so it fails in
 * a cloud session. Best effort: returns false on failure, never throws.
 */
export function pinIssue(n, opts) {
  guardWrite(`pin #${n}`, opts);
  try {
    gh(['issue', 'pin', String(n), '--repo', GH_REPO]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the open issue with this exact title and label, or create it (and try
 * to pin it). The card issues ("Daily card", "Daily card (shadow)") use this.
 * @returns {{number:number, url:string, created:boolean, pinned?:boolean}}
 */
export function findOrCreateIssue(
  {title, label, body, color = '5319e7'},
  opts,
) {
  const hit = listIssues({state: 'open', labels: label}).find(
    i => i.title === title,
  );
  if (hit) return {number: hit.number, url: hit.url, created: false};
  try {
    upsertLabel(label, color, undefined, opts);
  } catch {
    /* the label exists, or a race — the create below says if it matters */
  }
  const made = createIssue({title, body, labels: [label]}, opts);
  return {...made, created: true, pinned: pinIssue(made.number, opts)};
}

/**
 * Open pull requests with the fields the card needs. REST has no
 * `statusCheckRollup`, so the checks come from the head commit: the latest
 * check runs plus the commit statuses (the same two sources GraphQL rolls
 * up). `mergeable` maps REST false → 'CONFLICTING', true → 'MERGEABLE',
 * null → 'UNKNOWN', like GraphQL.
 * @param {{limit?:number, filter?:(pr:object)=>boolean}} [o] filter runs on the
 *   list row BEFORE the per-PR calls, so only the PRs you keep cost calls.
 */
export function listOpenPulls(o = {}) {
  const rows = ghApi(`repos/${GH_REPO}/pulls`, {
    query: {state: 'open', per_page: 100},
    paginate: true,
  })
    .slice(0, o.limit || 60)
    .map(p => ({
      number: p.number,
      title: p.title || '',
      headRefName: p.head && p.head.ref,
      headSha: p.head && p.head.sha,
      isDraft: !!p.draft,
      labels: (p.labels || []).map(l => ({name: l.name})),
    }));
  const kept = o.filter ? rows.filter(o.filter) : rows;
  for (const r of kept) {
    const pr = ghApi(`repos/${GH_REPO}/pulls/${r.number}`);
    r.mergeable =
      pr.mergeable === false
        ? 'CONFLICTING'
        : pr.mergeable === true
          ? 'MERGEABLE'
          : 'UNKNOWN';
    const runs =
      (
        ghApi(`repos/${GH_REPO}/commits/${r.headSha}/check-runs`, {
          query: {per_page: 100},
        }) || {}
      ).check_runs || [];
    const statuses =
      (ghApi(`repos/${GH_REPO}/commits/${r.headSha}/status`) || {}).statuses ||
      [];
    r.statusCheckRollup = [
      ...runs.map(c => ({
        name: c.name,
        status: String(c.status || '').toUpperCase(),
        conclusion: String(c.conclusion || '').toUpperCase(),
        detailsUrl: c.details_url,
      })),
      ...statuses.map(s => ({
        context: s.context,
        state: String(s.state || '').toUpperCase(),
        targetUrl: s.target_url,
      })),
    ];
  }
  return kept;
}

// The colour of each label a triage lane creates. A label that is not here gets
// grey (`ededed`). The telemetry lanes (sentry-triage, posthog-triage,
// play-vitals-triage) kept their own copy of this table until TECH_DEBT #246.
export const PALETTE = {
  'app-store': '999999',
  'play-store': '3ddc84',
  testflight: '0d96f2',
  'user-review': '5319e7',
  feedback: '1d76db',
  enhancement: 'a2eeef',
  bug: 'd73a4a',
  crash: 'b60205',
  anr: 'd93f0b',
  sentry: '5319e7',
  posthog: '1d4aff',
  investigate: '0e8a16',
  regression: 'b60205',
  'user-impacting': 'e11d21',
  'severity:critical': 'b60205',
  'severity:high': 'd93f0b',
  'severity:medium': 'fbca04',
  'severity:low': 'c2e0c6',
  ios: 'a2d2ff',
  android: '3ddc84',
};

export function ensureLabels(labels, dryRun) {
  if (dryRun) return;
  for (const l of labels) {
    try {
      upsertLabel(l, PALETTE[l] || 'ededed');
    } catch {
      /* label exists / race — fine */
    }
  }
}

// The issues a lane has filed so far (every state, newest first, up to `limit`),
// for dedup. The lane's primary label scopes the listing.
// In --dry-run a listing failure is non-fatal (we file nothing anyway) and the
// result is []; in a real run we refuse to file without a working dedup check
// (never double-file).
export function listLaneIssues(label, {dryRun, limit = 800} = {}) {
  ensureLabels([label], dryRun);
  try {
    return listIssues({state: 'all', labels: label, limit});
  } catch (e) {
    console.warn(
      `  ⚠ could not list existing GitHub issues for dedup: ${e.message}`,
    );
    if (!dryRun) {
      console.error('  refusing to file without a working dedup check.');
      process.exit(1);
    }
    return [];
  }
}

// Every ID that follows `markerPrefix` (e.g. 'play-review-id:') in the title or
// body of these issues. The prefix is matched exactly. Returns a Set.
export function markersIn(issues, markerPrefix) {
  const set = new Set();
  const re = new RegExp(
    markerPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\s>]+)',
    'g',
  );
  for (const e of issues) {
    const blob = `${e.title}\n${e.body || ''}`;
    let m;
    while ((m = re.exec(blob))) set.add(m[1]);
  }
  return set;
}

// Return a Set of already-filed marker IDs for a lane.
//   label        — the lane's primary GitHub label (scopes the listing)
//   markerPrefix — e.g. 'play-review-id:' (matched exactly inside the body)
// A lane that reads two markers lists the issues once with listLaneIssues()
// and calls markersIn() for each prefix.
export function existingMarkers(label, markerPrefix, {dryRun} = {}) {
  return markersIn(listLaneIssues(label, {dryRun}), markerPrefix);
}

// One-line-safe GitHub issue title (no newlines, capped at 140 chars).
export function ghTitle(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 140);
}

export function firstWords(s, n = 9) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, n)
    .join(' ');
}

// items: [{ id, title, body, labels: [] }]
export function fileIssues(items, {dryRun}) {
  let filed = 0;
  for (const it of items) {
    if (dryRun) {
      console.log('\n' + '─'.repeat(72));
      console.log(`WOULD FILE: ${it.title}`);
      console.log(`  labels: ${it.labels.join(', ')}`);
      console.log(
        it.body
          .split('\n')
          .map(l => '  ' + l)
          .join('\n'),
      );
      filed++;
      continue;
    }
    ensureLabels(it.labels, false);
    const {url} = createIssue({
      title: it.title,
      body: it.body,
      labels: it.labels,
    });
    console.log(`  ✅ filed → ${url}`);
    filed++;
  }
  return filed;
}

export function emitOutput({filed, fresh, deferred = 0, dryRun}) {
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      // In --dry-run nothing was actually filed, so report 0.
      `filed=${dryRun ? 0 : filed}\nnew=${fresh}\ndeferred=${deferred}\n`,
      {flag: 'a'},
    );
  }
}

export function parseArgs(argv) {
  const a = {dryRun: false, max: 15, help: false};
  for (const x of argv.slice(2)) {
    if (x === '--dry-run') a.dryRun = true;
    else if (x.startsWith('--max=')) a.max = parseInt(x.slice(6), 10) || a.max;
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

// Feature-request vs bug heuristic for a star-review body. Conservative: only
// trips `enhancement` when an explicit ask is present (so praise stays a bug-or-
// nothing). Includes a few non-English cues (the catalog is multilingual).
const FEATURE_RE =
  /\b(please add|add (a |an |the )?(option|feature|ability)|would (be |)?(nice|love|like)|wish|feature request|option to|ability to|can you (add|make|please)|it would help|suggest|deber[ií]an?|porfa|por favor|opci[oó]n|ميزة|إضافة)\b/i;
export function looksLikeFeatureRequest(text) {
  return FEATURE_RE.test(String(text || ''));
}

export function severityForRating(rating) {
  return rating <= 1
    ? 'critical'
    : rating === 2
      ? 'high'
      : rating === 3
        ? 'medium'
        : 'low';
}
