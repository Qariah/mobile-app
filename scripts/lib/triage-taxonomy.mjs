// @ai
//
// scripts/lib/triage-taxonomy.mjs
// -------------------------------
// THE canonical classifier for auto-filed diagnostics issues. One place decides
// "what kind of issue is this and is the fix-loop allowed to draft a PR for it."
//
// Why this exists
// ---------------
// The six collector lanes label issues for THEIR own source (sentry / play-store
// / testflight / posthog …). Those per-lane labels are NOT a clean "is this
// loop-actionable?" signal:
//   - `[Play ★1] app does not launch` is labelled `bug` + `user-review` — a 1-star
//     review with NO stack. The loop must NOT waste a draft on it.
//   - `[Release health] … below gate` is labelled `bug` — a promote gate, not a
//     code defect. Not loop-actionable.
//   - `[Play Crash] … OutOfMemoryError` is labelled `play-store` + `crash` but NOT
//     `bug` — a native crash with no JS stack. The loop ignores it today and a
//     naive digest buries it in "other." It is a human/device investigation, but
//     it MUST be visible.
//   - `[Sentry QARIAHV2-J] diagnostic-js-stall` is the genuinely loop-actionable
//     class: a real stack the remediate routine can root-cause.
//
// So the loop's "is this actionable?" decision and the digest's "which bucket?"
// decision MUST share one definition, or they drift and the loop drafts the wrong
// things. They both import `classify()` from here. The qariah-triage-loop skill
// consumes `scripts/triage-digest.mjs --json`, whose `actionable` array is exactly
// `classify(...).loopEligible === true` — code is the single source of truth, the
// skill prose just explains it.
//
// Classification is title-prefix + label based (both, for resilience). The live
// title prefixes are stable and reliable:
//   [Sentry QARIAHV2-*]  [Play Crash]  [Play ANR]  [Play ★N]  [App Store ★N]
//   [TestFlight …]       [PostHog]     [Release health]       [incident] …
// so even when a lane's labels are imperfect, the prefix disambiguates.

/** @typedef {{number:number,title:string,labels:string[],state?:string}} Issue */

// Bucket keys → human metadata for the digest. Order here is the digest's section
// order; `loopEligible` marks the ONE bucket the fix-loop may draft against.
export const BUCKETS = {
  incident: {emoji: '🚨', heading: 'Active incidents', loopEligible: false},
  actionable: {
    emoji: '🐛',
    heading: 'Bugs to fix (loop-actionable)',
    loopEligible: true,
  },
  'awaiting-merge': {
    emoji: '📋',
    heading: 'Awaiting merge (draft PR open)',
    loopEligible: false,
  },
  'native-crash': {
    emoji: '💥',
    heading: 'Native crashes & ANR (investigate)',
    loopEligible: false,
  },
  investigation: {
    emoji: '🔍',
    heading: 'Investigations (no stack — human/device)',
    loopEligible: false,
  },
  feedback: {
    emoji: '📝',
    heading: 'Tester feedback (triage by hand)',
    loopEligible: false,
  },
  review: {emoji: '⭐', heading: 'Store reviews', loopEligible: false},
  'feature-request': {
    emoji: '🌟',
    heading: 'Feature requests',
    loopEligible: false,
  },
  'release-health': {
    emoji: '📉',
    heading: 'Release health (promote gate)',
    loopEligible: false,
  },
  decision: {
    emoji: '🧭',
    heading: 'Needs owner decision (design / copy / product)',
    loopEligible: false,
  },
  wontfix: {emoji: '🗑️', heading: "Won't fix / not-a-bug", loopEligible: false},
  other: {emoji: '❔', heading: 'Uncategorised', loopEligible: false},
};

const has = (labels, name) => labels.includes(name);
const titleIs = (title, re) => re.test(String(title || ''));

const SEV_LABELS = [
  'severity:critical',
  'severity:high',
  'severity:medium',
  'severity:low',
];
export function severityOf(labels) {
  const l = SEV_LABELS.find(s => labels.includes(s));
  return l ? l.split(':')[1] : 'unknown';
}
export const SEV_RANK = {critical: 4, high: 3, medium: 2, low: 1, unknown: 0};

export function incidentKeyOf(labels) {
  const l = labels.find(x => x.startsWith('incident:'));
  return l ? l.slice('incident:'.length) : null;
}

