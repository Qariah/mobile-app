// @ai-start
/**
 * The decision logic of scripts/upload-catalog.mjs (TECH_DEBT #298).
 *
 * upload-catalog.mjs writes the bundled catalog (assets/data/catalog.json)
 * straight to the live catalog key. The ops console owns the live catalog
 * and writes four keys for each change: the live catalog, a history snapshot,
 * the version pointer and an audit line (hard-rule #14). The upload script
 * writes the first key only. A bundle that is older than the live catalog
 * would remove live data, and nothing would record it.
 *
 * This module holds the pure part: it decides, from data, whether the write
 * may go ahead. It reads nothing and writes nothing. The script reads R2 and
 * calls these functions.
 *
 * The rule: without the force flag, the script writes only when no live
 * catalog exists (the first upload). When the live catalog equals the bundle,
 * there is nothing to write. Every other case is refused. The bundle has no
 * record of the live version that it came from, so the script cannot prove
 * that the bundle descends from the live catalog.
 *
 * `findBundleVersion` finds the history version that equals the bundle. That
 * makes the refusal text exact ("the live catalog is v93, the bundle is a copy
 * of v89"). It does not change the decision.
 *
 * An invalid bundle is refused in every case. The force flag does not
 * override that.
 */
import {diffCatalogs, validateCatalog} from '../sync-bundled-catalog.mjs';

/** How many history versions `findBundleVersion` reads, newest first. */
export const LINEAGE_LOOKBACK = 15;

export const FORCE_FLAG = '--force-overwrite-live';

