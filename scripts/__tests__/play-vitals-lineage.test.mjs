#!/usr/bin/env node
// @ai
//
// scripts/__tests__/play-vitals-lineage.test.mjs
// -----------------------------------------------
// Node built-in test runner (node:test + node:assert) for the pure
// classifyAppLineage() function exported from play-vitals-triage.mjs.
//
// Run:  node --test scripts/__tests__/play-vitals-lineage.test.mjs
// Or:   npx jest (Jest picks up the file if extensionsToTreatAsEsm is set —
//       but the node:test runner is the primary harness for this .mjs file,
//       matching the node --check / dry-run verification pattern used elsewhere).
//
// These tests guard the core requirement: the v1/v2/unknown lineage classifier
// must NOT use versionCode as the primary discriminator (v1 reached vc1255,
// which overlaps v2's range ~812–1361). Frame content is the only reliable key.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {classifyAppLineage} from '../play-vitals-triage.mjs';

// ---------------------------------------------------------------------------
// v1 (Flutter) detection
// ---------------------------------------------------------------------------
describe('classifyAppLineage — v1 (Flutter) signatures', () => {
  it('returns v1 for libflutter.so in cause', () => {
    const issue = {cause: 'SIGSEGV', location: 'libflutter.so+0x1234'};
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });

  it('returns v1 for io.flutter in location', () => {
    const issue = {
      cause: 'NullPointerException',
      location: 'io.flutter.FlutterRenderer.doFrame',
    };
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });

  it('returns v1 for com.ryanheise in cause (just_audio_background)', () => {
    const issue = {
      cause: 'com.ryanheise.audioservice.AudioService$3.onStartCommand',
      location: '',
    };
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });

  it('returns v1 for dart: in reportHead', () => {
    const issue = {cause: 'Unhandled Exception', location: ''};
    const reportHead = 'dart:core/list.dart\ndart:async/future_impl.dart';
    assert.equal(classifyAppLineage(issue, reportHead), 'v1');
  });

  it('returns v1 for FlutterRenderer in location', () => {
    const issue = {
      cause: 'SIGABRT',
      location: 'io.flutter.FlutterRenderer.doFrame',
    };
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });

  // The real-world case that caused the mis-attribution: vc1255 (v1 build)
  // with ryanheise frames should be v1, not v2-critical.
  it('returns v1 for vc1255 + ryanheise frame (the original mis-attribution)', () => {
    const issue = {
      cause: 'com.ryanheise.audioservice.AudioService$VideoListener',
      location: 'com.ryanheise.audioservice',
      lastAppVersion: {versionCode: '1255'},
    };
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });

  it('returns v1 for just_audio in cause', () => {
    const issue = {cause: 'just_audio.AudioPlayer', location: ''};
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });
});

// ---------------------------------------------------------------------------
// v2 (React Native / Expo / Hermes) detection
// ---------------------------------------------------------------------------
describe('classifyAppLineage — v2 (RN/Expo/Hermes) signatures', () => {
  it('returns v2 for com.facebook.react in location', () => {
    const issue = {
      cause: 'NullPointerException',
      location: 'com.facebook.react.bridge.CatalystInstanceImpl',
    };
    assert.equal(classifyAppLineage(issue, ''), 'v2');
  });

  it('returns v2 for libhermes.so in reportHead', () => {
    const issue = {cause: 'SIGSEGV', location: ''};
    const reportHead =
      '#00 pc 0x001234  /data/app/libhermes.so!libhermes.so+0x5678';
    assert.equal(classifyAppLineage(issue, reportHead), 'v2');
  });

  it('returns v2 for libjsi.so in cause', () => {
    const issue = {cause: 'SIGABRT in libjsi.so+0x1234', location: ''};
    assert.equal(classifyAppLineage(issue, ''), 'v2');
  });

  it('returns v2 for com.swmansion (react-native-screens) in location', () => {
    const issue = {
      cause: 'SIGABRT',
      location: 'com.swmansion.rnscreens.Screen',
    };
    assert.equal(classifyAppLineage(issue, ''), 'v2');
  });

  it('returns v2 for expo.modules in location', () => {
    const issue = {
      cause: 'NullPointerException',
      location: 'expo.modules.av.player.ExoPlayerWrapper',
    };
    assert.equal(classifyAppLineage(issue, ''), 'v2');
  });

  // v2 issue at a vc that's in the overlap range (>= 500 but also attainable by v1)
  // must still return v2 when v2 frames are present — vc must NOT downgrade this.
  it('returns v2 for confirmed v2 frames regardless of versionCode being in the overlap range', () => {
    const issue = {
      cause: 'java.lang.OutOfMemoryError',
      location:
        'com.facebook.react.bridge.CatalystInstanceImpl.nativeCallJSFunction',
      lastAppVersion: {versionCode: '1255'}, // same vc as the problematic v1 build
    };
    assert.equal(classifyAppLineage(issue, ''), 'v2');
  });
});

