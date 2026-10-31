// @ai
//
// scripts/lib/card-layout.mjs
// ---------------------------
// The top half of the daily card (scripts/daily-card.mjs): the header, the
// people and journey block, ACTIVE and USE. Pure functions, tested in
// scripts/__tests__/card-layout.test.mjs.
//
// Owner layout, 2026-10-11, changed 2026-10-30 (after 2027 reached 100%):
//   date · what is counted · the end of the windows · the rollout (only
//   while active-rollout.json `active` is true)
//   BUILDS: people on each v2 build with more than 50 people in the last 7
//     days, the other builds in one row, every v2 build (7 and 30 days)
//   JOURNEY: people on every v2 build who reached each step (7 and 30 days)
//   ACTIVE: DAU / WAU / MAU for today, yesterday, the day before
//   USE: recitations and pages for the last day / week / month
// The FREEZES (ANR) block comes from anr-card.mjs (since 2026-10-20), the ops
// sections from daily-card.mjs.
//
// SCOPE. BUILDS, JOURNEY, ACTIVE and USE count every v2 build. FAILURES and
// FREEZES count the production builds (cardBuilds): every build that serves
// users in the stores now, on both platforms (active-rollout.json
// card.builds).
//
// A build with `anrScore: false` in card.builds still counts for people, the
// journey and FAILURES, but it stays out of Google's score: the Play ANR rate
// pooled over the Android codes (anrScoreBuilds). On 2026-10-25 the owner
// brought back 3.2.0 (1717), first out of the score, then in it.
//
// WINDOWS (since 2026-10-24). The journey lines of FAILURES count the last 7
// days, the crash lines 14 days. FREEZES (ANR) counts cardBuilds and the
// older builds that still have users (anr-card.mjs weekReleases), because
// cardBuilds drops the old build when a rollout completes.

export const WIDTH = 44; // the card's phone width

// `com.qariah.app@3.2.1+2027` → {version: '3.2.1', build: '2027'}
const parseRelease = r => {
  const m = String(r || '').match(/@([\d.]+)\+(\d+)$/);
  return m ? {version: m[1], build: m[2]} : null;
};

/**
 * The production builds the card counts: [{platform, version, build}].
 * active-rollout.json → card.builds ([{platform, release}]) names them. Without
 * it, the current release of each platform (sentryReleaseIos, sentryRelease).
 */
export function cardBuilds(cfg) {
  const listed = cfg && cfg.card && cfg.card.builds;
  if (Array.isArray(listed) && listed.length)
    return listed
      .map(b => ({
        platform: b.platform,
        ...parseRelease(b.release),
        ...(b.anrScore === false ? {anrScore: false} : {}),
      }))
      .filter(
        b => b.build && (b.platform === 'iOS' || b.platform === 'Android'),
      );
  const out = [];
  const ios = parseRelease(cfg && cfg.sentryReleaseIos);
  const android = parseRelease(cfg && cfg.sentryRelease);
  if (ios) out.push({platform: 'iOS', ...ios});
  if (android) out.push({platform: 'Android', ...android});
  return out;
}

/** The builds of Google's score (the Play ANR rate): cardBuilds less `anrScore: false`. */
export const anrScoreBuilds = cfg =>
  cardBuilds(cfg).filter(b => b.anrScore !== false);

/** One line for each platform: `iOS 1718 (3.2.1)`, `Android 1717 (3.2.0), 2027 (3.2.1)`. */
export function buildLines(builds) {
  return ['iOS', 'Android']
    .map(p => {
      const bs = builds.filter(b => b.platform === p);
      return bs.length
        ? `${p} ${bs.map(b => `${b.build} (${b.version})`).join(', ')}`
        : null;
    })
    .filter(Boolean);
}

/**
 * Wrap text to the card width at spaces. The first line keeps the text's own
 * leading spaces; the next lines get `indent`. A word longer than the width
 * stays whole.
 */
