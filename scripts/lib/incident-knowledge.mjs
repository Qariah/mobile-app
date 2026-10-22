// @ai
//
// scripts/lib/incident-knowledge.mjs
// ----------------------------------
// Shared incident taxonomy + issue-corpus plumbing for the cross-source passes
// (scripts/incident-correlate.mjs + scripts/triage-lifecycle.mjs).
//
// The single source of truth that maps any auto-filed issue to a canonical
// `incident:<key>` from a small, stable set. The regex families below are
// LIFTED from the lane KNOWLEDGE maps (sentry-triage / play-vitals-triage /
// posthog-triage) so correlation reuses the team's existing root-cause prose
// rather than inventing a parallel taxonomy. When a lane KNOWLEDGE regex
// changes, mirror it here.
//
// Also holds:
//   - the per-lane dedup-marker formats (so the lifecycle pass can recover the
//     upstream source id from any filed issue body), and
//   - a small `gh` wrapper + corpus loader shared by both passes.

import {execFileSync} from 'node:child_process';

export const GH_REPO = process.env.GH_REPO || 'omar-zarka/qariah-v2';

// ---------------------------------------------------------------------------
// Lane dedup-marker formats. Each lane embeds an HTML comment marker in the
// issue body; these let us recover "which source + which upstream id" for any
// auto-filed issue, which the lifecycle pass needs to re-query the source.
//   sentry        <!-- sentry-triage-id:QARIAHV2-G -->
//   play-vitals   <!-- play-vitals-id:<sha-ish-hex> -->          (errorIssueId)
//   posthog       <!-- posthog-triage-id:fault:boot_not_completed:3.1.8 -->
//   appstore      <!-- appstore-review-id:<id> -->
//   play-review   <!-- play-review-id:<id> -->
//   testflight    <!-- testflight-feedback-id:<id> -->
// ---------------------------------------------------------------------------
export const MARKERS = [
  {source: 'sentry', prefix: 'sentry-triage-id:'},
  {source: 'play-vitals', prefix: 'play-vitals-id:'},
  {source: 'posthog', prefix: 'posthog-triage-id:'},
  {source: 'appstore-review', prefix: 'appstore-review-id:'},
  {source: 'play-review', prefix: 'play-review-id:'},
  {source: 'testflight', prefix: 'testflight-feedback-id:'},
];

// Auto-filed-issue marker — any issue carrying one of the above markers was
// filed by a triage bot (vs. a hand-authored issue, which we never touch).
export function parseMarker(body) {
  const blob = String(body || '');
  for (const {source, prefix} of MARKERS) {
    const re = new RegExp(
      prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\s>]+)',
    );
    const m = blob.match(re);
    if (m) return {source, prefix, id: m[1]};
  }
  return null;
}

