// @ai-generated
// Tests for scripts/catalog-arabic-names.mjs (Sprint 47 Task 8). Run with
// node --test (CI: .github/workflows/test.yml "Script tests"); Jest does not
// pick up .mjs. The R2 write guard has its own file
// (catalog-r2-mutate.test.mjs), because the public mirror strips that script.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import transform, {
  ALLOWED_FIELDS,
  REVIEW_DIR,
  applyArabicText,
  formatReport,
  loadReviewSheets,
  parseBios,
  parseCsv,
  parseNames,
  serializeLike,
  withFieldAfter,
} from '../catalog-arabic-names.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const CATALOG = path.join(ROOT, 'assets/data/catalog.json');
// scripts/publish-to-public.sh strips planning/ from the public mirror.
const noPack = !existsSync(REVIEW_DIR) && 'the review pack is not here';

const HEADER =
  '#,Section,Key / where it appears (file:line),English,Suggested Arabic,Notes / alternatives,Confidence,Reviewer: approved? (Y/N),Reviewer: correction';
const ID_A = '11111111-1111-5111-8111-111111111111';
const ID_B = '22222222-2222-5222-8222-222222222222';
const csv = rows => `\uFEFF${[HEADER, ...rows].join('\r\n')}\r\n`;

test('parseCsv reads a BOM, CRLF rows, quoted newlines, "" and commas', () => {
  const rows = parseCsv(
    '\uFEFFa,b,c\r\n"x\ny","say ""hi""","1,2"\r\n\r\nlast,row,"no newline"',
  );
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x\ny', 'say "hi"', '1,2'],
    ['last', 'row', 'no newline'],
  ]);
});

test('parseCsv reads LF rows and an empty last cell', () => {
  assert.deepEqual(parseCsv('a,b,\nc,d,e\n'), [
    ['a', 'b', ''],
    ['c', 'd', 'e'],
  ]);
});

test('parseCsv fails on a quote that never closes', () => {
  assert.throws(() => parseCsv('a,"b\nc'), /quoted cell/);
});

test('parseNames maps the id in the Key cell; a correction wins', () => {
  const names = parseNames(
    csv([
      `1,Reciter,"id: ${ID_A}\nslug: a\nassets/data/catalog.json",Alpha,ألفا,"note, with comma",high,,`,
      `2,Reciter,"id: ${ID_B}\nslug: b",Beta,بيتا,,low,N,بيتا المصححة`,
    ]),
  );
  assert.deepEqual([...names.keys()], [ID_A, ID_B]);
  assert.equal(names.get(ID_A).arabic, 'ألفا');
  assert.equal(names.get(ID_A).english, 'Alpha');
  assert.equal(names.get(ID_B).arabic, 'بيتا المصححة');
});

test('parseNames fails on a row without an id or with an id twice', () => {
  assert.throws(
    () => parseNames(csv(['1,Reciter,"slug: a",Alpha,ألفا,,high,,'])),
    /row 1: no "id:"/,
  );
  assert.throws(
    () =>
      parseNames(
        csv([
          `1,Reciter,"id: ${ID_A}",Alpha,ألفا,,high,,`,
          `2,Reciter,"id: ${ID_A}",Alpha,ألفا,,high,,`,
        ]),
      ),
    /twice/,
  );
});

test('parseBios maps the slug in the Key cell', () => {
  const bios = parseBios(
    csv([
      '1,Reciter bio,"slug: a\nshown by X","Hafitha, Blind","حافظة، كفيفة",,high,,',
    ]),
  );
  assert.deepEqual(bios.get('a'), {
    arabic: 'حافظة، كفيفة',
    english: 'Hafitha, Blind',
    row: '1',
  });
});

test('withFieldAfter puts a new key after another and keeps an old key in place', () => {
  assert.deepEqual(
    Object.keys(withFieldAfter({id: 1, name: 'x', date: 2}, 'name', 'n2', 0)),
    ['id', 'name', 'n2', 'date'],
  );
  assert.deepEqual(
    Object.keys(withFieldAfter({id: 1, n2: 0, name: 'x'}, 'name', 'n2', 5)),
    ['id', 'n2', 'name'],
  );
  assert.deepEqual(Object.keys(withFieldAfter({id: 1}, 'name', 'n2', 5)), [
    'id',
    'n2',
  ]);
});

