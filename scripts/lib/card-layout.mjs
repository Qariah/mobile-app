// @ai
//
// scripts/lib/card-layout.mjs
// ---------------------------
// The top half of the daily card (scripts/daily-card.mjs): the header, the
// people and journey block, ACTIVE and USE. Pure functions, tested in
// scripts/__tests__/card-layout.test.mjs.
//
// Owner layout, 2026-10-11 (the card had grown redundant):
//   date and data window · the builds counted and not counted · rollout
//   people (iOS / Android) · the journey (counts only)
//   ACTIVE: DAU / WAU / MAU for today, yesterday, the day before
//   USE: recitations and pages for the last day / week / month
// The FREEZES (ANR) block comes from anr-card.mjs (since 2026-10-20; the A/B
// section of ab-card.mjs prints only with --ab), the ops sections from
// daily-card.mjs.
//
// SCOPE. People, the journey and FAILURES count the production builds only
// (cardBuilds): every build that serves users in the stores now, on both
// platforms. On 2026-10-11 that was iOS 1718 (3.2.1) and Android 1717 (3.2.0)
// + 2027 (3.2.1, staged). The old card counted the release 3.2.1 only, so it
// left out the 1165 weekly Android users still on 3.2.0. ACTIVE and USE count
// every version: a person active on an old build is still active.

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
      .map(b => ({platform: b.platform, ...parseRelease(b.release)}))
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
export function renderHeader({
  date,
  weekday,
  windowLabel,
  builds,
  ios,
  android,
}) {
  const L = [`QARIAH · ${weekday ? `${weekday} ` : ''}${date}`];
  L.push(`Counted ${windowLabel}:`);
  for (const l of buildLines(builds)) L.push(...wrap(`  ${l}`, WIDTH, '    '));
  L.push('Active and use: all versions');
  L.push('Never counted: lab devices');
  if (ios || android) {
    L.push('', 'Rollout');
    if (ios) L.push(...wrap(`  iOS ${ios}`, WIDTH, '    '));
    if (android) L.push(...wrap(`  Android ${android}`, WIDTH, '    '));
  }
  return L;
}

/**
 * People and the journey: counts only, no bar and no percentage.
 * total, byPlatform {iOS, Android}, installed, steps [{label, n}]
 *
 * `installed` is NOT a journey step. The install event fires once, on the
 * first launch after an install or an update, so a person who updated before
 * the window opens the app every day and never sends one in it. On 2026-10-11
 * "Installed" (2598) sat above "Opened" (4656) and read as a broken funnel.
 * It prints as its own line under the people count; the journey starts at
 * Opened.
 */
export function renderJourney({total, byPlatform, installed, steps}) {
  const L = [
    `${total} people · iOS ${byPlatform.iOS || 0} · Android ${byPlatform.Android || 0}`,
  ];
  if (installed != null)
    L.push(`  ${installed} of them installed or updated it`);
  L.push('');
  for (const s of steps)
    L.push(`${s.label.padEnd(14)}${String(s.n).padStart(6)}`);
  return L;
}

const cell = (v, w) => String(v == null ? '—' : v).padStart(w);

/**
 * ACTIVE: unique people in the trailing 24 h, 7 days and 30 days, ending now,
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