/** JSON text of a value. The keys of every object are in sorted order. */
export function canonicalJson(value) {
  const sorted = v => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map(k => [k, sorted(v[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sorted(value));
}

/** The reciter list of a catalog document: an array, or {reciters: [...]}. */
export function reciterList(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.reciters)) return doc.reciters;
  return null;
}

/**
 * Find the history version that equals the bundle. Read the versions from
 * `latestVersion` down, at most `lookback` of them, and stop at the first
 * match.
 *
 * @param {object} options
 * @param {object[]} options.bundle the bundled reciter list
 * @param {number} options.latestVersion the version in catalog-version.json
 * @param {(version: number) => Promise<object[] | null>} options.readVersion
 *   returns the reciter list of one history version, or null when the
 *   version does not exist
 * @param {number} [options.lookback] how many versions to read at most
 * @returns {Promise<{version: number | null, checked: number, unreadable: number}>}
 *   `version` is the match, or null. `checked` counts the versions that the
 *   function compared. `unreadable` counts the versions that it could not
 *   read (a missing version, or a read error); they never count as a match.
 */
export async function findBundleVersion({
  bundle,
  latestVersion,
  readVersion,
  lookback = LINEAGE_LOOKBACK,
}) {
  const want = canonicalJson(bundle);
  let checked = 0;
  let unreadable = 0;
  const oldest = Math.max(1, latestVersion - lookback + 1);
  for (let version = latestVersion; version >= oldest; version--) {
    let list = null;
    try {
      list = await readVersion(version);
    } catch {
      list = null;
    }
    if (!Array.isArray(list)) {
      unreadable++;
      continue;
    }
    checked++;
    if (canonicalJson(list) === want) return {version, checked, unreadable};
  }
  return {version: null, checked, unreadable};
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function nameList(names, limit = 8) {
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit
    ? `${shown}, and ${names.length - limit} more`
    : shown;
}

/** What a write of the bundle over the live catalog would change. */
function changeLines(liveList, bundle) {
  const d = diffCatalogs(liveList, bundle);
  const lines = [];
  if (d.removed.length > 0) {
    lines.push(
      `The write would REMOVE ${plural(d.removed.length, 'reciter')} that the live catalog has: ${nameList(d.removed)}.`,
    );
  }
  if (d.changed.length > 0) {
    lines.push(
      `The write would CHANGE ${plural(d.changed.length, 'reciter')}: ${nameList(d.changed)}.`,
    );
  }
  if (d.added.length > 0) {
    lines.push(
      `The write would add ${plural(d.added.length, 'reciter')}: ${nameList(d.added)}.`,
    );
  }
  if (d.recitationsRemoved > 0 || d.recitationsAdded > 0) {
    lines.push(
      `Recitations: ${d.recitationsAdded} added, ${d.recitationsRemoved} removed.`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      'The reciter lists have the same names and recitations. Other fields differ.',
    );
  }
  return lines;
}

const CANNOT_COMPARE =
  'The live catalog has rows that the script cannot compare.';

/**
 * `changeLines`, but a malformed live row (for example a null row, or a row
 * with no `rewayat`) gives one line and not a TypeError. The live data is not
 * validated, so this must not stop the guard. The decision does not depend on
 * these lines. Without this, even the force flag could not proceed.
 */
function safeChangeLines(liveList, bundle) {
  try {
    return changeLines(liveList, bundle);
  } catch {
    return [CANNOT_COMPARE];
  }
}

const WHY_NOT_SAFE =
  'This script writes only catalog/catalog-v1.json. It adds no history version, ' +
  'does not change the version pointer, and writes no audit line (hard-rule #14).';

const USE_MUTATE =
  'To change the live catalog, use: node scripts/catalog-r2-mutate.mjs --transform=<module> --dry-run';

/**
 * Decide whether the bundle may replace the live catalog.
 *
 * @param {object} options
 * @param {object[]} options.bundle the bundled reciter list
 * @param {unknown} options.live the live catalog document, as parsed JSON.
 *   Use null when the live catalog does not exist. A value that is not a
 *   catalog (for example `{}` for a body that did not parse) counts as an
 *   unreadable live catalog.
 * @param {number | null} [options.liveVersion] the version in
 *   catalog-version.json, or null when it is not known
 * @param {{version: number | null, checked: number} | null} [options.lineage]
 *   the result of `findBundleVersion`, or null when it did not run
 * @param {boolean} [options.force] the --force-overwrite-live flag
 * @returns {{write: boolean, outcome: string, reason: string, lines: string[]}}
 *   `outcome` is one of: first-upload, identical, forced, bundle-invalid,
 *   live-newer, live-changed, lineage-unknown, live-unreadable.
 *   `write` is true only for first-upload and forced. `reason` is one
 *   sentence. `lines` holds the details, and for a refusal the next steps.
 */
export function decideCatalogOverwrite({
  bundle,
  live,
  liveVersion = null,
  lineage = null,
  force = false,
}) {
  const problems = validateCatalog(bundle);
  if (problems.length > 0) {
    return {
      write: false,
      outcome: 'bundle-invalid',
      reason: `The bundled catalog failed ${plural(problems.length, 'check')}. The flag does not override this.`,
      lines: problems.slice(0, 10),
    };
  }

  if (live === null || live === undefined) {
    return {
      write: true,
      outcome: 'first-upload',
      reason: 'No live catalog exists. This is the first upload.',
      lines: [],
    };
  }

  const liveList = reciterList(live);
  if (liveList !== null && canonicalJson(liveList) === canonicalJson(bundle)) {
    return {
      write: false,
      outcome: 'identical',
      reason:
        'The live catalog already equals the bundled catalog. There is nothing to write.',
      lines: [],
    };
  }

  const details =
    liveList === null
      ? [
          'The live catalog is not a list of reciters, so no comparison is possible.',
        ]
      : safeChangeLines(liveList, bundle);
  if (force) {
    const copy =
      lineage?.version != null
        ? ` The bundled catalog is a copy of v${lineage.version}.`
        : '';
    return {
      write: true,
      outcome: 'forced',
      reason: `${FORCE_FLAG} is set. The write replaces the live catalog.${copy}`,
      lines: [...details, WHY_NOT_SAFE],
    };
  }

  let outcome;
  let reason;
  if (liveList === null) {
    outcome = 'live-unreadable';
    reason =
      'The live catalog is not a list of reciters. The script cannot compare it.';
  } else if (
    lineage?.version != null &&
    liveVersion !== null &&
    lineage.version < liveVersion
  ) {
    const behind = liveVersion - lineage.version;
    outcome = 'live-newer';
    reason =
      `The live catalog is v${liveVersion}. The bundled catalog is a copy of v${lineage.version}. ` +
      `The write would lose ${plural(behind, 'newer version')} of the live catalog.`;
  } else if (lineage?.version != null && lineage.version === liveVersion) {
    outcome = 'live-changed';
    reason =
      `The bundled catalog equals v${liveVersion}, but the live catalog differs from v${liveVersion}. ` +
      'Something changed the live catalog without a new version.';
  } else {
    outcome = 'lineage-unknown';
    const looked =
      lineage && lineage.checked > 0
        ? `The bundled catalog matches none of the last ${plural(lineage.checked, 'version')}`
        : 'The bundled catalog differs from the live catalog';
    const liveNote =
      liveVersion === null ? '' : ` The live catalog is v${liveVersion}.`;
    reason = `${looked}. The script cannot show that the bundle comes from the live catalog.${liveNote}`;
  }

  return {
    write: false,
    outcome,
    reason,
    lines: [
      ...details,
      WHY_NOT_SAFE,
      USE_MUTATE,
      `To overwrite anyway, run again with ${FORCE_FLAG}.`,
    ],
  };
}
// @ai-end
