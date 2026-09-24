// @ai
//
// scripts/lib/evidence-block.mjs
// ------------------------------
// Parse + validate the `### Evidence` block that promotes a human-lane issue
// (TestFlight feedback, store review, hand-filed report, email) into the fix
// loop. The block is the contract between the read-only investigate step and
// the remediate step: the investigate step WRITES it (as an issue comment) and
// applies the `loop-actionable` label only when validate() says ok; the
// remediate step RE-VALIDATES it before it opens a branch. Both sides run this
// same parser, so the label alone never earns a draft PR.
//
// Shape (Markdown bullets, case-insensitive keys, one per line):
//
//   ### Evidence
//   - Platform: android            android | ios | both
//   - Builds: 1712-1717            affected build range (build number = versionCode)
//   - Bug class: B                 A = logic/data/config (Jest) · B = render/native/device (Maestro/ADB)
//   - Signature: ExpoKeepAwake.deactivate   regex for scripts/android-device-smoke.sh --signature
//   - Sentry: QARIAHV2-C (8 events / 4 users, releases 3.2.0+1713..3.2.1+1718)
//   - PostHog: distinct_id 1b2c… — playback_started → playback_killed_in_background (2026-09-01T19:02Z)
//   - Repro: Pixel 3 · build 1717 · steps: … · observed: … · expected: … · artifact: planning/boot-gate-evidence/…
//
// Required: Platform, Builds, Bug class, Signature, and AT LEAST ONE hard
// pointer — Sentry (a shortId with an events/users count), PostHog (a
// distinct_id plus a fault-event sequence), or Repro (device, build, steps,
// observed, expected). Prose alone never validates: "the app crashes sometimes"
// has no pointer, so #234-style how-tos and #110/#115-style content judgments
// fail here by construction.
//
// CLI (used by qariah-triage-remediate Step 2 and by the investigate step):
//   node scripts/lib/evidence-block.mjs --file=body.md    # or --file body.md
//   gh issue view <n> --json body,comments -q '.body, (.comments[].body)' \
//     | node scripts/lib/evidence-block.mjs                 # or stdin
//   → prints JSON {ok, missing, pointers, fields}; exit 0 when ok, 1 when not.
//
// EXIT 2 IS NOT A VERDICT. An empty read — a `gh` call that failed, a typo'd
// path, `--file` with no value, or a terminal with nothing piped in — exits 2
// with {ok:false, error:...} and NEVER the ordinary
// {ok:false, missing:["evidence block"]} shape. Those two used to be
// indistinguishable, so a broken fetch read as "this issue has no evidence"
// and would silently hold a bug that was properly documented.

import {readFileSync} from 'node:fs';

export const HEADING_RE = /^#{2,4}\s*evidence\s*$/im;
export const MARKER_RE = /<!--\s*evidence:v1\s*-->/i;

export const REQUIRED_FIELDS = ['platform', 'builds', 'bug class', 'signature'];
export const POINTER_FIELDS = ['sentry', 'posthog', 'repro'];

const SENTRY_SHORT_RE = /\b[A-Z][A-Z0-9]+-[A-Z0-9]{1,4}\b/;
const COUNT_RE = /\d+\s*(events?|users?|sessions?)/i;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const BUILD_RE = /\b\d{3,5}\b/;
const REPRO_PARTS = ['steps', 'observed', 'expected'];

/**
 * Extract the LAST evidence block in `text` (a later comment supersedes an
 * earlier one). Returns the raw block text or null when no heading/marker.
 */
export function extractBlock(text) {
  const src = String(text || '');
  const lines = src.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i]) || MARKER_RE.test(lines[i])) start = i;
  }
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    // The block ends at the next Markdown heading or an HTML comment.
    if (/^#{1,6}\s/.test(lines[i]) || /^<!--/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim() || null;
}

/** Parse `- Key: value` bullets → {key(lowercase): value}. */
export function parseFields(block) {
  const fields = {};
  for (const raw of String(block || '').split('\n')) {
    const m = raw.match(
      /^\s*[-*]\s*([A-Za-z][A-Za-z _/-]{0,30}?)\s*:\s*(.+?)\s*$/,
    );
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    if (!fields[key]) fields[key] = m[2].trim();
  }
  return fields;
}

