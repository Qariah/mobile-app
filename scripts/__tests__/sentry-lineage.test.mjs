// @ai
//
// scripts/__tests__/sentry-lineage.test.mjs
// -----------------------------------------
// Node test runner tests for classifySentryLineage() in
// scripts/lib/app-lineage.mjs: the frame-lineage rule that
// scripts/sentry-triage.mjs uses to skip v1 (Flutter) issues (issue #907).
//
// Run:  node --test scripts/__tests__/sentry-lineage.test.mjs
// Or:   npm run test:scripts

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAppLineage,
  classifySentryLineage,
} from '../lib/app-lineage.mjs';
import {classifyAppLineage as fromPlayVitals} from '../play-vitals-triage.mjs';

describe('classifySentryLineage — v1 (Flutter) issues', () => {
  it('returns v1 for a libflutter.so frame in the culprit', () => {
    const issue = {
      title: 'SIGSEGV: Segfault',
      culprit: 'libflutter.so in <unknown>',
      metadata: {type: 'SIGSEGV', value: 'Segfault'},
    };
    assert.equal(classifySentryLineage(issue), 'v1');
  });

  it('returns v1 for a libflutter.so frame in the metadata only', () => {
    const issue = {
      title: 'SIGABRT',
      culprit: '<unknown>',
      metadata: {type: 'SIGABRT', filename: 'libflutter.so', function: '?'},
    };
    assert.equal(classifySentryLineage(issue), 'v1');
  });

  it('returns v1 for a Dart error in the title', () => {
    const issue = {
      title: 'dart:async Future.timeout: TimeoutException after 0:00:10',
      culprit: 'package:just_audio/just_audio.dart',
      metadata: {},
    };
    assert.equal(classifySentryLineage(issue), 'v1');
  });
});

describe('classifySentryLineage — v2 and unknown issues', () => {
  it('returns v2 for a Hermes frame', () => {
    const issue = {
      title: 'SIGSEGV',
      culprit: 'libhermes.so in hermes::vm::Runtime',
      metadata: {type: 'SIGSEGV'},
    };
    assert.equal(classifySentryLineage(issue), 'v2');
  });

  it('returns unknown for a JS error with no lineage frame', () => {
    const issue = {
      title: 'TypeError: undefined is not a function',
      culprit: 'app:///index.android.bundle',
      metadata: {type: 'TypeError', value: 'undefined is not a function'},
    };
    assert.equal(classifySentryLineage(issue), 'unknown');
  });

  it('accepts an issue with no culprit and no metadata', () => {
    assert.equal(classifySentryLineage({title: 'slow-cold-start'}), 'unknown');
    assert.equal(classifySentryLineage({}), 'unknown');
  });

  it('reads only the string values of metadata', () => {
    const issue = {title: 'x', metadata: {in_app_frame_mix: 1, flag: true}};
    assert.equal(classifySentryLineage(issue), 'unknown');
  });
});

describe('the move to scripts/lib/app-lineage.mjs', () => {
  it('play-vitals-triage.mjs exports the same function', () => {
    assert.equal(fromPlayVitals, classifyAppLineage);
  });
});
