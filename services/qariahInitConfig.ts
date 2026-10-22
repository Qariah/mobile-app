// @ai Qariah (TECH_DEBT #243) — Qariah's changes to the startup service list.
//
// `services/AppInitializer.ts` keeps upstream's `registerService()` blocks
// byte-identical. At the end of that file, ONE call applies this config to the
// registered list, before anything can call `initialize()` (both run at module
// load). The result is the same list, in the same order, that the old inline
// `if (isFeatureEnabled(...))` guards produced: a removal keeps the relative
// order of the other services, and a replaced initializer keeps its slot.
// `services/__tests__/qariahInitConfig.test.ts` pins the list for the shipping
// flags and for every lever off.
//
// No import from AppInitializer here (that would be a cycle). The caller
// passes the initializer in.

import * as Font from 'expo-font';
import {isFeatureEnabled} from '@/config/featureFlags';

/** The two AppInitializer methods that this config uses. */
export interface QariahInitTarget {
  unregisterService(name: string): void;
  replaceServiceInitializer(
    name: string,
    initialize: () => Promise<void>,
  ): void;
}

/**
 * The services that Qariah does not run at boot, for the current flags.
 * @ai
 */
export function qariahSkippedServices(): string[] {
  const skipped: string[] = [];

  // Adhkar Service (Priority 4) and Adhkar Store Data (Priority 6) — gated on
  // `isFeatureEnabled('adhkar')`. Qariah ships with `adhkar: false`
  // (config/featureFlags.ts — no women-audio canon at launch) and the surface
  // is fully gated in the UI (no nav entry; RecitersView's section is
  // `isFeatureEnabled('adhkar') && …`). Seeding the Adhkar DB ran
  // unconditionally on every cold start for a feature nobody can reach; the
  // "Adhkar Store Data" step (loadCategories) was the single slowest
  // non-critical service (~2.5s on a Pixel 3). Skipping them when the flag is
  // off removes that cold-start cost with zero trade-off; both services run
  // again automatically when the flag flips on (v2.x).
  // (Cold-start investigation: planning/perf-investigation-pixel3-2026-05-31.md.)
  if (!isFeatureEnabled('adhkar')) {
    skipped.push('Adhkar Service', 'Adhkar Store Data');
  }

  // Mushaf Preload (Priority 5) — Sprint 30 (B1), gated on
  // `!isFeatureEnabled('deferMushafPreload')`. When the defer flag is on
  // (Qariah default), the service is SKIPPED so the ~2s preload no longer
  // blocks the splash; instead `qariahAfterAudioReady()` (services/qariahBoot.ts,
  // called by `bootApp()` in services/appBoot.ts) fires
  // `mushafPreloadService.initialize()` non-awaited. The landing Listen tab
  // never touches the Mushaf font stack, so this is off its critical path.
  // Flip the flag off to restore the legacy splash-blocking behavior.
  // (Cold-start: planning/perf-audit-2026-06-04.md; advances TECH_DEBT #110.)
  if (isFeatureEnabled('deferMushafPreload')) {
    skipped.push('Mushaf Preload');
  }

  // Uploads Service (Priority 6) and Verse Annotations (Priority 7) — Sprint 38
  // (S38.2), gated on `!isFeatureEnabled('deferNonCriticalBootServices')`.
  // When the defer flag is on (Qariah default), both are SKIPPED so their
  // SQLite opens no longer run in the non-critical batch.
  // - Uploads: UploadsService.initialize() is called lazily at the top of every
  //   public method, so the DB opens on first user-triggered access instead.
  //   userUploads is false in Qariah v2 so the surface is fully hidden; no
  //   boot-path caller reads from the uploads store.
  // - Verse Annotations: VerseAnnotationDatabaseService.ensureReady()
  //   self-initializes on first access (lazy-open, mirrors the TafseerDbService
  //   pattern from Sprint 35 S35.1). BookmarkChips.tsx already re-fetches all
  //   bookmarks in a `useEffect` on mount, so the warm cache at boot was
  //   redundant for that surface; other callers (sheets, hooks, collection
  //   screens) are user-triggered and await the service's async methods, so
  //   they lazy-open transparently.
  // Flip the flag off to restore legacy boot-time behavior (instant rollback).
  // Field evidence: Sentry QARIAHV2-G / QARIAHV2-S named 'Uploads Service' and
  // 'Verse Annotations' as `slow_init_service` stragglers on OnePlus 8 Pro /
  // Android 11 (builds 1345/1353). See planning/sprint-38-plan.md (S38.2).
  if (isFeatureEnabled('deferNonCriticalBootServices')) {
    skipped.push('Uploads Service', 'Verse Annotations');
  }

  // QUL Data, Translation DB, Tafseer DB, WBW Data (Priority 10) — Sprint 35
  // (S35.1): off-Listen feature DBs skip boot when `lazyOpenFeatureDbs` is on;
  // each opens its SQLite connection on first access to its (off-Listen)
  // surface via an idempotent lazy guard. Field evidence: Tafseer DB is the
  // dominant `slow_init_service` straggler (TECH_DEBT #144). Tafseer DB: when
  // lazy, the bundled Ibn Kathir import is folded into
  // `tafseerDbService.initialize()` (S35.1) so the default '169' tafseer is
  // readable on first off-Listen access; `loadDownloadedMeta` then runs on the
  // tafseer surface mount (TafseerContent) instead of at boot. Flip the flag
  // off to restore legacy boot-time opens.
  if (isFeatureEnabled('lazyOpenFeatureDbs')) {
    skipped.push('QUL Data', 'Translation DB', 'Tafseer DB', 'WBW Data');
  }

  return skipped;
}

/**
 * Apply Qariah's startup config to the registered services. Call it once, at
 * the end of AppInitializer.ts, after every upstream registration.
 * @ai
 */
export function applyQariahInitConfig(target: QariahInitTarget): void {
  for (const name of qariahSkippedServices()) target.unregisterService(name);

  // Arabic Fonts (Priority 10) — Sprint 30 (B7). The DigitalKhatt OTFs (2.5 MB
  // each) are used by the RN `DigitalKhattV1`/`V2` font family ONLY on
  // Mushaf-tab surfaces (reading views + mushaf sheets). When
  // `deferMushafPreload` is on they ride with the deferred preload in
  // `qariahAfterAudioReady()` (services/qariahBoot.ts) instead of blocking the
  // splash, so this
  // service loads upstream's font set WITHOUT them. When the flag is off,
  // upstream's initializer (which loads them here) stays as it is.
  // ScheherazadeNew is used on landing surfaces (RewayatCard renders the
  // rewaya name in ScheherazadeNew-Bold on the Listen tab), so it always
  // loads blocking. If upstream changes its 'Arabic Fonts' list, update this
  // list too: services/__tests__/qariahInitConfig.test.ts compares the two.
  if (isFeatureEnabled('deferMushafPreload')) {
    target.replaceServiceInitializer('Arabic Fonts', async () => {
      await Font.loadAsync({
        'ScheherazadeNew-Regular': require('@/assets/fonts/ScheherazadeNew-Regular.ttf'),
        'ScheherazadeNew-Medium': require('@/assets/fonts/ScheherazadeNew-Medium.ttf'),
        'ScheherazadeNew-Bold': require('@/assets/fonts/ScheherazadeNew-Bold.ttf'),
        'ScheherazadeNew-SemiBold': require('@/assets/fonts/ScheherazadeNew-SemiBold.ttf'),
        Uthmani: require('@/assets/fonts/Uthmani.otf'),
        QPC: require('@/assets/fonts/UthmanicHafs1Ver18.ttf'),
      });
    });
  }
}
