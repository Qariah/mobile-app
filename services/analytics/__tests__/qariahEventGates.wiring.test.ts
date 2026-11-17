// @ai
// DO NOT DROP — guards the TECH_DEBT #391 hooks in four upstream files.
//
// The rules live in services/analytics/qariahEventGates.ts; the upstream files
// call them from small `@ai` hooks. A wholesale upstream take of one of these
// files is the known way to lose such lines (see ReciterProfile.tsx). The
// behavior tests are qariahEventGates.test.ts,
// ExpoAudioProvider.pauseResume.test.tsx and
// playerStore.analyticsGates.test.ts. The Mushaf reader and the root layout
// cost more mocking to mount than the assertion is worth, so this test reads
// their source (as main.rotationStage.test.ts does). When upstream takes a
// fix, retire the hook and this check together.
import {readFileSync} from 'fs';
import {join} from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** `length` characters of the source, from `start`. */
function after(source: string, start: string, length = 600): string {
  const i = source.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  return source.slice(i, i + length);
}

describe('TECH_DEBT #391 hooks', () => {
  it('components/mushaf/main.tsx sends mushaf_page_opened only for the first open of a page', () => {
    const src = read('components/mushaf/main.tsx');
    expect(src).toContain('const openedPagesRef = useRef(new Set<number>())');
    const gate = after(
      src,
      'if (firstOpenInSession(openedPagesRef.current, page))',
      120,
    );
    expect(gate).toContain('analyticsService.trackMushafPageOpened(');
    expect(src.match(/trackMushafPageOpened\(/g)).toHaveLength(1);
  });

  it('app/_layout.tsx counts only a real background', () => {
    const src = read('app/_layout.tsx');
    expect(src).toContain('appLifecycleListener(AppState.currentState)');
    expect(src).not.toMatch(/nextState === 'inactive'/);
    expect(src.match(/trackAppBackgrounded\(/g)).toBeNull();
  });

  it('services/audio/ExpoAudioProvider.tsx gates the pause, the resume and the autoplay source', () => {
    const src = read('services/audio/ExpoAudioProvider.tsx');
    expect(src).toContain('realPauseRef.current = !isTrackEndPause(status);');
    expect(
      after(src, 'if (realPauseRef.current) {\n            realPauseRef', 200),
    ).toContain('trackPlaybackResumed(');
    expect(
      after(src, 'realPauseRef.current = !isTrackEndPause(status);', 200),
    ).toContain('trackPlaybackPaused(');
    expect(src).toContain(
      "source: takeAutoplayStart(currentTrack.id) ? 'autoplay' : 'queue'",
    );
    expect(src.match(/await skipToNext\(\{auto: true\}\)/g)).toHaveLength(2);
    expect(src).not.toMatch(/await skipToNext\(\);/);
  });

  it('services/player/store/playerStore.ts gates the skip and merges the seeks', () => {
    const src = read('services/player/store/playerStore.ts');
    expect(src).toContain(
      'if (!auto && currentTrack?.surahId && !currentTrack.isUserUpload)',
    );
    expect(src).toContain(
      'markAutoplayStart(auto ? tracks[nextIndex]?.id : null);',
    );
    expect(src).toContain('noteSeek(currentTrack.id, {');
    expect(src).not.toContain('analyticsService.trackPlaybackSeeked(');
  });
});