const sheets = () => ({
  names: new Map([
    [ID_A, {arabic: 'ألفا', english: 'Alpha', row: '1'}],
    [ID_B, {arabic: 'بيتا', english: 'Beta (old)', row: '2'}],
  ]),
  bios: new Map([
    ['a', {arabic: 'حافظة', english: 'Hafitha', row: '1'}],
    ['b', {arabic: 'قديم', english: 'Old bio', row: '2'}],
  ]),
});

test('applyArabicText writes only name_arabic and bio_ar, in place', () => {
  const input = [
    {id: ID_A, name: 'Alpha', slug: 'a', bio_en: ' Hafitha ', country: 'X'},
    {id: ID_B, name: 'Beta', slug: 'b', bio_en: 'New bio', honored: false},
    {id: 'c', name: 'Gamma', slug: 'c', bio_en: 'No row'},
  ];
  const frozen = JSON.stringify(input);
  const {reciters, report} = applyArabicText(input, sheets());

  assert.equal(JSON.stringify(input), frozen, 'the input is not changed');
  assert.deepEqual(Object.keys(reciters[0]), [
    'id',
    'name',
    'name_arabic',
    'slug',
    'bio_en',
    'bio_ar',
    'country',
  ]);
  assert.equal(reciters[0].bio_ar, 'حافظة');
  // A renamed reciter keeps her Arabic name; a changed bio gets no Arabic.
  assert.equal(reciters[1].name_arabic, 'بيتا');
  assert.equal('bio_ar' in reciters[1], false);
  assert.deepEqual(reciters[2], input[2]);
  // Without the two fields, every reciter is the input reciter.
  assert.deepEqual(
    reciters.map(r =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !ALLOWED_FIELDS.includes(k)),
      ),
    ),
    input,
  );

  assert.equal(report.names.set, 2);
  assert.deepEqual(report.names.missing, ['c (c)']);
  assert.equal(report.names.renamed.length, 1);
  assert.equal(report.bios.set, 1);
  assert.equal(report.bios.stale.length, 1);
  assert.deepEqual(report.bios.missing, ['c (c)']);
  assert.match(formatReport(report).join('\n'), /bio changed since the review/);
});

test('applyArabicText is idempotent', () => {
  const input = [{id: ID_A, name: 'Alpha', slug: 'a', bio_en: 'Hafitha'}];
  const once = applyArabicText(input, sheets()).reciters;
  const twice = applyArabicText(once, sheets());
  assert.deepEqual(twice.reciters, once);
  assert.equal(twice.report.names.set, 0);
  assert.equal(twice.report.names.unchanged, 1);
  assert.equal(twice.report.bios.unchanged, 1);
});

test('serializeLike keeps the layout of the original file', () => {
  const value = [{a: 1}];
  assert.equal(
    serializeLike('[\n  {\n    "a": 0\n  }\n]\n', value),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  assert.equal(serializeLike('[{"a":0}]', value), JSON.stringify(value));
  assert.throws(() => serializeLike('[ {"a": 0} ]', value), /layout/);
});

test('the review pack sheets load: 68 names, 63 bios', {skip: noPack}, () => {
  const {names, bios} = loadReviewSheets();
  assert.equal(names.size, 68);
  assert.equal(bios.size, 63);
});

test(
  'the transform gives the bundled catalog its Arabic and changes nothing else',
  {skip: noPack},
  () => {
    const bundled = JSON.parse(readFileSync(CATALOG, 'utf8'));
    // The catalog before Sprint 47: the same without the two fields.
    const bare = bundled.map(reciter =>
      Object.fromEntries(
        Object.entries(reciter).filter(([k]) => !ALLOWED_FIELDS.includes(k)),
      ),
    );
    const result = transform(JSON.parse(JSON.stringify(bare)));
    assert.deepEqual(result.allowedFields, ['name_arabic', 'bio_ar']);
    assert.equal(result.report.names.missing.length, 0);
    assert.equal(result.report.bios.stale.length, 0);
    assert.deepEqual(result.reciters, bundled);
    assert.match(result.summary, /name_arabic: 68 set/);
  },
);
