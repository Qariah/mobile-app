// @ai
//
// Signals snapshot section `failures`: each FAILURES row of the card section
// (journey failures and Sentry crashes) with the GitHub issues that track it,
// the builds that carry a fix, and whether a fix serves users in production.
//
// It reads ctx.sections.card.data (so it runs after `card`), the hand-kept
// ledger docs/operations/triage-state.md, and GitHub issue search (read-only,
// at most MAX_GH_CALLS calls).
//
// TRACKING (status)
//   crash row    the issues whose title or body names the Sentry short id
//                (QARIAHV2-20, a whole token). `primary` marks the issue that
//                sentry-triage.mjs filed for it ("[Sentry <id>]" title or the
//                sentry-triage-id:<id> marker).
//   journey row  the issues whose title or body names the same signature: the
//                row's failure kind ("never got in", "stuck on loading") AND
//                its build number. No such issue → 'untracked'.
//   'unknown'    the search failed, or the call cap was reached.
//
// FIX RECORD (fixedIn): every `fixed-in:<build>` label of those issues, plus
// the build that the triage-state ledger records for them ("Fixed in build").
// This is the record that scripts/prod-close.mjs and triage-lifecycle.mjs read.
//
// FIX IN PRODUCTION, for each platform of the row, over that platform's
// production builds (card.data.header.builds = active-rollout.json card.builds):
//   fix build F == production build P  → in   (P is build F; build-lines.mjs rule 3)
//   F > P                              → out  (prod-close.mjs: waits for the next promote)
//   F < P                              → the git release line decides
//                                        (scripts/lib/build-lines.mjs lineVerdict):
//                                        in when F's commit is an ancestor of P's,
//                                        out when it is on another line, unknown
//                                        when git cannot tell (a shallow clone)
// A platform is true when any (F, P) pair is in, null when none is in and any is
// unknown, else false. fixInProduction is true when every platform of the row
// is true, false when every platform is false or no fix is recorded, else null.
// Build numbers interleave across release lines (each line has its own
// VERSION_CODE_OFFSET), so "F < P" alone never counts as in production — the
// same rule that makes prod-close.mjs hold an issue it cannot place.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  gitBuildLines,
  lineVerdict,
  resolveProduction,
} from '../../lib/build-lines.mjs';
import {parseTriageState} from '../../lib/triage-taxonomy.mjs';

export const name = 'failures';
export const required = false;
export const after = ['card'];
export const MAX_GH_CALLS = 15;
export const MAX_ISSUES_PER_ROW = 10;
export const LEDGER = 'docs/operations/triage-state.md';

export const DEFINITION =
  'each FAILURES row of the card section with its GitHub issues. Crash row: the issues that name the Sentry short id (title or body, whole token). Journey row: the issues that name the failure kind and the build number; none → untracked. fixedIn = the fixed-in:<build> labels of those issues plus the triage-state ledger build. fixByPlatform: true when a fix build is a production build of that platform, or an ancestor of one on the git release line; false when every fix build is above or off the line of every production build; null when git cannot tell (a shallow clone). fixInProduction: true = every platform true; false = every platform false, or no fix recorded; null = not certain, or in production on some platforms only';

const C = {$ref: '#/$defs/cell'};
const obj = (props, req = Object.keys(props)) => ({
  type: 'object',
  required: req,
  additionalProperties: false,
  properties: props,
});
const tri = {type: ['boolean', 'null']};
const common = {
  status: {enum: ['tracked', 'untracked', 'unknown']},
  issues: {
    type: 'array',
    maxItems: MAX_ISSUES_PER_ROW,
    items: obj({
      number: {type: 'integer', minimum: 1},
      state: {enum: ['open', 'closed']},
      stateReason: {type: ['string', 'null']},
      fixedIn: {type: 'array', items: {type: 'string'}},
      primary: {type: 'boolean'},
    }),
  },
  fixedIn: {type: 'array', items: {type: 'string', pattern: '^\\d+$'}},
  fixByPlatform: obj({iOS: tri, Android: tri}, []),
  fixInProduction: tri,
};

