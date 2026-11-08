// @ai
//
// scripts/lib/upstream-seam.mjs — the seam record of the weekly upstream sync.
// ---------------------------------------------------------------------------
// Pure functions for scripts/upstream-seam.mjs (the CLI reads git and GitHub
// and calls these). One record per sync in docs/operations/upstream-conflicts.ndjson:
// the date, the upstream commit, each conflict file with the way it was
// resolved, and the minutes. The report counts the files that conflicted most
// in a window, with their DIVERGENCE_LEDGER.md rows. The proposal writes a
// draft RFC seed for the top file in the docs/rfcs/000-template.md shape.
//
// Resolution kinds (the `resolution` field of a conflict entry):
//   three-way            keep the Qariah lines of the ledger rows, take the rest from upstream
//   three-way-unrecorded as three-way, but no ledger row names the file: add the row
//   take-ours            the Qariah file wins (a Qariah-owned file at a shared path)
//   take-theirs          the upstream file wins
//   take-theirs-recheck  take upstream, then re-apply a Qariah line only when a commit explains it
//   accept-delete        upstream removed or moved the file; the Qariah lines go where the content went
//   regenerate           a lockfile: resolve its source first, then regenerate it
//   held                 a seam file: the owner decides (the sync is HELD)

/** Lockfiles and generated files that are never resolved by hand. */
export const REGENERATED = {
  'package-lock.json':
    'resolve package.json first, then `npm install --package-lock-only`; never `--no-package-lock`',
  'ios/Podfile.lock':
    "take upstream's file; the Mac build runs `pod install` and the auto-sprint commits the result on the sync branch",
};

/** A conflict status from `git status --porcelain` (two letters). */
export function statusKind(xy) {
  const s = String(xy || '').trim();
  if (s === 'UU') return 'both-modified';
  if (s === 'AA') return 'both-added';
  if (s === 'UD') return 'ours-modified-theirs-deleted';
  if (s === 'DU') return 'ours-deleted-theirs-modified';
  if (s === 'UA') return 'theirs-added';
  if (s === 'AU') return 'ours-added';
  if (s === 'DD') return 'both-deleted';
  return s || 'unknown';
}