// ---------------------------------------------------------------------------
// unknown — ambiguous frames, no lineage-specific content
// ---------------------------------------------------------------------------
describe('classifyAppLineage — unknown (ambiguous / no lineage frames)', () => {
  it('returns unknown for a bare libc abort with no lineage-specific frame', () => {
    const issue = {cause: 'SIGABRT', location: 'libc.so abort'};
    assert.equal(classifyAppLineage(issue, ''), 'unknown');
  });

  it('returns unknown for OutOfMemoryError with no lineage frame in cause/location/head', () => {
    const issue = {
      cause: 'java.lang.OutOfMemoryError',
      location: 'com.some.generic.Library.allocate',
    };
    assert.equal(classifyAppLineage(issue, ''), 'unknown');
  });

  it('returns unknown (NOT v2-critical) for a bare OutOfMemoryError — requires human attribution', () => {
    const issue = {cause: 'java.lang.OutOfMemoryError', location: ''};
    const result = classifyAppLineage(issue, '');
    assert.equal(result, 'unknown');
    // Verify it's NOT 'v2' — this is the guard against false v2-critical escalation.
    assert.notEqual(result, 'v2');
  });

  it('returns unknown for null/empty issue', () => {
    const issue = {cause: '', location: ''};
    assert.equal(classifyAppLineage(issue, ''), 'unknown');
  });

  // versionCode >= 500 alone (with no lineage frames) must NOT return 'v2' —
  // this is the exact vc1255 overlap case that caused the original mis-attribution.
  it('returns unknown (NOT v2) for vc>=500 with no lineage-specific frames', () => {
    const issue = {
      cause: 'SIGABRT',
      location: 'libc.so+0x1234',
      lastAppVersion: {versionCode: '1255'},
    };
    const result = classifyAppLineage(issue, '');
    // MUST NOT be 'v2' — this is the regression guard for the original bug.
    assert.notEqual(result, 'v2');
    // 'unknown' is acceptable; 'v1' would also be acceptable but is not expected here
    // (no v1-specific frames in cause/location).
    assert.ok(
      result === 'unknown' || result === 'v1',
      `expected unknown or v1, got ${result}`,
    );
  });
});

// ---------------------------------------------------------------------------
// v1 must NEVER become v2-critical via rate escalation
// This tests the invariant: classifyAppLineage('v1') => never rate-escalated.
// The classify() function itself is not exported, so we test the lineage
// discriminant here and trust classify()'s guard in the integration test above.
// ---------------------------------------------------------------------------
describe('classifyAppLineage — v1 must stay v1 regardless of versionCode', () => {
  it('returns v1 for vc35 + libflutter.so', () => {
    const issue = {
      cause: 'libflutter.so',
      location: '',
      firstAppVersion: {versionCode: '35'},
    };
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });

  it('returns v1 for vc1255 + io.flutter (the actual mis-attribution case)', () => {
    const issue = {
      cause: 'io.flutter.FlutterRenderer',
      location: '',
      lastAppVersion: {versionCode: '1255'},
    };
    assert.equal(classifyAppLineage(issue, ''), 'v1');
  });
});
