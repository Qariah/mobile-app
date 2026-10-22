// @ai-generated
// Qariah (Sprint 48, S48.6): is the catalog in memory the one the network
// gave in this process?
//
// `services/dataService.ts` fills `RECITERS` from four sources: the network
// (the first-launch fetch, the background refresh, the RFC-010 version poll),
// the AsyncStorage cache, and the bundled seed. Each fill bumps
// `getRecitersVersion()`. After each NETWORK fill, dataService calls
// `markLiveCatalogLoaded()`, which records that version. So the catalog in
// memory is the network one when the version did not change since: a later
// cache or seed fill bumps the version, and then it is not.
//
// The foreground notification check (services/notifications/backgroundTask.ts)
// compares only a network catalog with the last snapshot: a cached or bundled
// catalog can be weeks old.
import {getRecitersVersion} from '@/data/reciterData';

let liveVersion: number | null = null;
const listeners = new Set<() => void>();

/**
 * dataService calls this right after it fills `RECITERS` from the network.
 * Never throws: it runs inside the catalog load.
 */
export function markLiveCatalogLoaded(): void {
  try {
    liveVersion = getRecitersVersion();
  } catch {
    liveVersion = null;
    return;
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener must not break the catalog load.
    }
  }
}

/** `true` when the last fill of `RECITERS` in this process came from the network. */
export function isLiveCatalogInMemory(): boolean {
  try {
    return liveVersion !== null && liveVersion === getRecitersVersion();
  } catch {
    return false;
  }
}

/** Calls `listener` after each network fill. Returns the unsubscribe function. */
export function subscribeLiveCatalogLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function __resetLiveCatalogSignalForTests(): void {
  liveVersion = null;
  listeners.clear();
}