/** "12+3-" → 15 changed lines. */
export function changedLines(numstat) {
  const m = /^(\d+)\+(\d+)-$/.exec(String(numstat || ''));
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

/** True when the path is under one of the seam prefixes (auth, user-state, branding, flags, catalog). */
export function isSeamPath(file, seamPaths) {
  return (seamPaths || []).some(p =>
    p.endsWith('/') ? file.startsWith(p) : file === p,
  );
}

/**
 * The resolution plan of one conflict file, from its facts.
 * @param {{file:string, status:string, ours:string, theirs:string, hunks:number, ledgerRows:number}} f
 * @param {{seamPaths?:string[], smallChange?:number}} o
 * @returns {{resolution:string, note:string}}
 */
export function planFor(f, o = {}) {
  const small = o.smallChange ?? 10;
  const file = f.file;
  if (isSeamPath(file, o.seamPaths))
    return {
      resolution: 'held',
      note: 'a Qariah seam file (auth, user-state, branding, flags, catalog): the owner decides',
    };
  if (REGENERATED[file])
    return {resolution: 'regenerate', note: REGENERATED[file]};
  if (/^ios\/.*\.pbxproj$/.test(file))
    return {
      resolution: 'take-ours',
      note: 'the Qariah Xcode project is plugin-driven (`expo prebuild`); upstream has no Qariah target',
    };
  const kind = statusKind(f.status);
  const oursN = changedLines(f.ours);
  const ledger = Number(f.ledgerRows || 0);
  if (kind === 'ours-modified-theirs-deleted')
    return {
      resolution: 'accept-delete',
      note: 'upstream removed or moved the file: find where the content went (`git log --diff-filter=D upstream/develop -- <file>`) and re-apply the Qariah lines there (ledger row)',
    };
  if (kind === 'ours-deleted-theirs-modified' || kind === 'theirs-added')
    return {resolution: 'take-theirs', note: 'Qariah has no copy of this file'};
  if (kind === 'both-deleted')
    return {resolution: 'take-theirs', note: 'both sides removed it'};
  if (kind === 'both-added')
    return ledger > 0
      ? {
          resolution: 'three-way',
          note: 'both sides added the file; keep the Qariah lines of the ledger rows, take the rest from upstream',
        }
      : {
          resolution: 'take-theirs-recheck',
          note: 'both sides added the file with no ledger row: when the Qariah copy is the version that upstream merged, take upstream; else keep both parts and add the ledger row',
        };
  // both-modified
  if (ledger > 0)
    return {
      resolution: 'three-way',
      note: `${ledger} ledger row${ledger === 1 ? '' : 's'}: keep the Qariah lines they name, take the rest from upstream (\`git show <ref>:<file>\` on both sides)`,
    };
  if (oursN <= small)
    return {
      resolution: 'take-theirs-recheck',
      note: `no ledger row and a small Qariah change (${f.ours}): take upstream, then re-apply a Qariah line only when a commit explains it (\`git log origin/qariah-main -- <file>\`)`,
    };
  return {
    resolution: 'three-way-unrecorded',
    note: `no ledger row and a Qariah change of more than ${small} lines (${f.ours}; upstream ${f.theirs}): resolve by hand and add the ledger row`,
  };
}

/**
 * The hold reasons of a sync. An empty list means the Steward may open the PR ready.
 * @param {{conflicts:Array<{file:string,resolution?:string}>, expoMajor?:{ours:number,theirs:number}}} rec
 * @param {{seamPaths?:string[], maxConflictFiles?:number}} policy
 */
export function holdReasons(rec, policy = {}) {
  const out = [];
  const seams = (rec.conflicts || [])
    .filter(c => isSeamPath(c.file, policy.seamPaths))
    .map(c => c.file);
  if (seams.length) out.push(`seam file conflict: ${seams.join(', ')}`);
  const e = rec.expoMajor;
  if (e && e.ours && e.theirs && e.theirs !== e.ours)
    out.push(
      `Expo major ${e.ours} → ${e.theirs}: a native absorption needs a Mac (prebuild, pod install) and a human sprint`,
    );
  const max = policy.maxConflictFiles;
  const n = (rec.conflicts || []).length;
  if (max && n > max)
    out.push(`${n} conflict files is more than the limit of ${max}`);
  return out;
}

/** The Expo major of a package.json text, or 0. */
export function expoMajorOf(packageJsonText) {
  try {
    const dep = JSON.parse(packageJsonText).dependencies?.expo || '';
    const m = /(\d+)/.exec(dep);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/**
 * Build one record line.
 * @param {object} meta  {date, upstream, base, mainHead, mode, commits, filesChanged, issue?, syncPr?, minutes?, expoMajor?}
 * @param {Array} facts  the per-file facts (see planFor)
 * @param {object} policy
 */
export function buildRecord(meta, facts, policy = {}) {
  const conflicts = facts.map(f => {
    const plan = planFor(f, policy);
    return {
      file: f.file,
      kind: statusKind(f.status),
      ours: f.ours,
      theirs: f.theirs,
      hunks: Number(f.hunks || 0),
      ledgerRows: Number(f.ledgerRows || 0),
      resolution: f.resolution || plan.resolution,
      note: f.note || plan.note,
    };
  });
  const rec = {
    date: meta.date,
    upstream: meta.upstream,
    base: meta.base,
    mainHead: meta.mainHead,
    mode: meta.mode || 'dry-run',
    issue: meta.issue ?? null,
    syncPr: meta.syncPr ?? null,
    commits: meta.commits ?? null,
    filesChanged: meta.filesChanged ?? null,
    expoMajor: meta.expoMajor ?? null,
    conflicts,
    minutes: meta.minutes ?? 0,
  };
  rec.held = holdReasons(rec, policy);
  return rec;
}

/** Parse the ndjson text. A bad line throws with its number. */
export function parseRecords(text) {
  return String(text || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(
          `upstream-conflicts.ndjson line ${i + 1}: ${e.message}`,
        );
      }
    });
}

/** The records whose date is inside the last `days` days up to `today` (ISO date strings). */
export function inWindow(records, today, days = 90) {
  const end = Date.parse(today + 'T00:00:00Z');
  const start = end - days * 86400000;
  return records.filter(r => {
    const t = Date.parse(String(r.date) + 'T00:00:00Z');
    return t >= start && t <= end;
  });
}

/** The ledger rows (table lines) that name the file. Returns {area, upstreamable, status, line}[]. */
export function ledgerRowsFor(ledgerText, file) {
  const needle = '`' + file + '`';
  const out = [];
  for (const line of String(ledgerText || '').split('\n')) {
    if (!line.startsWith('|') || !line.includes(needle)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(c => c.trim());
    if (cells.length < 2 || cells[0] === 'Area' || /^-+$/.test(cells[0]))
      continue;
    out.push({
      area: cells[0].slice(0, 120),
      upstreamable: cells.length >= 6 ? cells[3].slice(0, 40) : '',
      status: cells.length >= 6 ? cells[4].slice(0, 80) : '',
      line,
    });
  }
  return out;
}

/**
 * The files that conflicted most in the window.
 * @returns {Array<{file:string, syncs:number, dates:string[], resolutions:Object<string,number>, rows:Array}>}
 */
export function reportRows(records, ledgerText, {top = 15} = {}) {
  const byFile = new Map();
  for (const r of records)
    for (const c of r.conflicts || []) {
      const row = byFile.get(c.file) || {
        file: c.file,
        syncs: 0,
        hunks: 0,
        dates: [],
        resolutions: {},
      };
      row.syncs += 1;
      row.hunks += Number(c.hunks || 0);
      row.dates.push(r.date);
      row.resolutions[c.resolution || '?'] =
        (row.resolutions[c.resolution || '?'] || 0) + 1;
      byFile.set(c.file, row);
    }
  // Ties (one sync recorded) rank by the conflict hunks: the file that costs most first.
  const rows = [...byFile.values()].sort(
    (a, b) =>
      b.syncs - a.syncs || b.hunks - a.hunks || a.file.localeCompare(b.file),
  );
  for (const row of rows.slice(0, top))
    row.rows = ledgerRowsFor(ledgerText, row.file);
  return rows.slice(0, top);
}

/** The report as Markdown (the Steward posts it on the sync PR). */
export function renderReport(rows, {days, today, syncs}) {
  const lines = [
    `### Upstream seam report — ${today}`,
    '',
    `The files that conflicted most in the last ${days} days (${syncs} sync${syncs === 1 ? '' : 's'} recorded). A file with no ledger row is an unrecorded divergence: add the row, or take upstream's file.`,
    '',
    '| File | Syncs | Hunks | Resolutions | Ledger rows |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const res = Object.entries(r.resolutions)
      .map(([k, v]) => `${k} ×${v}`)
      .join(', ');
    const ledger = r.rows.length
      ? r.rows
          .slice(0, 3)
          .map(x => `${x.upstreamable || '—'} · ${x.status || x.area}`)
          .join('<br>') +
        (r.rows.length > 3 ? `<br>+${r.rows.length - 3} more` : '')
      : '**none**';
    lines.push(
      `| \`${r.file}\` | ${r.syncs} | ${r.hunks} | ${res} | ${ledger} |`,
    );
  }
  if (!rows.length) lines.push('| — | 0 | 0 | — | — |');
  return lines.join('\n') + '\n';
}

/** A slug for a file path. */
export function slugOf(file) {
  return String(file)
    .toLowerCase()
    .replace(/\.[a-z]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Resolutions that a seam can remove. A lockfile, a delete or a plain take-theirs needs no RFC. */
export const PROPOSABLE = new Set([
  'three-way',
  'three-way-unrecorded',
  'take-ours',
  'held',
]);

/** The best file for an RFC seed: the top row whose resolutions a seam removes. */
export function proposalCandidate(rows) {
  return (
    rows.find(r => Object.keys(r.resolutions).some(k => PROPOSABLE.has(k))) ||
    null
  );
}

/**
 * The RFC seed for the top file, in the docs/rfcs/000-template.md shape. It is a
 * draft for the fork's planning tree: the qariah-rfc-author skill turns it into
 * an RFC. It never goes upstream as written: it names fork rows, which rule 1
 * of CONTRIBUTING-QARIAH.md "Write upstream RFCs" forbids in the RFC itself.
 */
export function renderSeed(row, {today, days}) {
  const rowsText = row.rows.length
    ? row.rows
        .map(
          x =>
            `- ${x.area} — upstream-able: ${x.upstreamable || '?'}; status: ${x.status || '?'}`,
        )
        .join('\n')
    : '- (no ledger row names this file: the divergence is unrecorded)';
  return `# RFC-NNN: A seam for \`${row.file}\` (seed)

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Status   | Seed — a draft in the fork, not posted                         |
| Date     | ${today}                                                       |
| Author   | the Upstream Steward (draft); a person signs it                 |

> This seed is fork-internal. Before it becomes an RFC, remove every fork reference below (ledger rows, dates of syncs, this note), give it the next free number, and follow the \`qariah-rfc-author\` skill.

## Summary

\`${row.file}\` conflicted in ${row.syncs} of the upstream syncs of the last ${days} days (${row.dates.join(', ')}). The fork keeps its own lines in this file, and each sync resolves the same hunks again. This RFC proposes a configuration seam in Bayaan, so that a fork sets its values without a change to the shared file.

## Motivation

The divergence ledger records these rows for the file:

${rowsText}

Resolutions so far: ${Object.entries(row.resolutions)
    .map(([k, v]) => `${k} ×${v}`)
    .join(', ')}.

Each conflict costs a three-way resolution and a verification beta. A seam removes the conflict for every fork.

## Decision

(Write the seam: the config key or the provider interface, with the TypeScript. Keep the upstream default equal to Bayaan's current behaviour.)

## Alternatives considered

- Keep the fork lines in the shared file (the current state): a conflict at each sync.
- Take upstream's file and drop the fork lines: the fork loses the behaviour the ledger rows describe.

## Consequences

- **Positive:** the file stays byte-identical to upstream in the fork.
- **Neutral:** Bayaan's behaviour does not change.
- **Negative / risks:** one more config key to document.

## How we'll know it worked

\`git diff upstream/develop -- ${row.file}\` is empty in the fork after the seam lands, and the file does not appear in the next seam report.
`;
}
