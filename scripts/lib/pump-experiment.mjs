// @ai
//
// scripts/lib/pump-experiment.mjs
// -------------------------------
// The pure parts of scripts/pump-experiment.mjs: the HogQL of the two arms of
// the mount pump experiment, and the statistics that compare them.
//
// The experiment (owner, 2026-11-12): the PostHog flag `background_mount_pump`
// (id 1073123) gives `control` (pump off) or `treatment` (pump on), 50/50, to
// Android builds >= 4552. Build 4552 is the merge of PR #867, the first build
// with the pump (modules/qariah-mount-pump). The flag is the kill switch.
//
// What each event tells:
//   - `$feature/background_mount_pump` — the arm. The SDK adds it to each event
//     from the flags that it has (posthog-core getCommonEventProperties). A
//     cold start reads the flags that the last session stored, so the ANR exit
//     of the last process counts in the arm of that process.
//   - `mount_pump` — what the pump did: 'on', 'off' or 'unavailable'. A super
//     property (components/QariahRootEffects.tsx registers it 3 s after the
//     flag applies), so it also reaches the next cold start.
//   - `cold_start_began` with `prev_exit_reason = 'anr'` — an ANR exit of the
//     last process (the method of planning/android-anr-floor-rca-2026-11-11.md).
//   - `app_return_slow` — a first frame of 1,500 ms or more after a return from
//     the background (services/mountPump RETURN_SLOW_MS).

export const PUMP_FLAG_KEY = 'background_mount_pump';
export const PUMP_FLAG_ID = 1073123;
/** The build of the PR #867 merge (`2f0ea3f88`): commit count 4167 + 385. */
export const FIRST_PUMP_BUILD = 4552;
/** The day the flag went live (2026-11-13 UTC). */
export const EXPERIMENT_START = '2026-11-13';

/** Below these counts a verdict is noise. */
export const MIN_COLD_STARTS_PER_ARM = 500;
export const MIN_ANR_EXITS_TOTAL = 20;

const ARM_SQL = `coalesce(toString(properties.\`$feature/${PUMP_FLAG_KEY}\`), 'unassigned')`;
const STATE_SQL = `coalesce(toString(properties.mount_pump), 'unknown')`;

/**
 * The HogQL of one split. `by` is 'arm' (the flag value) or 'state' (what the
 * pump did). `since` is YYYY-MM-DD (UTC). `labSQL` is labExclusionSQL().
 */
export function splitQuery({by = 'arm', since = EXPERIMENT_START, labSQL}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error(`since must be YYYY-MM-DD, not ${since}`);
  }
  if (!labSQL) throw new Error('labSQL is required');
  const key = by === 'state' ? STATE_SQL : ARM_SQL;
  return `SELECT
  ${key} AS split,
  uniqExact(person_id) AS persons,
  uniqExact(person_id, toDate(timestamp)) AS person_days,
  countIf(event = 'cold_start_began') AS cold_starts,
  countIf(event = 'cold_start_began' AND properties.prev_exit_reason = 'anr') AS anr_exits,
  countIf(event = 'app_return_slow') AS slow_returns,
  quantileIf(0.5)(toFloat(properties.frame_ms), event = 'app_return_slow') AS slow_p50_ms,
  quantileIf(0.9)(toFloat(properties.frame_ms), event = 'app_return_slow') AS slow_p90_ms,
  toString(toDate(min(timestamp))) AS first_day
FROM events
WHERE timestamp >= toDateTime('${since} 00:00:00')
  AND event IN ('cold_start_began', 'app_return_slow')
  AND properties.$os_name = 'Android'
  AND toInt(properties.$app_build) >= ${FIRST_PUMP_BUILD}
  AND ${labSQL}
GROUP BY split
ORDER BY split
LIMIT 20`;
}

const COLUMNS = [
  'split',
  'persons',
  'person_days',
  'cold_starts',
  'anr_exits',
  'slow_returns',
  'slow_p50_ms',
  'slow_p90_ms',
  'first_day',
];

/** HogQL rows (arrays) to objects, with numbers where the column is a count. */
export function rowsToSplits(rows) {
  return rows.map(r => {
    const o = {};
    COLUMNS.forEach((c, i) => {
      const v = r[i];
      o[c] =
        c === 'split' || c === 'first_day'
          ? v === null || v === undefined
            ? null
            : String(v)
          : v === null || v === undefined
            ? null
            : Number(v);
    });
    return o;
  });
}

/** The standard normal CDF (Abramowitz and Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Two proportions, x1/n1 (treatment) against x2/n2 (control): the difference,
 * its interval (95% by default; `z` sets it) and the two-sided p value (pooled
 * z test). Null when an arm has no trials.
 */
