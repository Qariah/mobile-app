// @ai
//
// scripts/lib/owner-actions.mjs
// -----------------------------
// The pure decision logic of scripts/owner-actions.mjs: the owner's next steps
// of the Claude Cloud migration (docs/operations/owner-actions.json).
//
// No I/O here. The caller injects `facts(name, item)`, a function that reads
// one live fact (a GitHub read, a file, the disk) or throws. So
// scripts/__tests__/owner-actions.test.mjs covers every rule with fixtures.
//
// Each item gets exactly one state:
//   not-due      notBefore is in the future              → prints nothing
//   blocked      an item in `after` is not done yet       → prints nothing
//   skip         not in this run (--only=mac)             → prints nothing
//   mac-only     a due Mac-only check in a cloud session  → one `MAC ONLY · ...`
//                line that names every such item: the cloud cannot read them
//   done         the check found the step done, or the
//                item has `closedOn` (finished for good)  → prints nothing
//   needs-you    Omar must act; `lines` holds the prompts → `NEEDS YOU · ...`
//   waiting      due, but the next move is not Omar's     → `WAITING · ...`
//   not-checked  a fact could not be read                 → `NOT CHECKED · ...`
//
// The rules are deterministic on purpose. The retro of 2026-09-27 showed that
// hand-written queries go wrong; a check here reads one named fact and decides.

import {parseCardDate, parseRunHealthLine} from './run-health.mjs';

export const STATES = [
  'not-due',
  'blocked',
  'skip',
  'mac-only',
  'done',
  'needs-you',
  'waiting',
  'not-checked',
];

/** Fill `{name}` placeholders. An unknown name stays as it is. */
export function fill(text, vars = {}) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] === undefined || vars[k] === null ? m : String(vars[k]),
  );
}

