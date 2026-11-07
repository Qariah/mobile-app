// Tests for scripts/sync-bundled-catalog.mjs: the shape checks that keep a bad
// live response out of the bundle, the diff summary and the URL lookup order.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateCatalog, diffCatalogs, catalogUrl, serialize} from '../sync-bundled-catalog.mjs';

const reciter = (id, extra = {}) => ({id, name: `Reciter ${id}`, slug: `reciter-${id}`, rewayat: [{id: `${id}-r1`, server: `https://cdn.example/${id}`}], ...extra});

test('validateCatalog accepts a well-formed catalog', () => {
  assert.deepEqual(validateCatalog([reciter('a'), reciter('b')]), []);
});

test('validateCatalog rejects an empty or non-array response', () => {
  assert.equal(validateCatalog([]).length, 1);
  assert.equal(validateCatalog({reciters: []}).length, 1);
});

test('validateCatalog finds a missing slug, a duplicate id and a Wasabi server', () => {
  const errors = validateCatalog([
    reciter('a', {slug: ''}),
    reciter('b'),
    reciter('b', {slug: 'other'}),
    reciter('c', {rewayat: [{id: 'c-r1', server: 'https://s3.wasabisys.com/x'}]}),
  ]);
  assert.ok(errors.some(e => e.includes('no slug')));
  assert.ok(errors.some(e => e.includes('duplicate id')));
  assert.ok(errors.some(e => e.includes('server is not an https origin')));
});

test('diffCatalogs names added, removed and changed reciters', () => {
  const oldCat = [reciter('a'), reciter('b')];
  const newCat = [reciter('a', {name: 'Renamed'}), reciter('c')];
  const d = diffCatalogs(oldCat, newCat);
  assert.deepEqual(d.added, ['Reciter c']);
  assert.deepEqual(d.removed, ['Reciter b']);
  assert.deepEqual(d.changed, ['Renamed']);
  assert.equal(d.recitationsAdded, 1);
  assert.equal(d.recitationsRemoved, 1);
});

test('catalogUrl reads the environment first, then .env.local', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sync-catalog-'));
  writeFileSync(path.join(dir, '.env.local'), 'OTHER=1\nexport EXPO_PUBLIC_CATALOG_URL="https://from-file.example/c.json"\n');
  assert.equal(catalogUrl({EXPO_PUBLIC_CATALOG_URL: 'https://from-env.example/c.json'}, dir), 'https://from-env.example/c.json');
  assert.equal(catalogUrl({}, dir), 'https://from-file.example/c.json');
  assert.equal(catalogUrl({}, path.join(dir, 'missing')), null);
});

test('serialize writes two-space JSON with a final newline', () => {
  assert.equal(serialize([{id: 'a'}]), '[\n  {\n    "id": "a"\n  }\n]\n');
});