export function compareProportions(x1, n1, x2, n2, zCrit = 1.96) {
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const diff = p1 - p2;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const pooled = (x1 + x2) / (n1 + n2);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = sePooled > 0 ? diff / sePooled : 0;
  return {
    p1,
    p2,
    diff,
    low: diff - zCrit * se,
    high: diff + zCrit * se,
    p: 2 * (1 - normalCdf(Math.abs(z))),
  };
}

/**
 * Two event rates, x1/t1 (treatment) against x2/t2 (control): the rate ratio
 * and its interval (95% by default; `z` sets it; log method). Null when a
 * count or an exposure is 0.
 */
export function compareRates(x1, t1, x2, t2, zCrit = 1.96) {
  if (!(x1 > 0) || !(x2 > 0) || !(t1 > 0) || !(t2 > 0)) return null;
  const ratio = x1 / t1 / (x2 / t2);
  const se = Math.sqrt(1 / x1 + 1 / x2);
  return {
    ratio,
    low: Math.exp(Math.log(ratio) - zCrit * se),
    high: Math.exp(Math.log(ratio) + zCrit * se),
  };
}

/** One word for an interval: 'lower', 'higher' or 'no clear difference'. */
function direction(low, high, neutral) {
  if (high < neutral) return 'lower';
  if (low > neutral) return 'higher';
  return 'no clear difference';
}

/**
 * Compare `treatment` with `control`. The verdict is 'not enough data' until
 * each arm has MIN_COLD_STARTS_PER_ARM cold starts and the two arms have
 * MIN_ANR_EXITS_TOTAL ANR exits.
 */
export function compareArms(splits) {
  const t = splits.find(s => s.split === 'treatment');
  const c = splits.find(s => s.split === 'control');
  if (!t || !c) {
    return {verdict: 'not enough data', reason: 'an arm has no events yet'};
  }
  const anr = compareProportions(
    t.anr_exits,
    t.cold_starts,
    c.anr_exits,
    c.cold_starts,
  );
  const slow = compareRates(
    t.slow_returns,
    t.person_days,
    c.slow_returns,
    c.person_days,
  );
  const enough =
    t.cold_starts >= MIN_COLD_STARTS_PER_ARM &&
    c.cold_starts >= MIN_COLD_STARTS_PER_ARM &&
    t.anr_exits + c.anr_exits >= MIN_ANR_EXITS_TOTAL;
  const out = {anr, slow};
  if (!enough) {
    return {
      ...out,
      verdict: 'not enough data',
      reason:
        `needs ${MIN_COLD_STARTS_PER_ARM} cold starts in each arm and ` +
        `${MIN_ANR_EXITS_TOTAL} ANR exits in all (now ${t.cold_starts} and ` +
        `${c.cold_starts}; ${t.anr_exits + c.anr_exits})`,
    };
  }
  return {
    ...out,
    verdict: 'measured',
    anrDirection: anr ? direction(anr.low, anr.high, 0) : 'no data',
    slowDirection: slow ? direction(slow.low, slow.high, 1) : 'no data',
  };
}

