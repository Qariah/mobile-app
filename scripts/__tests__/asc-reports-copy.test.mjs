// Tests for scripts/signals/asc-reports-copy.mjs (signals plan, Phase 0).
// The repo's eslint config declares no Node globals; these are Node builtins.
/* global Buffer */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  slug,
  objectKey,
  listAll,
  planCopy,
  runCopy,
  md5,
  REPORTS,
} from '../signals/asc-reports-copy.mjs';

test('slug and objectKey build a stable bucket key', () => {
  assert.equal(
    slug('App Store Installation and Deletion Standard'),
    'app-store-installation-and-deletion-standard',
  );
  const inst = {
    id: 'i1',
    attributes: {granularity: 'DAILY', processingDate: '2026-10-20'},
  };
  assert.equal(
    objectKey('App Crashes', inst, 's9'),
    'asc/app-crashes/daily/2026-10-20/i1/s9.csv.gz',
  );
});

test('listAll follows links.next and stops on the last page', async () => {
  const pages = {
    '/a?limit=2': {
      data: [1, 2],
      links: {next: 'https://api.appstoreconnect.apple.com/a?cursor=2'},
    },
    '/a?cursor=2': {data: [3], links: {}},
  };
  assert.deepEqual(await listAll('/a?limit=2', async p => pages[p]), [1, 2, 3]);
});

test('planCopy keeps only the wanted reports, across both requests', async () => {
  const get = async p => {
    if (p.startsWith('/v1/apps/'))
      return {
        data: [
          {id: 'reqA', attributes: {accessType: 'ONGOING'}},
          {id: 'reqB', attributes: {accessType: 'ONE_TIME_SNAPSHOT'}},
        ],
      };
    if (p.startsWith('/v1/analyticsReportRequests/'))
      return {
        data: [
          {id: `${p.split('/')[3]}-crashes`, attributes: {name: 'App Crashes'}},
          {id: 'x', attributes: {name: 'AirPlay Discovery Sessions'}},
        ],
      };
    if (p.startsWith('/v1/analyticsReports/'))
      return {
        data: [
          {
            id: `inst-${p.split('/')[3]}`,
            attributes: {granularity: 'DAILY', processingDate: '2026-10-20'},
          },
        ],
      };
    if (p.startsWith('/v1/analyticsReportInstances/'))
      return {
        data: [
          {
            id: 'seg1',
            attributes: {url: 'https://example.invalid/s', checksum: 'abc'},
          },
        ],
      };
    throw new Error('unexpected ' + p);
  };
  const r = await planCopy({appId: '1', get});
  assert.equal(r.requests, 2);
  assert.equal(r.plan.length, 2);
  assert.ok(
    r.plan.every(p => p.key.startsWith('asc/app-crashes/daily/2026-10-20/')),
  );
  assert.deepEqual(r.plan.map(p => p.meta.accessType).sort(), [
    'ONE_TIME_SNAPSHOT',
    'ONGOING',
  ]);
  assert.deepEqual(
    r.missingReports.sort(),
    REPORTS.filter(n => n !== 'App Crashes').sort(),
  );
});

test('runCopy skips segments already stored and rejects a bad checksum', async () => {
  const body = Buffer.from('a,b\n1,2\n');
  const stored = new Map([['k-old', true]]);
  const puts = [];
  const plan = [
    {key: 'k-old', url: 'u0', checksum: md5(body), meta: {}},
    {
      key: 'k-new',
      url: 'u1',
      checksum: md5(body),
      meta: {report: 'App Crashes'},
    },
    {key: 'k-bad', url: 'u2', checksum: 'not-the-md5', meta: {}},
  ];
  const r = await runCopy(plan, {
    exists: async k => stored.has(k),
    put: async k => {
      puts.push(k);
      stored.set(k, true);
    },
    download: async () => body,
  });
  assert.deepEqual(r, {
    copied: 1,
    skipped: 1,
    failed: [{key: 'k-bad', error: 'checksum mismatch'}],
  });
  assert.deepEqual(puts, ['k-new']);
  const again = await runCopy(plan.slice(0, 2), {
    exists: async k => stored.has(k),
    put: async () => assert.fail('no second copy'),
    download: async () => body,
  });
  assert.equal(again.copied, 0);
  assert.equal(again.skipped, 2);
});
