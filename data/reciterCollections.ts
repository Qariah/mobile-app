import {RECITERS, Reciter} from './reciterData';
import {useTimestampStore} from '@/store/timestampStore';

// Featured Reciters - Spotlight reciters chosen by Bayaan
const FEATURED_RECITER_NAMES = [
  'Abdullah Qarafi',
  'Bandar Balilah',
  'Abdulrasheed Soufi',
  'Ahmad Talib bin Humaid',
  'Ahmad Alhuthaifi',
  'Abdulrahman Al-Majed',
  'Albaraa Basfar',
  'Hasan Saleh',
];

// Trending Reciters - Currently popular among users
const TRENDING_RECITER_NAMES = [
  'Ahmad Talib bin Humaid',
  'Haitham Aldukhain',
  'Yasser Al-Dosari',
  'Mohammed Al-Lohaidan',
  'Abdullah Al-Johany',
];

// Bayaan Originals - Exclusive recitations curated by Bayaan
const BAYAAN_ORIGINALS_RECITER_NAMES = [
  'Albaraa Basfar',
  'Hazem Hassan',
  'Mohammed Hamed',
  'Malik Ahmad',
  'Hani Alhussaini',
  'Ayyub Asif',
  'Abdulrahman Mosad',
];

// Best for Tajweed - Reciters known for excellent tajweed and correct pronunciation
const TAJWEED_RECITER_NAMES = [
  'Mahmoud Khalil Al-Hussary',
  'Mohammed Ayyub',
  'Mohammed Siddiq Al-Minshawi',
  'Abdulbasit Abdulsamad',
  'Mahmoud Ali Albanna',
  'Mustafa Ismail',
  'Abdulrasheen Soufi',
];

// Best for Memorization - Reciters with clear, measured pace ideal for memorization
const MEMORIZATION_RECITER_NAMES = [
  'Mishary Alafasi',
  'Mahmoud Khalil Al-Hussary',
  'Mohammed Siddiq Al-Minshawi Muallim',
  'Khalifa Al-Tunaiji',
  'Mohammed Jibreel',
  'Salah Al-Budair',
  'Abdullah Al-Mattrod',
  'Idrees Abkr',
  'Yassin Al-Jazaery',
  'Abu Bakr Al-Shatri',
];

// For Beginners - Reciters who are approachable and easy to listen to for first-time listeners
const BEGINNER_FRIENDLY_RECITER_NAMES = [
  'Mishary Alafasi',
  'Maher Al Meaqli',
  'Shaik Abu Bakr Ak Shatri',
  'Abdulrahman Alsudaes',
  'Abdullah Basfer',
  'Saad Al-Ghamdi',
  'Saud Al-Shuraim',
  'Nasser Al-Qatami',
  'Yasser Al-Dosari',
  'Noreen Mohammad Siddiq',
  'Ahmad Al-Ajmy',
];

// Diverse Rewayat - Reciters who excel in multiple narration styles/qira'at
const DIVERSE_REWAYAT_RECITER_NAMES = [
  'Mahmoud Khalil Al-Hussary',
  'Abdulbasit Abdulsamad',
  'Mohammed Siddiq Al-Minshawi',
  'Mohammed Jibreel',
  'Yasser Al-Dosari',
  'Ali Al-Huzaifi',
  'Abdullah Basfar',
  'Ahmed Al-Ajmy',
  'Khalid Al-Qahtani',
];

/**
 * Normalizes a reciter name for comparison (removes spaces, special characters, etc.)
 */
function normalizeReciterName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove special characters and spaces
    .trim();
}

/**
 * Finds a reciter by their name using normalized comparison
 */
function findReciterByName(name: string): Reciter | undefined {
  const normalizedName = normalizeReciterName(name);
  return RECITERS.find(
    reciter => normalizeReciterName(reciter.name) === normalizedName,
  );
}

/**
 * Gets featured reciters chosen by Bayaan to spotlight
 */
