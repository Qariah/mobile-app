// @ai Qariah (Lite mode plan, section 7h) — the line fits of
// components/mushaf/skia/justifiedSpace.ts, kept across launches.
//
// A justified line is built, measured and built again with its fit (the
// words' font size and the px added to every space). justifiedSpace.ts keeps
// a fit for the session only, so the first page after a launch built every
// line twice: about half of its 0.7 s of paragraph work on a Samsung A10s.
// This store keeps each fit under a hash of its key (the line text, its
// justification, font, size and width). Every app build starts with an empty
// store, so a new font or shaping code never reuses an old fit.
import Constants from 'expo-constants';
import {createMMKV, type MMKV} from 'react-native-mmkv';

export interface StoredLineFit {
  wordSize: number;
  spaceExtra: number;
}

const VERSION_KEY = 'version';

// The build-time version (scripts/generate-version.js writes
// expoConfig.extra.version), or '' when the manifest lacks it.
function buildVersion(): string {
  const raw: unknown = Constants.expoConfig?.extra?.version;
  if (raw == null || typeof raw !== 'object') return '';
  const {semanticVersion, buildNumber} = raw as Record<string, unknown>;
  if (typeof semanticVersion !== 'string') return '';
  if (typeof buildNumber !== 'string' && typeof buildNumber !== 'number') {
    return '';
  }
  return `${semanticVersion}+${buildNumber}`;
}

let store: MMKV | null | undefined;

function mmkv(): MMKV | null {
  if (store !== undefined) return store;
  store = null;
  try {
    // No build version (tests, a dev build without the manifest): no store.
    const version = buildVersion();
    if (!version) return null;
    const kv = createMMKV({id: 'mushaf-line-fits'});
    if (kv.getString(VERSION_KEY) !== version) {
      kv.clearAll();
      kv.set(VERSION_KEY, version);
    }
    store = kv;
  } catch {
    store = null;
  }
  return store;
}

// cyrb53: a 53-bit string hash. With 30,000 lines, a collision is about
// 1 in 10 million.
function hashKey(key: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The fit stored for `key` by an earlier launch of this build. */
export function readStoredLineFit(key: string): StoredLineFit | undefined {
  const kv = mmkv();
  if (!kv) return undefined;
  try {
    const value = kv.getString(`f:${hashKey(key)}`);
    if (!value) return undefined;
    const [wordSize, spaceExtra] = value.split(',').map(Number);
    if (!(wordSize > 0) || !Number.isFinite(wordSize)) return undefined;
    if (!Number.isFinite(spaceExtra)) return undefined;
    return {wordSize, spaceExtra};
  } catch {
    return undefined;
  }
}

export function storeLineFit(key: string, fit: StoredLineFit): void {
  const kv = mmkv();
  if (!kv) return;
  if (!Number.isFinite(fit.wordSize) || !Number.isFinite(fit.spaceExtra)) {
    return;
  }
  try {
    kv.set(`f:${hashKey(key)}`, `${fit.wordSize},${fit.spaceExtra}`);
  } catch {
    // A cache only: the line is measured again on the next launch.
  }
}

/** Test hook: forget the store handle (the next call opens it again). */
export function resetLineFitStoreForTests(): void {
  store = undefined;
}
