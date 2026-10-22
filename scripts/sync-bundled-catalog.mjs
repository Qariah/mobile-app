#!/usr/bin/env node
// Refresh the bundled fallback catalog (assets/data/catalog.json) from the live R2 catalog.
//
// The app shows the bundled catalog on a first launch with an empty cache
// (featureFlags.bundleFirstCatalog) and when the killswitch is on. The ops
// console writes only R2, so the bundled copy goes stale unless somebody runs
// this before a release build. On 2026-10-18 it was a Sprint 28 copy: it had no
// Samia Mubarak (added in the live catalog later) and 4 older reciter entries.
//
// This script only reads the live catalog. It never writes R2. To change the
// live catalog, use the ops console (the 4-key write, hard-rule #14).
//
// Usage:
//   node scripts/sync-bundled-catalog.mjs           # dry run: print what would change
//   node scripts/sync-bundled-catalog.mjs --apply   # write assets/data/catalog.json
//   node scripts/sync-bundled-catalog.mjs --check   # exit 1 when the bundle differs from live
//
// The catalog URL comes from EXPO_PUBLIC_CATALOG_URL in the environment, then
// from .env.local at the repository root.

import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_PATH = path.join(REPO_ROOT, 'assets', 'data', 'catalog.json');

export function catalogUrl(env = process.env, root = REPO_ROOT) {
  if (env.EXPO_PUBLIC_CATALOG_URL) return env.EXPO_PUBLIC_CATALOG_URL.trim();
  const file = path.join(root, '.env.local');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?EXPO_PUBLIC_CATALOG_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

// The same shape checks as data/__tests__/catalog-contract.test.ts, so a bad
// live response can never replace a good bundle.
export function validateCatalog(catalog) {
  const errors = [];
  if (!Array.isArray(catalog) || catalog.length === 0) return ['the catalog is not a non-empty array'];
  const ids = new Set(), slugs = new Set();
  catalog.forEach((r, i) => {
    const at = `reciter ${i} (${r && r.name})`;
    if (!r || typeof r.id !== 'string' || !r.id) errors.push(`${at}: no id`);
    else if (ids.has(r.id)) errors.push(`${at}: duplicate id`);
    else ids.add(r.id);
    if (!r || typeof r.name !== 'string' || !r.name) errors.push(`${at}: no name`);
    if (!r || typeof r.slug !== 'string' || !r.slug.trim()) errors.push(`${at}: no slug`);
    else if (slugs.has(r.slug)) errors.push(`${at}: duplicate slug`);
    else slugs.add(r.slug);
    if (!r || !Array.isArray(r.rewayat) || r.rewayat.length === 0) errors.push(`${at}: no rewayat`);
    else r.rewayat.forEach((w, j) => {
      if (!w || typeof w.id !== 'string' || !w.id) errors.push(`${at} rewayah ${j}: no id`);
      const server = w && typeof w.server === 'string' ? w.server : '';
      if (!/^https:\/\//.test(server) || /wasabi/i.test(server)) errors.push(`${at} rewayah ${j}: server is not an https origin off Wasabi`);
    });
  });
  return errors;
}

// Reciters and recitations added, removed or changed between two catalogs.
export function diffCatalogs(oldCat, newCat) {
  const byId = list => new Map(list.map(r => [r.id, r]));
  const a = byId(oldCat), b = byId(newCat);
  const recitations = list => new Set(list.flatMap(r => r.rewayat.map(w => w.id)));
  const ra = recitations(oldCat), rb = recitations(newCat);
  return {
    added: newCat.filter(r => !a.has(r.id)).map(r => r.name),
    removed: oldCat.filter(r => !b.has(r.id)).map(r => r.name),
    changed: newCat.filter(r => a.has(r.id) && JSON.stringify(a.get(r.id)) !== JSON.stringify(r)).map(r => r.name),
    recitationsAdded: [...rb].filter(id => !ra.has(id)).length,
    recitationsRemoved: [...ra].filter(id => !rb.has(id)).length,
    orderChanged: JSON.stringify(newCat.filter(r => a.has(r.id)).map(r => r.id)) !== JSON.stringify(oldCat.filter(r => b.has(r.id)).map(r => r.id)),
  };
}

export const serialize = catalog => JSON.stringify(catalog, null, 2) + '\n';

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply'), check = args.has('--check');
  const url = catalogUrl();
  if (!url) {
    console.error('EXPO_PUBLIC_CATALOG_URL is not set. Source .env.local, or set the variable.');
    process.exit(2);
  }
  const res = await fetch(url, {headers: {'Cache-Control': 'no-cache'}});
  if (!res.ok) {
    console.error(`The live catalog request failed: HTTP ${res.status}.`);
    process.exit(2);
  }
  const live = await res.json();
  const errors = validateCatalog(live);
  if (errors.length) {
    console.error(`The live catalog failed ${errors.length} check(s); the bundle is unchanged:`);
    errors.slice(0, 20).forEach(e => console.error('  ' + e));
    process.exit(2);
  }
  const current = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
  const same = serialize(current) === serialize(live);
  const d = diffCatalogs(current, live);
  console.log(`Live catalog: ${live.length} reciters. Bundle: ${current.length} reciters.`);
  if (same) {
    console.log('The bundle matches the live catalog.');
    return;
  }
  console.log(`Added: ${d.added.length ? d.added.join(', ') : 'none'}`);
  console.log(`Removed: ${d.removed.length ? d.removed.join(', ') : 'none'}`);
  console.log(`Changed: ${d.changed.length ? d.changed.join(', ') : 'none'}`);
  console.log(`Recitations added: ${d.recitationsAdded}, removed: ${d.recitationsRemoved}. Order changed: ${d.orderChanged ? 'yes' : 'no'}.`);
  if (check) {
    console.error('The bundle differs from the live catalog. Run: node scripts/sync-bundled-catalog.mjs --apply');
    process.exit(1);
  }
  if (!apply) {
    console.log('Dry run. Run again with --apply to write assets/data/catalog.json.');
    return;
  }
  writeFileSync(BUNDLE_PATH, serialize(live));
  console.log(`Wrote ${path.relative(REPO_ROOT, BUNDLE_PATH)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(`sync-bundled-catalog failed: ${err.message}`);
    process.exit(2);
  });
}