export function wrap(text, width = WIDTH, indent = '  ') {
  const str = String(text);
  const first = str.match(/^\s*/)[0];
  const out = [];
  const lead = () => (out.length ? indent : first);
  let line = '';
  for (const w of str.trim().split(/\s+/).filter(Boolean)) {
    if (line && `${lead()}${line} ${w}`.length > width) {
      out.push(lead() + line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(lead() + line);
  return out;
}

/**
 * The header: the date, what is counted and since when, and the rollout.
 * {date, weekday, windowLabel, builds, ios, android}; ios/android are the
 * rollout texts the loop passes (--ios, --android), or empty.
 */
export function renderHeader({date, weekday, windowEnd, ios, android}) {
  const L = [`QARIAH · ${weekday ? `${weekday} ` : ''}${date}`];
  // Since 2026-10-30 every block counts every v2 build (BUILDS shows them).
  L.push('Every v2 build · lab devices left out');
  // Since 2026-10-25 the PostHog numbers end at a fixed time (daily-card.mjs AT).
  if (windowEnd) L.push(`Counts end ${windowEnd} Los Angeles time`);
  if (ios || android) {
    L.push('', 'Rollout');
    if (ios) L.push(...wrap(`  iOS ${ios}`, WIDTH, '    '));
    if (android) L.push(...wrap(`  Android ${android}`, WIDTH, '    '));
  }
  return L;
}

const COUNT_W = 7;
const COUNT30_W = 9;
const LABEL_W = 22;
const row2 = (label, a, b) =>
  `${label.padEnd(LABEL_W)}${String(a ?? '—').padStart(COUNT_W)}${String(b ?? '—').padStart(COUNT30_W)}`;

/**
 * BUILDS (since 2026-10-30): people on each v2 build in the last 7 and 30
 * days. live: {minPeople, rows [{platform, version, build, d7, d30}], other
 * {builds, d7, d30} | null} (a row for each build with more than minPeople
 * people in the last 7 days; the other builds in one row, each person once).
 * people: {d7, d30}, each {total, iOS, Android, installed}.
 *
 * `installed` is NOT a journey step. The install event fires once, on the
 * first launch after an install or an update, so a person who updated before
 * the window opens the app every day and never sends one in it. On 2026-10-11
 * "Installed" (2598) sat above "Opened" (4656) and read as a broken funnel. It
 * prints under the people count, not in the journey.
 */
export function renderBuilds(live, people) {
  const L = [row2('BUILDS (people)', '7 days', '30 days')];
  if (!live || !people) return [...L, '  unavailable'];
  for (const b of live.rows)
    L.push(row2(`${b.platform} ${b.build} (${b.version})`, b.d7, b.d30));
  if (live.other)
    L.push(
      row2(`${live.other.builds} other builds`, live.other.d7, live.other.d30),
    );
  L.push(row2('All v2 builds', people.d7.total, people.d30.total));
  L.push(row2('  iOS', people.d7.iOS, people.d30.iOS));
  L.push(row2('  Android', people.d7.Android, people.d30.Android));
  L.push(
    row2('  installed or updated', people.d7.installed, people.d30.installed),
  );
  return L;
}

/** JOURNEY: people on every v2 build who reached each step. steps: [{label, d7, d30}]. */
export function renderJourneyWindows(steps) {
  const L = [row2('JOURNEY', '7 days', '30 days')];
  if (!Array.isArray(steps)) return [...L, '  unavailable'];
  for (const st of steps) L.push(row2(st.label, st.d7, st.d30));
  return L;
}

const cell = (v, w) => String(v == null ? '—' : v).padStart(w);

/**
 * ACTIVE: unique people in the trailing 24 h, 7 days and 30 days, ending at the card's window end (11:00 LA),
 * a day ago and two days ago. rows: [{label, dau, wau, mau}] or null.
 */
export function renderActive(rows) {
  const L = [
    `${'ACTIVE'.padEnd(14)}${'DAU'.padStart(6)}${'WAU'.padStart(7)}${'MAU'.padStart(7)}`,
  ];
  if (!rows) return [...L, '  unavailable'];
  for (const r of rows)
    L.push(
      `${r.label.padEnd(14)}${cell(r.dau, 6)}${cell(r.wau, 7)}${cell(r.mau, 7)}`,
    );
  return L;
}

/**
 * USE: event counts in the trailing day, week and month.
 * rows: [{label, day, week, month}] or null.
 */
export function renderUse(rows) {
  const L = [
    `${'USE'.padEnd(14)}${'day'.padStart(6)}${'week'.padStart(7)}${'month'.padStart(7)}`,
  ];
  if (!rows) return [...L, '  unavailable'];
  for (const r of rows)
    L.push(
      `${r.label.padEnd(14)}${cell(r.day, 6)}${cell(r.week, 7)}${cell(r.month, 7)}`,
    );
  return L;
}
