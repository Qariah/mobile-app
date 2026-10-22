#!/usr/bin/env node
// @ai
//
// scripts/__tests__/script-helper-guard.test.mjs
// ----------------------------------------------
// A guard against the copies coming back (TECH_DEBT #234 and #246): the token
// code, and the `gh issue` and `gh label` calls, live in one helper each.
//
// Run:  node --test scripts/__tests__/script-helper-guard.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

describe('script helpers are the only copies', () => {
  const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));
  const walk = dir =>
    readdirSync(dir, {withFileTypes: true}).flatMap(e => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
      return /\.(mjs|js|sh)$/.test(e.name) ? [p] : [];
    });
  const files = walk(SCRIPTS);
  const rel = f => f.slice(SCRIPTS.length);
  const offenders = re =>
    files.filter(f => re.test(readFileSync(f, 'utf8'))).map(rel);

  it('only lib/google-play-auth.mjs calls the Google token endpoint', () => {
    assert.deepEqual(offenders(/oauth2\.googleapis\.com/), [
      'lib/google-play-auth.mjs',
    ]);
  });
  it('no script signs its own service-account JWT', () => {
    assert.deepEqual(offenders(/grant-type:jwt-bearer/), [
      'lib/google-play-auth.mjs',
    ]);
  });
  it('the three telemetry lanes do not call `gh issue` or `gh label`', () => {
    for (const name of [
      'sentry-triage.mjs',
      'posthog-triage.mjs',
      'play-vitals-triage.mjs',
    ]) {
      const text = readFileSync(join(SCRIPTS, name), 'utf8');
      assert.doesNotMatch(text, /gh\(\s*\[\s*'(issue|label)'/, name);
      assert.doesNotMatch(text, /\bexecFileSync\b/, name);
    }
  });
  it('shell scripts run Node network code with --dns-result-order=ipv4first', () => {
    // Node fetch (undici) tries only the IPv6 address on a hung IPv6 route,
    // where curl works (CLAUDE.md standing rule, 2026-08-15).
    const calls = [
      ['android-upload-play.sh', /\bnode\b[^\n]*google-play-auth\.mjs/],
      ['cloud/setup-triage-env.sh', /LIB_DIR=[^\n]*\bnode\b/],
    ];
    for (const [name, re] of calls) {
      const line = readFileSync(join(SCRIPTS, name), 'utf8')
        .split('\n')
        .filter(l => !l.trimStart().startsWith('#'))
        .find(l => re.test(l));
      assert.ok(line, `${name}: no node call found`);
      assert.match(line, /node --dns-result-order=ipv4first /, name);
    }
  });
});