/**
 * Classify ONE issue into exactly one bucket + decide loop-eligibility.
 *
 * @param {Issue} issue
 * @param {{pinnedOpen?:Set<number>, wontfix?:Set<number>, fixedInBuild?:Map<number,string>}} [ledger]
 *        pinnedOpen   — numbers in triage-state "Pinned open" (under active human
 *          work; the loop must NOT draft a competing fix → loopEligible=false).
 *        wontfix      — numbers in triage-state "do not reopen" / known non-bugs.
 *        fixedInBuild — number→versionCode in triage-state "Fixed in build" (a fix
 *          already merged, pending device-verify + close; the loop must NOT re-draft
 *          it → loopEligible=false, surfaced under "fixed — pending close").
 * @returns {{bucket:string, loopEligible:boolean, pinned:boolean, fixedIn:?string,
 *            incident:?string, severity:string, isFeature:boolean, reason:string}}
 */
export function classify(issue, ledger = {}) {
  const labels = issue.labels || [];
  const title = issue.title || '';
  const num = issue.number;
  const pinnedOpen = ledger.pinnedOpen || new Set();
  const wontfix = ledger.wontfix || new Set();
  const fixedInBuild = ledger.fixedInBuild || new Map();

  const incident = incidentKeyOf(labels);
  const severity = severityOf(labels);
  const pinned = pinnedOpen.has(num);
  const fixedIn = fixedInBuild.get(num) || null;

  const out = (bucket, reason, extra = {}) => ({
    bucket,
    loopEligible: false,
    pinned,
    fixedIn,
    incident,
    severity,
    isFeature: false,
    reason,
    ...extra,
  });

  // 1. Incident umbrella PARENT (`[incident] …` + `incident` label). The members
  //    live in their own real buckets; the umbrella is a grouping thread only.
  if (has(labels, 'incident') && titleIs(title, /^\s*\[incident\]/i))
    return out(
      'incident',
      'incident umbrella (grouping thread, not a fix target)',
    );

  // 2. Already drafted — a human owes the merge + device check. Never re-draft.
  if (has(labels, 'remediation-drafted'))
    return out(
      'awaiting-merge',
      'remediation-drafted — draft PR open, human merges',
    );

  // 3. Explicit non-bug closes-in-waiting. Never actionable, never reopened.
  if (
    has(labels, 'wontfix') ||
    has(labels, 'invalid') ||
    has(labels, 'duplicate') ||
    wontfix.has(num)
  )
    return out('wontfix', 'labelled/ledgered as not-a-bug');

  // 4. Release-health promote gate — a crash-free-rate signal, not a code defect.
  //    (Mislabelled `bug` by release-health.mjs today; the prefix is authoritative.)
  if (
    has(labels, 'release-health') ||
    titleIs(title, /^\s*\[release health\]/i)
  )
    return out(
      'release-health',
      'promote gate (crash-free rate), not a code bug',
    );

  // 4a. Owner decision — the investigate step (or the owner) judged that the fix
  //     needs a design / copy / product call, not evidence. Wins over every human
  //     lane AND over `bug`, so a mislabelled bug cannot be auto-drafted past a
  //     pending decision. Never loop-eligible. The daily card lists this bucket.
  if (has(labels, 'needs-decision'))
    return out(
      'decision',
      'needs an owner decision (design / copy / product) — never auto-drafted',
    );

  // 4b. PROMOTED — a human-lane issue (TestFlight, store review, hand-filed,
  //     email) that carries a validated `### Evidence` block. The label is applied
  //     only by the owner, by sprint kickoff, or by the loop's read-only
  //     investigate step AFTER scripts/lib/evidence-block.mjs validates the
  //     block; no collector may stamp it. It sits here so rules 1–4 keep winning
  //     (incident umbrella, already drafted, wontfix, release-health) while the
  //     human-lane rules below (5, 6, 9) no longer swallow it. The remediate
  //     skill re-validates the block before it drafts (belt and suspenders).
  if (has(labels, 'loop-actionable')) {
    const loopEligible = !pinned && !fixedIn;
    const reason = pinned
      ? 'promoted with evidence but pinned-open (under active work — loop skips)'
      : fixedIn
        ? `promoted with evidence but already fixed in build ${fixedIn} (pending verify/close — loop skips)`
        : 'promoted with evidence (loop-actionable label)';
    return out('actionable', reason, {loopEligible});
  }

  // 5. Store review — a star review, no stack. (Often mislabelled `bug`.)
  if (
    has(labels, 'user-review') ||
    titleIs(title, /^\s*\[(play|app ?store) ★/i)
  ) {
    const isFeature =
      has(labels, 'enhancement') || has(labels, 'feature-request');
    return out(
      'review',
      isFeature
        ? 'store review — feature ask'
        : 'store review — complaint/praise (no stack)',
      {isFeature},
    );
  }

  // 6. Feature request / enhancement (non-review).
  if (has(labels, 'enhancement') || has(labels, 'feature-request'))
    return out('feature-request', 'feature request / enhancement', {
      isFeature: true,
    });

  // 7. Native Play crash / ANR — `play-store` + crash|anr, no JS stack. A human/
  //    device investigation; surfaced, never auto-drafted blind. (When it shares a
  //    root cause with a Sentry issue, incident-correlate umbrellas them and the
  //    Sentry side is the actionable one.)
  if (has(labels, 'play-store') && (has(labels, 'crash') || has(labels, 'anr')))
    return out(
      'native-crash',
      'native Play crash/ANR — no JS stack, human/device investigation',
    );

  // 8. Investigation — posthog funnels + anything tagged investigate/investigating.
  //    No stack trace; a person decides if it's a real regression vs low-volume noise.
  if (
    has(labels, 'posthog') ||
    has(labels, 'investigate') ||
    has(labels, 'investigating')
  )
    return out(
      'investigation',
      'no stack — human investigation (posthog/investigate)',
    );

  // 9. Any TestFlight / App Store tester submission (feedback, screenshot, OR a
  //    tester-reported crash) — a screenshot + free-text comment is not a stack;
  //    it is a human/content judgment (the #110/#115 first-ayah pair was ruled NOT
  //    a bug after investigation; #234 "how do I switch to Arabic-only" is a how-to,
  //    not a defect). The genuinely loop-actionable iOS signal comes from Sentry,
  //    not from here. Store reviews were already split off in step 5. The category
  //    label the collector stamped (`bug`/`loading`/…) is advisory, not a fix order.
  //    `email` is the (deferred) free-form inbox lane and a bare `feedback` label
  //    is the repaired hand-filed template — same posture: a human report is a
  //    claim, not evidence; it reaches the loop only via rule 4b.
  if (
    has(labels, 'testflight') ||
    has(labels, 'app-store') ||
    has(labels, 'email') ||
    has(labels, 'feedback')
  )
    return out(
      'feedback',
      'tester feedback/submission — human/content judgment, not auto-drafted',
    );

  // 10. ACTIONABLE — a real bug/sentry signal with a stack/reproducible shape that
  //     survived every exclusion above. The ONLY bucket the loop drafts from — but
  //     only when it is neither pinned-open (under active work) nor already fixed in
  //     a merged build (pending verify+close). Those are surfaced, never re-drafted.
  if (has(labels, 'sentry') || has(labels, 'bug') || has(labels, 'crash')) {
    const loopEligible = !pinned && !fixedIn;
    const reason = pinned
      ? 'actionable but pinned-open (under active work — loop skips)'
      : fixedIn
        ? `actionable but already fixed in build ${fixedIn} (pending verify/close — loop skips)`
        : 'actionable bug/sentry with a stack';
    return out('actionable', reason, {loopEligible});
  }

  // 11. Anything else — surface it so nothing is silently dropped.
  return out('other', 'uncategorised — needs a human glance');
}

// Parse triage-state.md → {pinnedOpen:Set<number>, wontfix:Set<number>,
// fixedInBuild:Map<number,string>}. The ledger has three `## ` sections; each
// `#<n>` LEFT of the first em-dash on a bullet is a subject.
export function parseTriageState(md) {
  const pinnedOpen = new Set();
  const wontfix = new Set();
  const fixedInBuild = new Map();
  let section = null;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^##\s+(.*)/);
    if (h) {
      const t = h[1].toLowerCase();
      section = t.startsWith('pinned open')
        ? 'pinned'
        : t.startsWith('resolved') ||
            t.includes('do not reopen') ||
            t.startsWith("won't fix") ||
            t.startsWith('wont fix')
          ? 'wontfix'
          : t.startsWith('fixed in build')
            ? 'fixed'
            : null;
      continue;
    }
    if (!section || !/^\s*[-*]/.test(raw)) continue;
    // Only the issue refs LEFT of the first em-dash are the bullet's SUBJECTS;
    // anything after it is prose ("— duplicate of #165", "— fixed (#62)") whose
    // #<n> must NOT be captured (that target is often an active/pinned issue).
    const subjectPart = raw.split('—')[0];
    const nums = [...subjectPart.matchAll(/#(\d+)/g)].map(m => Number(m[1]));
    if (!nums.length) continue;
    if (section === 'pinned') pinnedOpen.add(nums[0]);
    else if (section === 'wontfix') nums.forEach(n => wontfix.add(n));
    else if (section === 'fixed') {
      // `#<n> — fixed-in:<versionCode> — <what>` — capture the build for display.
      const v = raw.match(/fixed-in:\s*([\w.+]+)/i);
      fixedInBuild.set(nums[0], v ? v[1] : 'merged');
    }
  }
  return {pinnedOpen, wontfix, fixedInBuild};
}