// ---------------------------------------------------------------------------
// Canonical incident taxonomy. Ordered = PRIORITY; the FIRST matching incident
// wins, so SPECIFIC signatures (OOM, native fatal, js-stall) are listed BEFORE
// the generic cold-start/ANR catch-all (a media3-OOM crash whose Play body
// boilerplate happens to mention "ANR" must classify as memory-oom, not
// cold-start-hang).
//
// Matching uses TWO fields per incident:
//   - titleRe : matched against the issue TITLE only. The Play-vitals, review,
//               and TestFlight lanes put the real signature in the title
//               (`[Play Crash] …shouldContinueLoading @ java.lang.OutOfMemoryError`),
//               and the issue BODY carries lane boilerplate (every Play issue
//               body literally says "…idle-main-thread ANR" in its checklist),
//               so a full-body match on a loose token like `\bANR\b` mis-fires.
//               Title is the authoritative signature for those lanes.
//   - bodyRe  : matched against title+body. ONLY for tokens that are unique
//               signal (Sentry sentinel message strings, PostHog fault events) —
//               never a token that appears in generic lane boilerplate.
// The `re` families are lifted from the lane KNOWLEDGE maps (memory-oom from
// play-vitals, the sentinels from sentry-triage + posthog-triage).
// ---------------------------------------------------------------------------
export const INCIDENTS = [
  {
    key: 'memory-oom',
    title: 'Memory / OutOfMemory (media3 ExoPlayer)',
    // play-vitals OOM family — every java.lang.OutOfMemoryError is ONE root
    // cause (media3/ExoPlayer allocator), even across the many leaf frames. The
    // OOM signature is in the Play issue TITLE (`… @ java.lang.OutOfMemoryError`).
    titleRe:
      /OutOfMemoryError|\bOOM\b|shouldContinueLoading|MediaCodec\.getBuffer|ExoPlayerImplInternal|CircularIntArray|FastXmlSerializer|HashMap\$Values|MiuiStub/i,
    note:
      'Memory / OutOfMemory — the media3/ExoPlayer allocator family. **All ' +
      '`java.lang.OutOfMemoryError` reports are ONE root cause** ' +
      '(`ExoPlayerImplInternal.shouldContinueLoading` / `MediaCodec.getBuffer` / the leaf ' +
      'frames are just where the last allocation failed). The largest v2 crash family and the ' +
      "dominant driver of vc1255's ~7% user-perceived crash rate. It is **NOT** a low-RAM " +
      'story — it inversely correlates with RAM (worst on 6-8 GB Samsung / Android 16). ' +
      '`largeHeap` is already on and does not help. Root-cause the media3 `LoadControl` / ' +
      'allocator buffer caps + image/Skia retention; off the JS bridge so Sentry never sees it.',
  },
  {
    key: 'js-thread-freeze',
    title: 'JS-thread freeze (diagnostic heartbeat)',
    // sentry-triage diagnostic-js-stall rule. Unique token — body-safe.
    bodyRe: /diagnostic-js-stall/i,
    note:
      'JS-thread freeze — the diagnostics heartbeat caught the JS thread frozen past the ' +
      'overrun threshold (a felt hang/jank). Diagnostic-build-only (`EXPO_PUBLIC_DIAGNOSTIC_MODE` ' +
      '/ the `diagnostics_mode` cohort), so volume is low by design but every event is a real ' +
      'stall. Live through build 1314, zero on 1318 in window. Often co-occurs with the ' +
      'cold-start cluster; the expo-audio `runBlocking` deadlock (patch in build 1318) is the ' +
      'prime suspect. iOS exposure is latent (Android 55 ev vs iOS 2 ev).',
  },
  {
    key: 'bg-audio-kill',
    title: 'Background audio killed (OEM battery restriction)',
    // sentry-triage S33.2 background-audio kill telemetry. Unique token.
    bodyRe: /playback-(killed|stopped)-in-background/i,
    note:
      'Background audio stopped while the app was backgrounded (S33.2, the tester "recitation ' +
      'stops mid-ayah" report). `playback-killed-in-background` = the reliably-caught ' +
      'process-death variant that trips the one-time battery-unrestrict prompt; ' +
      '`playback-stopped-in-background` = the best-effort silent player-death variant. The kill ' +
      'is non-deterministic per run even on one device. Device-verified on the A35; telemetry ' +
      'working as designed — compare the per-build rate before/after the battery prompt shipped ' +
      '(build 1301+).',
  },
  {
    key: 'deeplink-dropped',
    title: 'Dropped deep link (navigation)',
    bodyRe: /deeplink-dropped/i,
    titleRe: /deep ?link dropped/i,
    note:
      'A deep link (share-intent / OAuth callback / notification tap) was received but did not ' +
      'navigate (instrumented in #107) — the user landed nowhere or on the wrong screen. Read ' +
      'the drop reason (router not ready / unmatched route / consumed twice); a spike ' +
      'concentrated on one link shape or one build is the actionable signal.',
  },
  {
    key: 'ios-native-boot-fatal',
    title: 'iOS native boot fatal (MMKV App Group / JSError)',
    // iOS build-1293 boot triple-fatal (P/Q/R). The signatures appear in the
    // Sentry issue TITLE (`[Sentry QARIAHV2-9] EXC_BAD_ACCESS: fetchNativeFrames…`).
    titleRe:
      /getAppGroupDirectory|MMKVPlatformContext|App Group|markBootStarted|JSError|fetchNativeFrames|EXC_BAD_ACCESS|swift_abortRetainUnowned|RNSTabBar/i,
    note:
      'iOS native boot/init fatal — the iPhone-16/18 newest-hardware boot stumble (MMKV ' +
      '`getAppGroupDirectory` threw / C++ `JSError null` / `markBootStarted of undefined`, ' +
      'often the same session). QARIAHV2-P (MMKV App-Group container unavailable when MMKV ' +
      'resolves it at init, share-extension `group.com.qariah.*`) was closed as #69 and silently ' +
      'recurred — needs reopen-on-recurrence. The simulator-only `swift_abortRetainUnowned` / ' +
      'RNSTabBar SIGABRT (hard-rule #13) is a dev artifact, NOT a prod bug — check the env tag.',
  },
  {
    key: 'oem-activity-kill',
    title: 'Android Activity / foreground-service torn down',
    // sentry-triage + play-vitals android-activity-lifecycle rule. Ranked AFTER
    // bg-audio-kill (the specific telemetry). Title-anchored — these strings are
    // the exception/cause, which the title carries.
    titleRe:
      /ExpoKeepAwake|keep-?awake|current activity (is )?no longer available|foreground ?service/i,
    bodyRe: /current activity (is )?no longer available/i,
    note:
      'Android Activity / foreground service torn down under a native module call ("current ' +
      'activity is no longer available") — typically the OS killing the app, most impactful ' +
      'during background audio (Sprint-24 FB-1: Samsung One UI / OnePlus / Xiaomi aggressively ' +
      'kill the audio foreground service). Check the POST_NOTIFICATIONS runtime grant + the ' +
      '`withAndroidNotificationPermission` plugin in the affected build + the device ' +
      'battery-optimization setting.',
  },
  {
    key: 'cold-start-hang',
    title: 'Cold-start / splash / boot hang',
    // sentry-triage cold-start rule + posthog fault events + play-vitals Bug-B
    // (idle nativePollOnce). The Sentry/PostHog sentinel strings are unique →
    // body-safe; the generic ANR / nativePollOnce signature lives in the Play
    // issue TITLE (`[Play ANR] …nativePollOnce @ Input dispatching timed out`),
    // so it is title-only (the body's "…idle-main-thread ANR" boilerplate would
    // otherwise pull every Play crash into this bucket).
    bodyRe:
      /boot-not-completed|boot_not_completed|splash-hide-timeout|splash[_-]?stalled|slow-cold-start|app-init-service-timeout|reciter-profile-surahs-stalled|reciter_profile_surahs_stalled/i,
    titleRe:
      /nativePollOnce|No focused window|Input dispatching timed out|ApplicationNotResponding|Application Not Responding|\[Play ANR\]|boot-not-completed|splash-hide-timeout|slow-cold-start|app-init-service-timeout|splash[_-]?stalled|never completed boot|splash never hidden|stuck on skeleton|WaitForGcToCompleteLocked|ConditionVariable::WaitHoldingLocks|DumpNativeStack/i,
    // Review/feedback free-text for the "stuck on logo / won't open / blank"
    // cluster (the #1 tester theme). Kept narrow to avoid catching praise.
    reviewTitleRe:
      /not opening|won'?t open|not launch|does(?:n'?t| not) (?:open|launch|start)|stuck on|blank app|not loading|won'?t load|can'?t use it|couldn'?t get it to work|black screen|loading forever|frozen on/i,
    note:
      'Cold-start / splash / boot hang — the #1 user-impacting reliability cluster ' +
      '("stuck on the green logo", Android #4/#5/#8/#9). Spans the Sentry boot sentinel + ' +
      'splash watchdog (`slow-cold-start` / `splash-hide-timeout` / `boot-not-completed` / ' +
      '`app-init-service-timeout`), the PostHog discrete fault events, the Play-vitals idle ' +
      "`nativePollOnce` ANR (the native dump can't name the JS culprit), and the review/" +
      'feedback "won\'t open" voice. Field truth: ~95% stall at `boot_step=catalog-ready`; ' +
      'the S34.1 `slow_init_service` probe names **Tafseer DB** through build 1318 → the #144 ' +
      'lazy-open lever is evidence-backed. Concentrated on OnePlus 8 Pro / Android 11.',
  },
  {
    key: 'ios-first-ayah',
    title: 'iOS first-ayah / Bismillah content defect',
    // TestFlight content-defect pair (#115 + #110) + the translations-scroll
    // first-ayah class (#55). Title/free-text only (no crash signature).
    titleRe:
      /first ayah|first verse|bismillah|supposed to be|missing vowels|scroll to the first ayah|doesn'?t scroll/i,
    note:
      'iOS content / first-ayah defect — the catalog/data-rendering pair flagged by 2 ' +
      'independent testers (#115 "audio didn\'t play / first ayah missing vowels" + #110 ' +
      '"supposed to be Bismillah"), plus the translations-view "doesn\'t scroll to the first ' +
      'ayah" class (#55). A public-launch ★1 risk — correctness, not a crash. Re-rank from ' +
      'medium → high.',
  },
  {
    key: 'qf-sync-noise',
    title: 'QF user-state sync noise (best-effort, non-fatal)',
    // sentry IGNORE_PATTERNS family — normally unfiled; any that leaked through
    // fold here (close candidates, not real bugs). Unique tokens → body-safe.
    bodyRe:
      /postsRestore|posts[_-]?restore|notes[_-]?restore|\/posts\/feed|\/posts\/my-posts|quran-?reflect\/v1\/posts|QfApiError/i,
    note:
      'QF user-state sync noise — best-effort, local-first, non-fatal (posts/notes restore, ' +
      'community-reflections feed 403/502). Correctly classed as noise; the app-side ' +
      '`beforeSend` drop (app/_layout.tsx) should suppress it. Any issue here is a candidate ' +
      'for closing as noise, not a real bug.',
  },
  {
    key: 'native-sigabrt',
    title: 'Native SIGABRT (libc abort — cause in the dump)',
    // LAST resort — bare `[Play Crash] [libc.so] abort @ SIGABRT` with no cause
    // in the title. Ranked last so a SIGABRT that another incident's signature
    // matched (e.g. an OOM that aborts) is grouped THERE, and only the genuinely
    // unattributed libc aborts land here. The real cause is in the thread dump.
    titleRe: /\babort @ SIGABRT\b|\bSIGABRT\b.*\babort\b|libc\.so\] abort/i,
    note:
      'Native SIGABRT (libc `abort()`) with no cause named in the title — a heterogeneous ' +
      'bucket whose real cause lives in the per-report thread dump (some are OOM-adjacent: read ' +
      'the `app_memory` PSS context the `memoryWatch` instrumentation attaches; some are logic ' +
      'aborts). Group is provisional — split out into a specific incident once a dump names a ' +
      'consistent frame. Confirm `release`/`dist` so the versionCode maps to a build.',
  },
];