export function getFeaturedReciters(count?: number): Reciter[] {
  const reciters = FEATURED_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets trending reciters that are currently popular among users
 */
export function getTrendingReciters(count?: number): Reciter[] {
  const reciters = TRENDING_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets Bayaan's exclusive curated recitations
 */
export function getBayaanOriginalsReciters(count?: number): Reciter[] {
  const reciters = BAYAAN_ORIGINALS_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets a list of reciters known for excellent tajweed and correct pronunciation
 */
export function getTajweedReciters(count?: number): Reciter[] {
  const reciters = TAJWEED_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets a list of reciters ideal for memorization with clear, measured pace
 */
export function getMemorizationReciters(count?: number): Reciter[] {
  const reciters = MEMORIZATION_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets a list of reciters who are approachable for beginners
 */
export function getBeginnerFriendlyReciters(count?: number): Reciter[] {
  const reciters = BEGINNER_FRIENDLY_RECITER_NAMES.map(
    findReciterByName,
  ).filter((reciter): reciter is Reciter => reciter !== undefined);
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets a list of reciters who excel in multiple narration styles/qira'at
 */
export function getDiverseRewayatReciters(count?: number): Reciter[] {
  const reciters = DIVERSE_REWAYAT_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets reciters that support Follow Along (ayah-level timestamps)
 */
export function getFollowAlongReciters(count?: number): Reciter[] {
  const {supportedReciterIds} = useTimestampStore.getState();
  const reciters = RECITERS.filter(r => supportedReciterIds.has(r.id));
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets reciters for a specific collection by name
 */
export function getReciterCollection(
  collectionName:
    | 'featured'
    | 'trending'
    | 'bayaan-originals'
    | 'tajweed'
    | 'memorization'
    | 'beginner-friendly'
    | 'diverse-rewayat',
  count?: number,
): Reciter[] {
  switch (collectionName) {
    case 'featured':
      return getFeaturedReciters(count);
    case 'trending':
      return getTrendingReciters(count);
    case 'bayaan-originals':
      return getBayaanOriginalsReciters(count);
    case 'tajweed':
      return getTajweedReciters(count);
    case 'memorization':
      return getMemorizationReciters(count);
    case 'beginner-friendly':
      return getBeginnerFriendlyReciters(count);
    case 'diverse-rewayat':
      return getDiverseRewayatReciters(count);
    default:
      return [];
  }
}

// @ai Qariah has a small hand-picked catalog — every reciter in it is curated.
// Returning all loaded reciters is the correct behaviour here, not the
// Bayaan-Originals name filter which looks for Bayaan's reciter names.
export function getCuratedReciters(count?: number): Reciter[] {
  return count ? RECITERS.slice(0, count) : [...RECITERS];
}

// ───────── Sprint 13 — Listen tab redesign (Qariah-only) ─────────

/**
 * Sprint 13 — Honored Reciters collection. Filled via the reciter metadata
 * CSV at `planning/reciter-metadata.csv` (column: `honored=true`)
 * processed by `scripts/apply-reciter-metadata.ts`. Starts empty.
 */
const HONORED_RECITER_NAMES: string[] = [
  "Bara'a Mahfouz",
  'Ruwaida Shabaan Khamis',
  'Sondos Abu Jaish',
  'Iman Saeed',
  'Rawan Dwaik',
];

/**
 * Sprint 13 — Paradise Reciters collection. Same pattern as Honored.
 */
const PARADISE_RECITER_NAMES: string[] = [
  'Munira Abduh رحمها الله (~1920s)',
  'Sakina Hassan رحمها الله (~1920s)',
  'Layla Hasan رحمها الله (~1980s)',
  'Shaykha Mabrooka رحمها الله  (~1910s)',
  'Zahiyya Sharkas رحمها الله (~2010s)',
  'Wadouda Badr رحمها الله (~1920s)',
  'Anwar Mansour رحمها الله (~2010s)',
  'Wadouda AlManialawia رحمها الله (~1920s)',
];

/**
 * Gets reciters tagged as "Honored" via the Sprint 13 curation CSV.
 * Auto-empty until curation lands; the home-row gate auto-hides on empty.
 */
export function getHonoredReciters(count?: number): Reciter[] {
  const reciters = HONORED_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Gets reciters tagged as "Paradise" via the Sprint 13 curation CSV.
 */
export function getParadiseReciters(count?: number): Reciter[] {
  const reciters = PARADISE_RECITER_NAMES.map(findReciterByName).filter(
    (reciter): reciter is Reciter => reciter !== undefined,
  );
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Sprint 13 — "Newly Added" Listen-tab row.
 * Filters `RECITERS` by `Reciter.date` within the last `windowDays` days
 * (default 30). Today's catalog `date` values range 2021-09 → 2024-11,
 * so the row is empty today; it auto-populates as `scripts/generate-catalog.mjs`
 * adds new reciters with current dates. Sorts newest-first.
 */
export function getNewlyAddedReciters(
  windowDays = 30,
  count?: number,
): Reciter[] {
  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const reciters = RECITERS.filter(r => {
    if (!r.date) return false;
    const t = Date.parse(r.date);
    return Number.isFinite(t) && t >= cutoff && t <= now;
  }).sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
  return count ? reciters.slice(0, count) : reciters;
}

/**
 * Sprint 13 — "Full Recording" Listen-tab row.
 * Reciters with at least one rewayat that covers all 114 surahs
 * (counted as `surah_list.filter(s => s != null).length === 114`).
 * In today's catalog: Hajjah Maria Ulfah and Zaynab Talha.
 */
export function getFullRecordingReciters(count?: number): Reciter[] {
  const reciters = RECITERS.filter(r =>
    (r.rewayat || []).some(rw => {
      const surahs = (rw.surah_list || []).filter(s => s != null);
      return surahs.length === 114;
    }),
  );
  return count ? reciters.slice(0, count) : reciters;
}

// ───────── Sprint 14 — translation tag (per-reciter) ─────────

/**
 * Sprint 14 — slug → translation-tag map. Filled from the
 * `translation` column of the reciter-metadata CSV by
 * `scripts/apply-reciter-metadata.ts`. Currently empty across all 63
 * reciters; the column is a placeholder for a future curation pass.
 *
 * When populated, drives `getRecitersByTranslation(tag)` and a future
 * Listen-tab row gated by `qariahTranslationsRow`.
 */
const TRANSLATION_RECITER_SLUGS: Record<string, string> = {};

/**
 * Sprint 14 — returns reciters whose `translation` tag matches `tag`
 * (case-insensitive). Falls back to the slug map for catalog snapshots
 * that haven't picked up the new field yet.
 */
export function getRecitersByTranslation(
  tag: string,
  count?: number,
): Reciter[] {
  const lower = tag.toLowerCase();
  const fromCatalog = RECITERS.filter(
    r => (r.translation ?? '').toLowerCase() === lower,
  );
  const fromMap = Object.entries(TRANSLATION_RECITER_SLUGS)
    .filter(([, t]) => t.toLowerCase() === lower)
    .map(([slug]) =>
      RECITERS.find(
        r => r.slug === slug || normalizeReciterName(r.name) === slug,
      ),
    )
    .filter((r): r is Reciter => r !== undefined);
  // Dedupe (catalog wins).
  const seen = new Set(fromCatalog.map(r => r.id));
  const merged = [...fromCatalog, ...fromMap.filter(r => !seen.has(r.id))];
  return count ? merged.slice(0, count) : merged;
}
