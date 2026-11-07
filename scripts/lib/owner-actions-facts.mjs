// @ai
//
// scripts/lib/owner-actions-facts.mjs
// -----------------------------------
// The live reads behind scripts/lib/owner-actions.mjs. Each fact is read at
// most once for each run (memoized), and only when a due item needs it.
//
// GitHub is read over REST only (`ghApi`, manual pages): the Claude Cloud
// GitHub proxy refuses GraphQL, `--paginate` and every path outside `repos/`.
// So this works on the Mac and in a cloud session (CLAUDE_CODE_REMOTE=true).
// The Mac-only facts (disk, ~/.claude/settings.json, and `actions/runners`,
// which the proxy refuses with HTTP 403) are never asked for in the cloud:
// the evaluator skips a `macOnly` check there.

import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  applyOwnerReplies,
  ownerOf,
  parseOwnerReplies,
} from './owner-replies.mjs';
import {shallowWatchBuilds} from './release-watch.mjs';
import {
  DAILY_CARD_TITLE,
  GH_REPO,
  SHADOW_CARD_TITLE,
  ghApi,
  listIssues,
} from './triage-common.mjs';
import {parseTriageState} from './triage-taxonomy.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIST_PATH = join(ROOT, 'docs/operations/owner-actions.json');
const POLICY_PATH = join(ROOT, 'docs/operations/auto-sprint-policy.json');
const ROLLOUT_PATH = join(ROOT, 'docs/operations/active-rollout.json');
const LEDGER_PATH = join(ROOT, 'docs/operations/triage-state.md');

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

/** docs/operations/owner-actions.json, or null when it is missing. */
export function loadOwnerActions() {
  return existsSync(LIST_PATH) ? readJson(LIST_PATH) : null;
}

/** The open `Daily card` issue (label `ops`), or null. */
export function dailyCardIssue() {
  return (
    listIssues({state: 'open', labels: 'ops'}).find(
      i => i.title === DAILY_CARD_TITLE,
    ) || null
  );
}

/**
 * The open `Daily card` issue and Omar's `owner-reply:` comments on it, oldest
 * first (scripts/lib/owner-replies.mjs). Every comment is read: a reply
 * effect lasts until a session writes it into the JSON file.
 */
export function readOwnerReplies() {
  const issue = dailyCardIssue();
  if (!issue) return {issue: null, replies: []};
  const comments = ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
    query: {per_page: 100},
    paginate: true,
  });
  return {
    issue,
    replies: parseOwnerReplies(comments, {owner: ownerOf(GH_REPO)}),
  };
}

/**
 * docs/operations/owner-actions.json with the effects of Omar's reply phrases
 * applied (scripts/lib/owner-replies.mjs). A failed read keeps the file as it
 * is and returns `repliesError`, so the caller can say so.
 * → {list, applied, repliesError?}; list is null when the file is missing.
 */
export function loadOwnerActionsWithReplies({read = readOwnerReplies} = {}) {
  const list = loadOwnerActions();
  if (!list) return {list: null, applied: []};
  try {
    return applyOwnerReplies(list, read().replies);
  } catch (e) {
    return {
      list,
      applied: [],
      repliesError: String(e.message || e).slice(0, 100),
    };
  }
}

/** The builds the owner said fix nothing (the unclaimed-builds item). */
export function noFixBuildsOf(list) {
  const item = ((list && list.items) || []).find(
    i => i.check === 'unclaimed-builds',
  );
  return ((item && item.noFixBuilds) || []).map(String);
}

/** How many issues (any state) carry `fixed-in:<build>`: 0 or 1 (page of 1). */
export function fixedInLabelled(build) {
  const rows = ghApi(`repos/${GH_REPO}/issues`, {
    query: {labels: `fixed-in:${build}`, state: 'all', per_page: 1},
    timeout: 30000,
  });
  return Array.isArray(rows) ? rows.length : 0;
}

/** The builds of the "Fixed in build" rows in docs/operations/triage-state.md. */
export function ledgerBuilds() {
  try {
    return [
      ...parseTriageState(
        readFileSync(LEDGER_PATH, 'utf8'),
      ).fixedInBuild.values(),
    ].map(String);
  } catch {
    return [];
  }
}

function cardIssueComments(title) {
  const issue = listIssues({state: 'open', labels: 'ops'}).find(
    i => i.title === title,
  );
  if (!issue) return [];
  return ghApi(`repos/${GH_REPO}/issues/${issue.number}/comments`, {
    query: {per_page: 100},
    paginate: true,
  }).map(c => ({body: c.body || '', createdAt: c.created_at}));
}