// Map one issue (title + body + label names) to a canonical incident key, or
// null if nothing matches. First-match-wins over the ordered INCIDENTS list, so
// specific signatures (OOM, native fatal) win over the generic cold-start ANR.
//
// Per incident, in order: bodyRe (unique-signal tokens, body-safe) → titleRe
// (the authoritative signature for Play/Sentry titles) → reviewTitleRe (only
// for user-voice lanes, so a review's "won't open" free-text maps to cold-start
// without a telemetry crash dragging a stray word into a review bucket).
export function classifyIncident({title = '', body = '', labels = []} = {}) {
  const labelNames = new Set(
    (labels || []).map(l => (typeof l === 'string' ? l : l.name)),
  );
  const isUserVoice =
    labelNames.has('user-review') ||
    labelNames.has('feedback') ||
    labelNames.has('testflight') ||
    labelNames.has('app-store');
  const bodyHay = `${title}\n${body}`;
  for (const inc of INCIDENTS) {
    if (inc.bodyRe && inc.bodyRe.test(bodyHay)) return inc.key;
    if (inc.titleRe && inc.titleRe.test(title)) return inc.key;
    if (
      isUserVoice &&
      inc.reviewTitleRe &&
      inc.reviewTitleRe.test(`${title} ${body}`)
    ) {
      return inc.key;
    }
  }
  return null;
}

export function incidentByKey(key) {
  return INCIDENTS.find(i => i.key === key) || null;
}

// ---------------------------------------------------------------------------
// Shared gh wrapper.
// ---------------------------------------------------------------------------
export function gh(args, {input} = {}) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    throw new Error(`gh ${args.join(' ')} failed: ${msg.slice(0, 400)}`);
  }
}

// Load the open (or all) auto-filed issue corpus, parse marker + incident onto
// each. `state` = 'open' | 'closed' | 'all'.
export function loadIssueCorpus({state = 'open', limit = 300} = {}) {
  const raw = JSON.parse(
    gh([
      'issue',
      'list',
      '--repo',
      GH_REPO,
      '--state',
      state,
      '--limit',
      String(limit),
      '--json',
      'number,title,labels,body,state,stateReason,createdAt,closedAt',
    ]),
  );
  return raw.map(i => {
    const labels = (i.labels || []).map(l => l.name);
    const marker = parseMarker(i.body);
    const incident = classifyIncident({title: i.title, body: i.body, labels});
    return {...i, labels, marker, incident, autoFiled: !!marker};
  });
}