function pointerOk(kind, value) {
  const v = String(value || '');
  if (!v || /^(none|n\/a|—|-)$/i.test(v)) return false;
  if (kind === 'sentry') return SENTRY_SHORT_RE.test(v) && COUNT_RE.test(v);
  if (kind === 'posthog') return UUID_RE.test(v) && /→|->|=>/.test(v);
  if (kind === 'repro') {
    const low = v.toLowerCase();
    return BUILD_RE.test(v) && REPRO_PARTS.every(p => low.includes(`${p}:`));
  }
  return false;
}

/**
 * @param {string} text  issue body + comments concatenated (any order)
 * @returns {{ok:boolean, missing:string[], pointers:string[], fields:object, block:?string}}
 */
export function validate(text) {
  const block = extractBlock(text);
  if (!block) {
    return {
      ok: false,
      missing: ['evidence block'],
      pointers: [],
      fields: {},
      block: null,
    };
  }
  const fields = parseFields(block);
  const missing = [];

  const platform = (fields.platform || '').toLowerCase();
  if (!/^(android|ios|both)\b/.test(platform))
    missing.push('platform (android|ios|both)');
  if (!BUILD_RE.test(fields.builds || ''))
    missing.push('builds (affected build range)');
  if (!/^[ab]\b/i.test(fields['bug class'] || ''))
    missing.push('bug class (A|B)');
  if (
    !(fields.signature || '').trim() ||
    /^(none|n\/a|—|-)$/i.test(fields.signature)
  )
    missing.push('signature (regex for android-device-smoke.sh --signature)');

  const pointers = POINTER_FIELDS.filter(k => pointerOk(k, fields[k]));
  if (!pointers.length)
    missing.push(
      'at least one hard pointer (sentry shortId+count | posthog distinct_id+sequence | repro device+build+steps+observed+expected)',
    );

  return {ok: missing.length === 0, missing, pointers, fields, block};
}

/** Render a skeleton block from partial fields (used by debug-id-lookup). */
export function renderSkeleton(fields = {}) {
  const f = k => fields[k] || '<fill>';
  return [
    '### Evidence',
    `- Platform: ${f('platform')}`,
    `- Builds: ${f('builds')}`,
    `- Bug class: ${f('bug class')}`,
    `- Signature: ${f('signature')}`,
    `- Sentry: ${f('sentry')}`,
    `- PostHog: ${f('posthog')}`,
    `- Repro: ${f('repro')}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const fail = (error, hint) => {
    console.error(`evidence-block: ${error}${hint ? ` — ${hint}` : ''}`);
    console.log(JSON.stringify({ok: false, error}, null, 2));
    process.exit(2);
  };

  // Accept BOTH `--file=path` and `--file path`. The docstring showed the
  // space form while only the `=` form parsed, so the space form fell through
  // to stdin and read nothing.
  let file = null;
  const eq = argv.find(a => a.startsWith('--file='));
  if (eq) file = eq.slice(7);
  else {
    const i = argv.indexOf('--file');
    if (i !== -1) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        fail('--file given with no path');
      }
      file = argv[i + 1];
    }
  }

  let text;
  if (file) {
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      fail(`cannot read ${file}`, err.code || String(err));
    }
  } else {
    // A TTY means nobody piped anything in; reading would just block or
    // return empty and be mistaken for a real "no evidence" verdict.
    if (process.stdin.isTTY) {
      fail('no input', 'pass --file=<path> or pipe the issue text on stdin');
    }
    try {
      text = readFileSync(0, 'utf8');
    } catch (err) {
      fail('cannot read stdin', err.code || String(err));
    }
  }

  if (!String(text || '').trim()) {
    fail(
      'empty input',
      file ? `${file} is empty` : 'stdin was empty — did the `gh` call fail?',
    );
  }

  const res = validate(text);
  console.log(
    JSON.stringify(
      {
        ok: res.ok,
        missing: res.missing,
        pointers: res.pointers,
        fields: res.fields,
      },
      null,
      2,
    ),
  );
  process.exit(res.ok ? 0 : 1);
}