/** Whole days from date a to date b (YYYY-MM-DD, b later → positive). */
export function daysBetween(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The card line of the Play ANR source (scripts/lib/anr-card.mjs):
//   `Play · seen      error: The caller does not ...`  → the key failed
//   `Play · seen       0.12   0.10   0.09`             → the key works
const PLAY_LINE = /^\s*Play · seen\b(.*)$/m;

/**
 * Read the Play line of one card comment body.
 * @returns {'error'|'ok'|null} null when the card has no Play line
 *   (for example a card made with --no-anr)
 */
export function playStateOfCard(body) {
  const m = String(body || '').match(PLAY_LINE);
  if (!m) return null;
  return /^\s*error\b/.test(m[1]) || /^\s*unavailable\b/.test(m[1])
    ? 'error'
    : 'ok';
}

/** `<!-- daily-card date=D sections=S host=H -->` → H, or null. */
export function cardHost(body) {
  const m = String(body || '').match(/<!-- daily-card [^>]*\bhost=(\w+)/);
  return m ? m[1] : null;
}

/**
 * The distinct owner dates with a `run-health task=<task> ... status=DONE`
 * line, on or after `from`.
 * @param {{body:string}[]} comments
 */
export function cleanDays(comments, {task = 'triage', from}) {
  const days = new Set();
  for (const c of comments || []) {
    const l = parseRunHealthLine(c.body);
    if (!l || l.task !== task || l.status !== 'DONE') continue;
    if (from && l.date < from) continue;
    days.add(l.date);
  }
  return [...days].sort();
}

/**
 * The builds that still need an owner answer.
 * @param {{candidates:string[], ledgerBuilds:string[], labelled:Record<string,number>}} w
 * @param {string[]} noFixBuilds
 */
export function unclaimed(w, noFixBuilds = []) {
  const skip = new Set([...(w.ledgerBuilds || []), ...noFixBuilds].map(String));
  return (w.candidates || [])
    .map(String)
    .filter(b => !skip.has(b) && !(w.labelled && w.labelled[b] > 0));
}

const needs = lines => ({state: 'needs-you', lines});
const wait = text => ({state: 'waiting', lines: [text]});
const DONE = {state: 'done', lines: []};

/**
 * One entry for each `check` name.
 *   facts   — the fact names the check reads (in order)
 *   macOnly — the check reads the Mac (disk, ~/.claude), or a GitHub path the
 *             cloud proxy refuses; skip in the cloud
 *   decide(item, f, ctx) → {state, lines}
 */
export const CHECKS = {
  // The newest cloud card that has a Play line decides.
  'cloud-card-play-error': {
    facts: ['cardComments'],
    decide(item, f, ctx) {
      const cards = (f.cardComments || [])
        .filter(c => parseCardDate(c.body) && cardHost(c.body) === 'cloud')
        .map(c => ({...c, play: playStateOfCard(c.body)}))
        .filter(c => c.play)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const last = cards[cards.length - 1];
      if (!last)
        return wait(
          `${item.title}: no cloud card with a Play line yet, so the loop cannot tell.`,
        );
      if (last.play === 'ok') return DONE;
      if (item.status === 'owner-acted' && item.statusDate) {
        const days = daysBetween(item.statusDate, ctx.today);
        const vars = {statusDate: item.statusDate, days};
        if (days < (item.graceDays ?? 2))
          return wait(fill(item.waitingAfterReply, vars));
        return needs([
          fill(item.promptWhenBlocked || item.promptWhenDue, vars),
        ]);
      }
      return needs([fill(item.promptWhenDue)]);
    },
  },

  'unclaimed-builds': {
    facts: ['watchBuilds'],
    decide(item, f) {
      const builds = unclaimed(f.watchBuilds, item.noFixBuilds);
      if (!builds.length) return DONE;
      // Not Omar's step: the Mac loop reads the build's commits and records the
      // answer itself (triage-loop skill Step 1.6). Omar is never asked.
      return {
        state: 'waiting',
        lines: builds.map(build => fill(item.promptWhenDue, {build})),
      };
    },
  },

  'shadow-week': {
    facts: ['policy', 'shadowComments'],
    decide(item, f) {
      if (f.policy && f.policy.triageRunsInCloud === true) return DONE;
      const needed = item.daysNeeded || 7;
      const done = cleanDays(f.shadowComments, {from: item.countFrom}).length;
      const vars = {done, needed, countFrom: item.countFrom};
      if (done < needed) return wait(fill(item.waiting, vars));
      return needs([fill(item.promptWhenDue, vars)]);
    },
  },

  'github-billing': {
    facts: ['pr'],
    decide(item, f) {
      if (item.status === 'done') return DONE;
      if (f.pr && f.pr.state !== 'open') return DONE;
      return needs([fill(item.promptWhenDue)]);
    },
  },

  'pr-merged': {
    facts: ['pr'],
    decide(item, f) {
      if (f.pr && f.pr.merged) return DONE;
      if (f.pr && f.pr.state !== 'open')
        return needs([fill(item.promptWhenBlocked || item.promptWhenDue)]);
      if (item.status === 'owner-acted' && item.waitingAfterReply)
        return wait(
          fill(item.waitingAfterReply, {statusDate: item.statusDate}),
        );
      return needs([fill(item.promptWhenDue)]);
    },
  },

  // macOnly: the Claude Cloud GitHub proxy refuses `actions/runners` (HTTP 403),
  // so only the Mac task can read the runner list.
  'runner-present': {
    macOnly: true,
    facts: ['runners'],
    decide(item, f) {
      return (f.runners || []).includes(item.runnerName)
        ? needs([fill(item.promptWhenDue)])
        : DONE;
    },
  },

  // A plain HTTPS request (curl), so the cloud reads it too — unless a proxy
  // refuses the tunnel. The Claude Cloud egress proxy answers 403 for
  // app.qariah.app, and reading that as "the host answers nothing" asked Omar
  // to redo a redirect he had already made (2026-10-08).
  'share-redirect': {
    facts: ['shareRedirect'],
    decide(item, f) {
      const {code, proxy = 0, location} = f.shareRedirect;
      if (!code && proxy && proxy !== 200)
        return {
          state: 'not-checked',
          lines: [
            `${item.title}: could not check (a proxy refused the connection, HTTP ${proxy}; the request never reached app.qariah.app)`,
          ],
        };
      const redirects = [301, 302, 307, 308].includes(code);
      if (redirects && /^https:\/\/qariah\.org\//.test(location)) return DONE;
      return needs([fill(item.promptWhenDue, {code: code || 'nothing'})]);
    },
  },

  'disk-for-shipping': {
    macOnly: true,
    facts: ['policy', 'diskFreeGB', 'loopDrafts'],
    decide(item, f) {
      const floor = Number(
        f.policy && f.policy.runLimits && f.policy.runLimits.diskFloorGB
          ? f.policy.runLimits.diskFloorGB.build
          : NaN,
      );
      if (!Number.isFinite(floor))
        throw new Error('runLimits.diskFloorGB.build is not set');
      if (f.diskFreeGB >= floor || !f.loopDrafts) return DONE;
      return needs([
        fill(item.promptWhenDue, {
          need: floor - f.diskFreeGB,
          free: f.diskFreeGB,
          floor,
          drafts: f.loopDrafts,
        }),
      ]);
    },
  },

  'phase2-decision': {
    facts: ['policy'],
    decide(item, f, ctx) {
      if (item.status === 'done') return DONE;
      if (!(f.policy && f.policy.triageRunsInCloud === true))
        return {state: 'not-due', lines: []};
      if (!item.cutoverDate) return wait(fill(item.waitingNoCutoverDate));
      const due = addDays(item.cutoverDate, item.daysAfterCutover ?? 14);
      if (ctx.today < due) return {state: 'not-due', lines: []};
      return needs([fill(item.promptWhenDue)]);
    },
  },

  // Due only when the release branch is gone. The block lives on the Mac.
  'user-level-guard-block': {
    macOnly: true,
    facts: ['branchExists', 'userGuardBlock'],
    decide(item, f) {
      if (f.branchExists) return {state: 'not-due', lines: []};
      return f.userGuardBlock ? needs([fill(item.promptWhenDue)]) : DONE;
    },
  },
};

/**
 * Evaluate every item, in file order.
 * @param {{items:object[]}} list  docs/operations/owner-actions.json
 * @param {{today:string, cloud:boolean, facts:(name:string, item:object)=>any,
 *   only?:'mac'}} ctx  today = the owner's date (YYYY-MM-DD).
 *   facts may throw; the item is then `not-checked`. only='mac' keeps the
 *   Mac-only items (the Mac task after cutover: the cloud card has the rest).
 * @returns {{id:string, title:string, state:string, lines:string[]}[]}
 */
export function evaluateOwnerActions(list, ctx) {
  const results = [];
  const byId = new Map();
  const items = (list && list.items) || [];
  // With only='mac', an item that is not Mac-only is still evaluated when a
  // Mac-only item waits on it (`after`), else that item stays blocked for
  // ever. It is then reported as `skip`.
  const neededOnMac = new Set();
  if (ctx.only === 'mac') {
    const want = items
      .filter(i => (CHECKS[i.check] || {}).macOnly)
      .map(i => i.id);
    while (want.length) {
      const id = want.pop();
      if (neededOnMac.has(id)) continue;
      neededOnMac.add(id);
      want.push(...((items.find(i => i.id === id) || {}).after || []));
    }
  }
  for (const item of items) {
    const r = {id: item.id, title: item.title || item.id, state: '', lines: []};
    const check = CHECKS[item.check];
    const set = (state, lines = []) => Object.assign(r, {state, lines});
    if (!check) {
      set('not-checked', [`${r.title}: unknown check "${item.check}"`]);
    } else if (item.closedOn) {
      // Finished for good (a session set closedOn by hand): read no fact. A
      // Mac-only item is then done in the cloud too.
      set('done');
    } else if (ctx.only === 'mac' && !neededOnMac.has(item.id)) {
      set('skip');
    } else if (item.notBefore && ctx.today < item.notBefore) {
      set('not-due');
    } else if (
      (item.after || []).some(id => (byId.get(id) || {}).state !== 'done')
    ) {
      set('blocked');
    } else if (check.macOnly && ctx.cloud) {
      set('mac-only');
    } else {
      try {
        const f = {};
        for (const name of check.facts) f[name] = ctx.facts(name, item);
        const out = check.decide(item, f, ctx);
        set(out.state, out.lines || []);
      } catch (e) {
        set('not-checked', [
          `${r.title}: could not check (${String(e.message || e).slice(
            0,
            120,
          )})`,
        ]);
      }
    }
    byId.set(item.id, r);
    results.push(
      ctx.only === 'mac' && check && !check.macOnly
        ? {...r, state: 'skip', lines: []}
        : r,
    );
  }
  return results;
}

const LABEL = {
  'needs-you': 'NEEDS YOU',
  waiting: 'WAITING',
  'not-checked': 'NOT CHECKED',
};

/**
 * The ids of the due Mac-only items that a cloud run could not read. No Mac
 * task runs on the owner's account since the 2026-10-03 move, so nothing else
 * reads them either: say so, never stay silent.
 */
export function macOnlyIds(results) {
  return results.filter(r => r.state === 'mac-only').map(r => r.id);
}

export const MAC_ONLY_TEXT =
  'not checked: only a run on the Mac can read these (the Mac task qariah-daily-triage-fix-loop)';

/** The printable lines, NEEDS YOU first. Empty array = nothing to say. */
export function renderLines(
  results,
  {states = ['needs-you', 'waiting', 'not-checked', 'mac-only']} = {},
) {
  const out = [];
  for (const state of ['needs-you', 'waiting', 'not-checked']) {
    if (!states.includes(state)) continue;
    for (const r of results)
      if (r.state === state)
        for (const l of r.lines) out.push(`${LABEL[state]} · ${l}`);
  }
  const mac = macOnlyIds(results);
  if (states.includes('mac-only') && mac.length)
    out.push(`MAC ONLY · ${mac.join(', ')}: ${MAC_ONLY_TEXT}`);
  return out;
}

/**
 * Word-wrap for the phone card. A word longer than `width` (a URL, a
 * command) stays whole on its own line.
 */
export function wrap(text, width = 58, indent = '  ') {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + w.length > width) {
      lines.push(cur);
      cur = indent + w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * The NEEDS YOU section of the daily card: each prompt, numbered and
 * wrapped; `none` when empty; one short line for items that could not be
 * checked. WAITING lines stay off the card (they need no action).
 */
export function cardSection(results, width = 58) {
  const L = [];
  let n = 0;
  for (const r of results)
    if (r.state === 'needs-you')
      for (const l of r.lines) {
        n++;
        const [first, ...rest] = wrap(l, width - 4, '   ');
        L.push(`${String(n)}. ${first}`, ...rest);
      }
  if (!n) L.push('none');
  const unchecked = results.filter(r => r.state === 'not-checked');
  if (unchecked.length)
    L.push(`could not check: ${unchecked.map(r => r.id).join(', ')}`);
  const mac = macOnlyIds(results);
  if (mac.length) L.push(`Mac only, not checked: ${mac.join(', ')}`);
  return L;
}
