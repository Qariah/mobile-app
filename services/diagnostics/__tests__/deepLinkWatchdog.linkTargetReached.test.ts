// @ai
// Qariah (Sprint 46, Pass B review): upstream's widget links include redirect
// routes. The watchdog and the cold-start replay must count the redirect's
// landing as "the link reached its target", or the replay navigates a second
// time and the watchdog reports a false `deeplink-dropped`.

jest.mock('@/services/analytics/qariahEvents', () => ({qariahAnalytics: {}}));

import {linkTargetReached} from '../deepLinkWatchdog';

describe('linkTargetReached', () => {
  it('matches the first segment of a normal route', () => {
    expect(linkTargetReached('/reciter/zaynab-talha', 'reciter/x')).toBe(true);
    expect(linkTargetReached('/mushaf', 'mushaf/50')).toBe(true);
  });

  it('does not match on a substring or on the bare home path', () => {
    expect(linkTargetReached('/reciter-choice', 'reciter/x')).toBe(false);
    expect(linkTargetReached('/', 'reciter/x')).toBe(false);
    expect(linkTargetReached('', 'mushaf/50')).toBe(false);
  });

  it('counts Home as the landing of qariah://player (app/player.tsx)', () => {
    expect(linkTargetReached('/', 'player')).toBe(true);
    expect(linkTargetReached('/player', 'player')).toBe(true);
    expect(linkTargetReached('/mushaf', 'player')).toBe(false);
  });

  it('counts the Mushaf reader as the landing of qariah://quran/<surah>', () => {
    expect(linkTargetReached('/mushaf', 'quran/18?ayah=10')).toBe(true);
    expect(linkTargetReached('/quran/18', 'quran/18')).toBe(true);
    expect(linkTargetReached('/', 'quran/18')).toBe(false);
  });
});