export const schema = obj({
  definition: {type: 'string'},
  measuredAt: {type: 'string'},
  cardMeasuredAt: {type: ['string', 'null']},
  productionBuilds: {
    type: 'array',
    items: obj({platform: {type: 'string'}, build: {type: 'string'}}),
  },
  githubCalls: {type: 'integer', minimum: 0, maximum: MAX_GH_CALLS},
  rows: {
    type: 'array',
    items: {
      anyOf: [
        obj({
          kind: {const: 'crash'},
          id: {type: 'string'},
          title: {type: 'string'},
          users: C,
          builds: {type: 'array', items: {type: 'string'}},
          ...common,
        }),
        obj({
          kind: {const: 'journey'},
          what: {type: 'string'},
          platform: {type: 'string'},
          build: {type: 'string'},
          installs: C,
          ...common,
        }),
      ],
    },
  },
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FIXED_IN = /^fixed-in:(\d+)$/;

/** Does the text name the Sentry short id as a whole token? */
export const namesId = (text, id) =>
  new RegExp(`(?<![A-Z0-9-])${escapeRe(id)}(?![A-Z0-9])`).test(
    String(text || ''),
  );

/** Does the text name the journey signature: the kind phrase and the build? */
export const namesSignature = (text, what, build) =>
  String(text || '')
    .toLowerCase()
    .includes(String(what).toLowerCase()) &&
  new RegExp(`(?<!\\d)${escapeRe(build)}(?!\\d)`).test(String(text || ''));

/** A search hit → the issue record (no title or body is kept). */
export function issueRecord(item, {id = null, ledger = new Map()} = {}) {
  const labels = (item.labels || []).map(l =>
    typeof l === 'string' ? l : l.name,
  );
  const fixed = labels.map(l => (l.match(FIXED_IN) || [])[1]).filter(Boolean);
  const led = ledger.get(Number(item.number));
  if (led && /^\d+$/.test(led)) fixed.push(led);
  return {
    number: Number(item.number),
    state: item.state === 'closed' ? 'closed' : 'open',
    stateReason: item.state_reason ? String(item.state_reason) : null,
    fixedIn: [...new Set(fixed)].sort((a, b) => a - b),
    primary:
      !!id &&
      (String(item.title || '').startsWith(`[Sentry ${id}]`) ||
        namesId(
          String(item.body || '')
            .match(/sentry-triage-id:\S+/g)
            ?.join(' '),
          id,
        )),
  };
}

const order = (a, b) =>
  Number(b.primary) - Number(a.primary) ||
  Number(a.state === 'closed') - Number(b.state === 'closed') ||
  b.number - a.number;

/**
 * The fix verdict of one platform.
 * @param {string[]} fixedIn fix builds
 * @param {string[]} prodBuilds the production builds of that platform
 * @param {(f:number, p:number) => 'in'|'out'|'unknown'} line for F < P only
 * @returns {true|false|null}
 */
export function platformVerdict(fixedIn, prodBuilds, line) {
  let unknown = false;
  for (const f of fixedIn.map(Number))
    for (const p of prodBuilds.map(Number)) {
      const s = f === p ? 'in' : f > p ? 'out' : line(f, p);
      if (s === 'in') return true;
      if (s === 'unknown') unknown = true;
    }
  return unknown ? null : false;
}

/** fixByPlatform + fixInProduction for one row. */
export function fixVerdict(fixedIn, platforms, production, line) {
  if (!fixedIn.length) return {fixByPlatform: {}, fixInProduction: false};
  const byPlatform = {};
  for (const p of platforms)
    byPlatform[p] = platformVerdict(
      fixedIn,
      production.filter(b => b.platform === p).map(b => b.build),
      line,
    );
  const vals = Object.values(byPlatform);
  const all = v => vals.length > 0 && vals.every(x => x === v);
  return {
    fixByPlatform: byPlatform,
    fixInProduction: all(true) ? true : all(false) ? false : null,
  };
}

/** The platforms of a crash row: those of its builds; else every production platform. */
export function crashPlatforms(builds, production) {
  const ps = new Set(
    production.filter(b => builds.includes(b.build)).map(b => b.platform),
  );
  if (!ps.size) production.forEach(b => ps.add(b.platform));
  return ['iOS', 'Android'].filter(p => ps.has(p));
}

/**
 * Build every row. `search(q)` returns the search items or throws; it is
 * called at most once for each distinct query, and at most `maxCalls` times.
 */
export function buildRows(
  card,
  {search, ledger = new Map(), line, maxCalls = MAX_GH_CALLS},
) {
  const production = (card.header?.builds || []).map(b => ({
    platform: String(b.platform),
    build: String(b.build),
  }));
  const cache = new Map();
  let calls = 0;
  const notes = [];
  const lookup = q => {
    if (cache.has(q)) return cache.get(q);
    if (calls >= maxCalls) {
      const r = {error: `GitHub call cap (${maxCalls}) reached`};
      cache.set(q, r);
      return r;
    }
    calls++;
    let r;
    try {
      r = {items: search(q) || []};
    } catch (e) {
      // A fixed text: a gh error can quote the request or the response.
      r = {error: `GitHub search failed${e?.notFound ? ' (HTTP 404)' : ''}`};
    }
    cache.set(q, r);
    return r;
  };
  const finish = (row, hits, platforms) => {
    if (hits.error) {
      notes.push(
        `${row.kind === 'crash' ? row.id : `${row.what} b${row.build}`}: ${hits.error}`,
      );
      return {
        ...row,
        status: 'unknown',
        issues: [],
        fixedIn: [],
        fixByPlatform: {},
        fixInProduction: null,
      };
    }
    const issues = hits.items.sort(order).slice(0, MAX_ISSUES_PER_ROW);
    const fixedIn = [...new Set(issues.flatMap(i => i.fixedIn))].sort(
      (a, b) => a - b,
    );
    return {
      ...row,
      status: issues.length ? 'tracked' : 'untracked',
      issues,
      fixedIn,
      ...fixVerdict(fixedIn, platforms, production, line),
    };
  };

  const rows = [];
  for (const c of card.crashes || []) {
    const row = {
      kind: 'crash',
      id: c.id,
      title: c.title,
      users: c.users,
      builds: c.builds,
    };
    const r = lookup(`"${c.id}"`);
    const hits = r.error
      ? r
      : {
          items: r.items
            .filter(i => namesId(`${i.title || ''}\n${i.body || ''}`, c.id))
            .map(i => issueRecord(i, {id: c.id, ledger})),
        };
    rows.push(finish(row, hits, crashPlatforms(c.builds, production)));
  }
  for (const f of card.failures || []) {
    const row = {
      kind: 'journey',
      what: f.what,
      platform: f.platform,
      build: f.build,
      installs: f.installs,
    };
    const r = lookup(`"${f.what}"`);
    const hits = r.error
      ? r
      : {
          items: r.items
            .filter(i =>
              namesSignature(
                `${i.title || ''}\n${i.body || ''}`,
                f.what,
                f.build,
              ),
            )
            .map(i => issueRecord(i, {ledger})),
        };
    const platforms = ['iOS', 'Android'].includes(f.platform)
      ? [f.platform]
      : ['iOS', 'Android'];
    rows.push(finish(row, hits, platforms));
  }
  return {rows, calls, notes, production};
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** F < P: the git release line (build-lines.mjs). Memoised; git runs lazily. */
export function lineChecker(makeLines, cfg) {
  let lines = null;
  const prod = new Map();
  const memo = new Map();
  return (f, p) => {
    const key = `${f}<${p}`;
    if (memo.has(key)) return memo.get(key);
    let state = 'unknown';
    try {
      lines ||= makeLines();
      if (!prod.has(p))
        prod.set(
          p,
          resolveProduction(
            {build: p, sha: Number(cfg?.build) === p ? cfg?.sha : null},
            lines,
          ),
        );
      const pr = prod.get(p);
      state = lineVerdict({
        fixBuild: f,
        prod: pr,
        candidates: pr.commit ? lines.candidates(f) : null,
        indexError: lines.indexError,
        isAncestor: (a, b) => lines.isAncestor(a, b),
      }).state;
    } catch {
      state = 'unknown';
    }
    memo.set(key, state);
    return state;
  };
}

function readLedger(root) {
  try {
    return parseTriageState(readFileSync(resolve(root, LEDGER), 'utf8'))
      .fixedInBuild;
  } catch {
    return new Map();
  }
}

export async function collect(ctx) {
  const source =
    'card section + GitHub issue search + docs/operations/triage-state.md';
  const card = ctx.sections?.card;
  if (!card?.data)
    return {
      status: 'error',
      source,
      data: null,
      error: `the card section has no data (status ${card?.status || 'missing'})`,
    };
  const repo = ctx.env?.GH_REPO || 'omar-zarka/qariah-v2';
  const search = q =>
    ctx.gh('search/issues', {
      query: {q: `repo:${repo} is:issue ${q} in:title,body`, per_page: 30},
    })?.items || [];
  const line = lineChecker(
    ctx.buildLines || (() => gitBuildLines({cwd: ctx.root})),
    ctx.cfg,
  );
  const measuredAt = new Date().toISOString();
  const {rows, calls, notes, production} = buildRows(card.data, {
    search,
    ledger: readLedger(ctx.root || '.'),
    line,
  });
  if (card.data.crashes === null)
    notes.push('crash rows not checked: the card has no Sentry data');
  else if ((card.notes || []).some(n => /Sentry request\(s\) failed/.test(n)))
    notes.push(
      'crash rows may be incomplete: the card says that Sentry requests failed',
    );
  return {
    status: notes.length ? 'partial' : 'ok',
    source,
    data: {
      definition: DEFINITION,
      // The card rows are from card.header.measuredAt; the GitHub issue state
      // and the release line are read now.
      measuredAt,
      cardMeasuredAt: card.data.header?.measuredAt ?? null,
      productionBuilds: production,
      githubCalls: calls,
      rows,
    },
    ...(notes.length ? {notes} : {}),
  };
}
