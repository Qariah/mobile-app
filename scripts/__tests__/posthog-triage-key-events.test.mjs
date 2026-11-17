// @ai
// TECH_DEBT #391: since then an app build sends playback_skipped only for a
// skip by the user, not for the automatic advance at a track end. The per-user
// zero tripwire of posthog-triage.mjs compares a build with a baseline build,
// so it would read the first such build as "playback_skipped reaches ~0
// users". The event must stay out of KEY_EVENTS. The script runs on import, so
// this test reads its source.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'posthog-triage.mjs'), 'utf8');

test('the zero tripwire does not watch playback_skipped', () => {
  const m = src.match(/const KEY_EVENTS = \[([^\]]*)\]/);
  assert.ok(m, 'KEY_EVENTS not found');
  const events = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
  assert.ok(events.includes('app_opened'));
  assert.ok(events.includes('playback_started'));
  assert.ok(!events.includes('playback_skipped'));
});