// A loop draft, by the rule of docs/operations/auto-sprint-policy.json → adopt:
// the label OR a branch pattern, and no exclude pattern.
function isLoopDraft(pr, adopt) {
  const ref = (pr.head && pr.head.ref) || '';
  const labelled = (pr.labels || []).some(l => l.name === adopt.label);
  const branch = (adopt.branchPatterns || []).some(p =>
    new RegExp(p).test(ref),
  );
  const excluded = (adopt.excludeBranchPatterns || []).some(p =>
    new RegExp(p).test(ref),
  );
  return (labelled || branch) && !excluded;
}

function freeGB() {
  const out = execFileSync('df', ['-k', homedir()], {encoding: 'utf8'});
  const cols = out.trim().split('\n')[1].trim().split(/\s+/);
  const kb = Number(cols[3]);
  if (!Number.isFinite(kb)) throw new Error('df gave no free size');
  return Math.floor(kb / 1024 / 1024);
}

function userGuardBlock() {
  const p = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(p)) return false;
  const hooks = (readJson(p).hooks || {}).PreToolUse || [];
  return hooks.some(h =>
    (h.hooks || []).some(x => /qariah-publish-guard/.test(x.command || '')),
  );
}

/**
 * The `facts(name, item)` function for evaluateOwnerActions().
 * @param {object} list  the owner-actions file (for noFixBuilds)
 */
export const SHARE_PROBE_URL = 'https://app.qariah.app/reciter/maryam-amir';

export function makeFacts(list) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) {
      try {
        memo.set(key, {v: fn()});
      } catch (e) {
        memo.set(key, {e});
      }
    }
    const m = memo.get(key);
    if (m.e) throw m.e;
    return m.v;
  };

  const readers = {
    policy: () => once('policy', () => readJson(POLICY_PATH)),
    // Both card issues: the cloud card is on "Daily card (shadow)" before
    // the cutover and on "Daily card" after it.
    cardComments: () =>
      once('cardComments', () => [
        ...cardIssueComments(SHADOW_CARD_TITLE),
        ...cardIssueComments(DAILY_CARD_TITLE),
      ]),
    shadowComments: () =>
      once('shadowComments', () => cardIssueComments(SHADOW_CARD_TITLE)),
    // One rule on both hosts: the rollout file decides which builds count
    // (scripts/lib/release-watch.mjs, shallowWatchBuilds), so the Mac and
    // the cloud ask about the same builds.
    watchBuilds: () =>
      once('watchBuilds', () => {
        const candidates = shallowWatchBuilds(readJson(ROLLOUT_PATH));
        if (!candidates)
          throw new Error(
            'active-rollout.json does not give both production builds',
          );
        const ledger = ledgerBuilds();
        const skip = new Set([...ledger, ...noFixBuildsOf(list)]);
        const labelled = {};
        for (const b of candidates)
          if (!skip.has(b)) labelled[b] = fixedInLabelled(b);
        return {candidates, ledgerBuilds: ledger, labelled};
      }),
    pr: item =>
      once(`pr:${item.pr}`, () => {
        const p = ghApi(`repos/${GH_REPO}/pulls/${item.pr}`);
        return {state: p.state, merged: !!p.merged};
      }),
    runners: () =>
      once('runners', () =>
        (
          (
            ghApi(`repos/${GH_REPO}/actions/runners`, {
              query: {per_page: 100},
            }) || {}
          ).runners || []
        ).map(r => r.name),
      ),
    branchExists: item =>
      once(`branch:${item.branch}`, () => {
        try {
          ghApi(`repos/${GH_REPO}/branches/${item.branch}`);
          return true;
        } catch (e) {
          if (e.notFound) return false;
          throw e;
        }
      }),
    diskFreeGB: () => once('disk', freeGB),
    loopDrafts: () =>
      once('loopDrafts', () => {
        const adopt = readers.policy().adopt || {};
        return ghApi(`repos/${GH_REPO}/pulls`, {
          query: {state: 'open', per_page: 100},
          paginate: true,
        }).filter(p => isLoopDraft(p, adopt)).length;
      }),
    // The old share host. A timeout or a refused connection is code 0.
    // `proxy` is the HTTP status of the CONNECT answer (0 without a proxy).
    // A non-200 there means a proxy refused the tunnel (the Claude Cloud
    // egress proxy answers 403 for hosts off its allowlist), so the request
    // never reached the host and says nothing about it.
    shareRedirect: () =>
      once('share', () => {
        const r = spawnSync(
          'curl',
          [
            '-s',
            '-4',
            '-m',
            '15',
            '-o',
            '/dev/null',
            '-w',
            '%{http_code} %{http_connect} %{redirect_url}',
            SHARE_PROBE_URL,
          ],
          {encoding: 'utf8'},
        );
        const [code = '0', proxy = '0', location = ''] = (r.stdout || '')
          .trim()
          .split(' ');
        return {code: Number(code) || 0, proxy: Number(proxy) || 0, location};
      }),
    userGuardBlock: () => once('guard', userGuardBlock),
  };

  return (name, item) => {
    const r = readers[name];
    if (!r) throw new Error(`unknown fact "${name}"`);
    return r(item);
  };
}
