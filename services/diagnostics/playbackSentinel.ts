// @ai
// Playback-killed-in-background sentinel — REPORT-ONLY observability for the
// "audio stops in the background" class (#54 user symptom, #104 motivation).
//
// THE PROBLEM IT SOLVES: when an OEM task killer (Samsung One UI, Xiaomi MIUI,
// OnePlus) kills the process mid-playback, nothing throws and no JS runs — the
// app simply dies. Sentry sees no crash, PostHog sees an *absence* of events
// (a Started with no Paused/Completed), which is only findable by funnel
// inference, never as a discrete signal. Like the boot sentinel
// (services/diagnostics/bootSentinel.ts), the only mechanism that survives a
// process death is a synchronous MMKV write the dying process already made:
// mark while playing, clear when JS observes a stop. If the key is still set
// at the NEXT launch, the previous process died while audio was playing.
//
// KNOWN AMBIGUITY (documented, accepted): a user swiping the app away from
// recents mid-playback, or a crash mid-playback, also leaves the key set. The
// event therefore measures "process died while playing", not strictly "OEM
// killed us". Fleet-level slicing by manufacturer separates OEM aggressiveness
// (Samsung/Xiaomi spikes) from the user-swipe baseline, and crash deaths can
// be correlated against Sentry crash events from the same session.
//
// REPORT-ONLY: this module writes/reads an MMKV flag and surfaces a signal on
// the next launch. It does NOT alter playback, boot flow, or what the user sees.

import {createMMKV, type MMKV} from 'react-native-mmkv';

// Lazy + GUARDED handle on the existing 'analytics' MMKV store — identical
// pattern (and rationale) to bootSentinel.ts: MMKV native init can throw on
// some environments (iOS Simulator app-group lookup), and this module must
// NEVER throw into the audio or boot path, so every caller no-ops on null.
let _mmkv: MMKV | null | undefined; // undefined = not yet tried; null = failed
function store(): MMKV | null {
  if (_mmkv !== undefined) return _mmkv;
  try {
    _mmkv = createMMKV({id: 'analytics'});
  } catch {
    _mmkv = null; // never retried; never throws into the caller
  }
  return _mmkv;
}

const ACTIVE_KEY = 'playback:active'; // JSON ActivePlayback

export interface ActivePlayback {
  startedAt: number;
  surahId: string | null;
  reciterId: string | null;
  reciterName: string | null;
  positionSec: number;
}

// Stash-then-clear runs at most once per launch, on the FIRST touch of this
// module (whichever of mark/consume happens first). This makes the record from
// the previous process safe even if the user hits play before the reporter
// (AnalyticsConnector's posthog-gated effect) has consumed it.
let stashed = false;
let killedFromLastLaunch: ActivePlayback | null = null;
function stashPrevious(): void {
  if (stashed) return;
  stashed = true;
  const mmkv = store();
  if (!mmkv) return;
  try {
    const prev = mmkv.getString(ACTIVE_KEY);
    if (prev) {
      try {
        killedFromLastLaunch = JSON.parse(prev) as ActivePlayback;
      } catch {
        // Corrupt record — drop it; never block playback on the sentinel.
      }
      mmkv.remove(ACTIVE_KEY);
    }
  } catch {
    // Best-effort; a failed stash just means one missed signal.
  }
}

// In-memory copy of THIS launch's active record so position refreshes don't
// need an MMKV read+parse on every progress tick.
let current: ActivePlayback | null = null;

/** Call when playback transitions INTO playing (JS-observed). */
export function markPlaybackActive(
  info: Omit<ActivePlayback, 'startedAt' | 'positionSec'> & {
    positionSec?: number;
  },
): void {
  stashPrevious();
  const mmkv = store();
  if (!mmkv) return;
  current = {
    startedAt: Date.now(),
    surahId: info.surahId,
    reciterId: info.reciterId,
    reciterName: info.reciterName,
    positionSec: info.positionSec ?? 0,
  };
  try {
    mmkv.set(ACTIVE_KEY, JSON.stringify(current));
  } catch {
    // MMKV must never throw into the audio path.
  }
}

/**
 * Refresh the recorded position while playing (call from an already-throttled
 * progress path — this does one tiny synchronous MMKV write per call).
 */
export function updatePlaybackPosition(positionSec: number): void {
  if (!current) return;
  const mmkv = store();
  if (!mmkv) return;
  current.positionSec = positionSec;
  try {
    mmkv.set(ACTIVE_KEY, JSON.stringify(current));
  } catch {
    // Best-effort.
  }
}

/**
 * Call when JS observes playback stopping (paused / stopped / queue finished).
 * A graceful stop means a later process death is NOT a mid-playback kill.
 */
export function clearPlaybackActive(): void {
  stashPrevious();
  current = null;
  const mmkv = store();
  if (!mmkv) return;
  try {
    mmkv.remove(ACTIVE_KEY);
  } catch {
    // Best-effort; at worst one false-positive signal next launch.
  }
}

/** Read THIS launch's in-memory active record WITHOUT clearing it. Used by the
 *  involuntary-background-stop detector (S33.2) to attach surah/reciter/position
 *  context to its report before it clears the sentinel. */
export function peekActivePlayback(): ActivePlayback | null {
  return current;
}

/**
 * Read + clear the previous launch's mid-playback death record (returns it at
 * most once). Reported by AnalyticsConnector once PostHog is connected.
 */
export function consumeKilledPlayback(): ActivePlayback | null {
  stashPrevious();
  const k = killedFromLastLaunch;
  killedFromLastLaunch = null;
  return k;
}
