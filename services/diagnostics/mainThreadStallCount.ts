// @ai
// services/diagnostics/mainThreadStallCount.ts
// --------------------------------------------
// Carries one small record about the native main-thread watchdog from a
// process to the next cold start: the build that ran it and how many stalls it
// saw. The record rides on the existing once-per-process PostHog event
// `cold_start_began` as three properties. No new event.
//
//   prev_process_build               the build of the process that ran it
//   prev_process_watchdog_ran        true (present only when a record exists)
//   prev_process_main_thread_stalls  the count, 0 included
//
// RATE = Android cold starts with prev_process_main_thread_stalls > 0
//        ÷ Android cold starts with prev_process_watchdog_ran,
//        grouped by prev_process_build.
// Only Android writes a record (the watchdog is a no-op on iOS). Filter on
// platform anyway, because one build number ships to both stores.
// The build must come from the record, not from the event: after an update,
// the first cold start runs the new build but reports the old build's process.
//
// Why (#217 review): the stall buffer in diagnostics.ts rides on other Sentry
// events, so it is evidence, not a rate. A stall that recovers with no later
// Sentry event leaves no trace there.
//
// Persisted in MMKV because the process that stalled may die (an ANR kill)
// before it can report. At the first access in a process, the previous
// process's record moves from CURRENT to PENDING in storage, so a stall in the
// new process never overwrites it, and it survives if the new process also
// dies before it reports. If two processes die before a report, the newer
// record wins.
//
// FAILS CLOSED: when the store cannot be opened, read or written, nothing is
// carried and nothing is sent. When analytics consent is off, the record is
// dropped together with its `cold_start_began` event, so the rate is not
// biased. Never throws.

interface RecordStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
}

export interface MainThreadStallRecord {
  build: string;
  stalls: number;
}

const CURRENT_KEY = 'diag:main-thread-stalls:current';
const PENDING_KEY = 'diag:main-thread-stalls:pending';

// undefined = not tried yet; null = cannot persist (fail closed).
let _store: RecordStore | null | undefined;
function store(): RecordStore | null {
  if (_store !== undefined) return _store;
  try {
    // Lazy: diagnostics.ts is imported by many Jest suites, and
    // react-native-mmkv cannot load in Jest. Same 'analytics' store as the
    // memory probe; the key prefix keeps them apart.
    const {createMMKV} =
      require('react-native-mmkv') as typeof import('react-native-mmkv');
    _store = createMMKV({id: 'analytics'}) as unknown as RecordStore;
  } catch {
    _store = null;
  }
  return _store;
}

/** The build number from the build-time manifest, the same source as the
 *  Sentry `dist`. */
function currentBuild(): string {
  try {
    const {readVersionInfo} =
      require('./debugId') as typeof import('./debugId');
    const v = readVersionInfo();
    return v ? String(v.buildNumber) : 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseRecord(raw: string | undefined): MainThreadStallRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<MainThreadStallRecord>;
    if (
      r &&
      typeof r.build === 'string' &&
      typeof r.stalls === 'number' &&
      Number.isInteger(r.stalls) &&
      r.stalls >= 0
    ) {
      return {build: r.build, stalls: r.stalls};
    }
  } catch {
    // corrupt — ignore it
  }
  return null;
}

let movedThisProcess = false;

/** Once per process, before the first write: move the previous process's
 *  record from CURRENT to PENDING. */
function movePreviousToPending(s: RecordStore): void {
  if (movedThisProcess) return;
  movedThisProcess = true;
  const previous = parseRecord(s.getString(CURRENT_KEY));
  if (previous) s.set(PENDING_KEY, JSON.stringify(previous));
  s.remove(CURRENT_KEY);
}

function writeCurrent(stalls: number): void {
  try {
    const s = store();
    if (!s) return;
    movePreviousToPending(s);
    s.set(CURRENT_KEY, JSON.stringify({build: currentBuild(), stalls}));
  } catch {
    // fail closed — never throw into the watchdog
  }
}

/** The watchdog started in this process: record it with 0 stalls, so a
 *  process with no stall still counts in the denominator. */
export function startMainThreadStallRecord(): void {
  writeCurrent(0);
}

/** Record how many stalls this process has had so far. */
export function persistMainThreadStallCount(count: number): void {
  writeCurrent(count);
}

/** The previous record, or null when there is none or it cannot be read.
 *  Returns a record only once. */
export function takePreviousProcessStallRecord(): MainThreadStallRecord | null {
  try {
    const s = store();
    if (!s) return null;
    movePreviousToPending(s);
    const record = parseRecord(s.getString(PENDING_KEY));
    s.remove(PENDING_KEY);
    return record;
  } catch {
    return null;
  }
}

/** Test seam — forget the handle and the per-process state (a new process).
 *  Stored records stay. */
export function __resetMainThreadStallCountForTests(): void {
  _store = undefined;
  movedThisProcess = false;
}