const pct = (x, d = 2) =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`;
const num = x =>
  x === null || x === undefined || Number.isNaN(x)
    ? '—'
    : String(Math.round(x));

/** The report as text lines. `flag` is {active, variants} or null. */
export function renderReport({since, arms, states, comparison, flag}) {
  const lines = [];
  lines.push(
    `Mount pump experiment — Android builds >= ${FIRST_PUMP_BUILD}, since ${since} (UTC), lab devices excluded`,
  );
  if (flag) {
    const split = (flag.variants || [])
      .map(v => `${v.key} ${v.rollout_percentage}%`)
      .join(', ');
    lines.push(
      `Flag ${PUMP_FLAG_KEY}: ${flag.active ? 'ON' : 'OFF (kill switch engaged: the pump is off for all)'}${split ? ` — ${split}` : ''}`,
    );
  }
  const table = (title, rows) => {
    lines.push('', title);
    lines.push(
      'split        persons  person-days  cold-starts  ANR-exits  ANR/cold-start  slow-returns  slow/100-days  p50-ms  p90-ms',
    );
    for (const r of rows) {
      const anrRate = r.cold_starts > 0 ? r.anr_exits / r.cold_starts : null;
      const slowRate =
        r.person_days > 0 ? (r.slow_returns / r.person_days) * 100 : null;
      lines.push(
        [
          r.split.padEnd(12),
          String(r.persons).padStart(7),
          String(r.person_days).padStart(12),
          String(r.cold_starts).padStart(12),
          String(r.anr_exits).padStart(10),
          pct(anrRate).padStart(15),
          String(r.slow_returns).padStart(13),
          (slowRate === null ? '—' : slowRate.toFixed(1)).padStart(14),
          num(r.slow_p50_ms).padStart(7),
          num(r.slow_p90_ms).padStart(7),
        ].join(' '),
      );
    }
    if (rows.length === 0) lines.push('(no events yet)');
  };
  table('By arm (the flag value):', arms);
  table('By pump state (what the pump did):', states);
  lines.push(
    '',
    `Treatment against control: ${comparison.verdict}${comparison.reason ? ` — ${comparison.reason}` : ''}`,
  );
  if (comparison.anr) {
    const a = comparison.anr;
    lines.push(
      `  ANR exits per cold start: ${pct(a.p1)} against ${pct(a.p2)}; difference ${pct(a.diff)} (95% ${pct(a.low)} to ${pct(a.high)}), p = ${a.p.toFixed(3)}` +
        (comparison.anrDirection
          ? ` — treatment ${comparison.anrDirection}`
          : ''),
    );
  }
  if (comparison.slow) {
    const s = comparison.slow;
    lines.push(
      `  Slow returns per person-day: ratio ${s.ratio.toFixed(2)} (95% ${s.low.toFixed(2)} to ${s.high.toFixed(2)})` +
        (comparison.slowDirection
          ? ` — treatment ${comparison.slowDirection}`
          : ''),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// The daily check (owner, 2026-11-13): the triage cloud routine runs
// `node scripts/pump-experiment.mjs --check` each day
// (.claude/routines/qariah-daily-triage.md, "Mount pump experiment"). The
// rules below are fixed before the data comes, so a daily look does not
// pick the result.

/**
 * The planned sample: the cold starts in each arm that show a halving of the
 * ANR exits (0.7% to 0.35% of cold starts, the Android rate of 2026-10-18 to
 * 2026-11-13) with 80% power at a two-sided 5% level.
 */
export const PLANNED_COLD_STARTS_PER_ARM = 6700;
/** The cap: a result item this many days after the first day of an arm. */
export const CAP_DAYS = 56;
/** Harm uses a 99% interval, because the check looks every day. */
export const HARM_Z = 2.576;

export const HARM_KEY = 'pump-experiment-harm';
export const RESULT_KEY = 'pump-experiment-result';

/** Add days to a YYYY-MM-DD date. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Is the experiment still running? It runs while the flag is active and both
 * variants have a share. `flag` is {active, deleted, variants} or null.
 */
export function flagRunning(flag) {
  if (!flag || flag.deleted) return {running: false, why: 'the flag is gone'};
  if (!flag.active) {
    return {running: false, why: 'the flag is off (the kill switch)'};
  }
  const share = k =>
    (flag.variants || []).find(v => v.key === k)?.rollout_percentage ?? 0;
  if (!(share('control') > 0) || !(share('treatment') > 0)) {
    return {
      running: false,
      why: `the split is control ${share('control')}%, treatment ${share('treatment')}% (a decision is in force)`,
    };
  }
  return {running: true, why: ''};
}

/** The recommendation from the 95% directions of the two measures. */
export function recommend(comparison) {
  const a = comparison.anrDirection;
  const s = comparison.slowDirection;
  if (a === 'higher' || s === 'higher') {
    return 'turn the pump off: the pump arm is worse on a measure';
  }
  if (a === 'lower' && s === 'lower') {
    return 'pump default on: the pump arm is lower on both measures';
  }
  if (a === 'lower' || s === 'lower') {
    return 'your call: the pump arm is lower on one measure and not clearly different on the other';
  }
  return 'turn the pump off: no clear gain, and the pump calls React Native internals (TECH_DEBT #412)';
}

/**
 * Decide what the daily check files. Returns {state, reason} and, for a state
 * that files an item, {key, kind, priority, title, reply}. States:
 *   stopped — the flag is off, gone or not 50/50: nothing to watch.
 *   wait    — no item (not enough data, or no clear harm before the sample).
 *   harm    — the pump arm is worse at the 99% level: P1 decision.
 *   result  — the planned sample is reached: P2 decision.
 *   cap     — CAP_DAYS passed before the sample: P2 decision.
 * `today` is YYYY-MM-DD (UTC).
 */
export function decideCheck({arms, flag, today}) {
  const run = flagRunning(flag);
  if (!run.running) return {state: 'stopped', reason: run.why};
  const t = arms.find(a => a.split === 'treatment');
  const c = arms.find(a => a.split === 'control');
  if (!t || !c) {
    return {
      state: 'wait',
      reason: 'no user is in both arms yet (no live build >= 4552)',
    };
  }
  const minOk =
    t.cold_starts >= MIN_COLD_STARTS_PER_ARM &&
    c.cold_starts >= MIN_COLD_STARTS_PER_ARM;
  if (minOk) {
    const anr99 = compareProportions(
      t.anr_exits,
      t.cold_starts,
      c.anr_exits,
      c.cold_starts,
      HARM_Z,
    );
    const slow99 = compareRates(
      t.slow_returns,
      t.person_days,
      c.slow_returns,
      c.person_days,
      HARM_Z,
    );
    const anrHarm = Boolean(anr99 && anr99.low > 0);
    const slowHarm = Boolean(slow99 && slow99.low > 1);
    if (anrHarm || slowHarm) {
      const what = [
        anrHarm ? 'more ANR exits per cold start' : null,
        slowHarm ? 'more slow returns per person-day' : null,
      ]
        .filter(Boolean)
        .join(' and ');
      return {
        state: 'harm',
        reason: `the pump arm has ${what} (99% interval)`,
        key: HARM_KEY,
        kind: 'decision',
        priority: 'P1',
        title: `Mount pump experiment: the pump arm has ${what}`,
        reply: 'Reply `turn the pump off` or `keep running`.',
      };
    }
  }
  const progress = `cold starts ${t.cold_starts} and ${c.cold_starts} of ${PLANNED_COLD_STARTS_PER_ARM} in each arm`;
  if (
    t.cold_starts >= PLANNED_COLD_STARTS_PER_ARM &&
    c.cold_starts >= PLANNED_COLD_STARTS_PER_ARM
  ) {
    return {
      state: 'result',
      reason: `the planned sample is reached (${progress})`,
      key: RESULT_KEY,
      kind: 'decision',
      priority: 'P2',
      title: 'Mount pump experiment: the result is ready',
      reply: 'Reply `pump default on` or `turn the pump off`.',
    };
  }
  const firsts = [t.first_day, c.first_day].filter(Boolean).sort();
  const capDay = firsts.length ? addDays(firsts[0], CAP_DAYS) : null;
  if (capDay && today >= capDay) {
    return {
      state: 'cap',
      reason: `${CAP_DAYS} days since ${firsts[0]}, before the planned sample (${progress})`,
      key: RESULT_KEY,
      kind: 'decision',
      priority: 'P2',
      title: `Mount pump experiment: ${CAP_DAYS} days and no planned sample`,
      reply: 'Reply `pump default on` or `turn the pump off`.',
    };
  }
  return {
    state: 'wait',
    reason: `${progress}${capDay ? `; the cap is ${capDay}` : ''}`,
  };
}

/** The body of the owner-queue item: impact first, then the numbers. */
export function renderCheckBody({decision, comparison, reportLines}) {
  const impact = {
    harm: 'Android users in the pump arm have a worse experience than the other half. Turn the pump off unless you want more data.',
    result:
      'The experiment has enough data to decide if the mount pump stays on for all Android users.',
    cap: `The experiment ran ${CAP_DAYS} days without the planned sample. Decide on the data that it has.`,
  }[decision.state];
  return [
    `**Impact:** ${impact}`,
    '',
    `**Why now:** ${decision.reason}.`,
    '',
    `**Recommendation:** ${
      decision.state === 'harm'
        ? `turn the pump off: ${decision.reason}`
        : recommend(comparison)
    }.`,
    '',
    "**Whose decision:** the owner's (the owner started the experiment on 2026-11-12). The Steward escalates this item; it does not answer it.",
    '',
    '**What each reply does:**',
    '- `turn the pump off`: an agent turns the PostHog flag `background_mount_pump` (id 1073123) off. The pump stops at once on every phone. Then the module goes (TECH_DEBT #412).',
    decision.state === 'harm'
      ? null
      : '- `pump default on`: an agent sets `treatment` to 100%, then makes the pump the build default in a PR.',
    decision.state === 'harm'
      ? '- `keep running`: nothing changes. The check files this item again each day while the harm stays.'
      : null,
    '',
    '**The report** (`node scripts/pump-experiment.mjs`):',
    '',
    '```',
    ...reportLines,
    '```',
    '',
    'Rules: `scripts/lib/pump-experiment.mjs` (`decideCheck`), fixed on 2026-11-13 before the data came.',
  ]
    .filter(l => l !== null)
    .join('\n');
}
