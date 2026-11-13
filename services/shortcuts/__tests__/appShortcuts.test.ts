// @ai-generated
// Qariah (2026-11-11): the app shortcuts (services/shortcuts/appShortcuts.ts).
import {WIDGET_SHORTCUT_TARGETS} from '@/modules/bayaan-widgets/src/commands';
import {
  APP_SHORTCUTS,
  EXPAND_DELAY_MS,
  continueListening,
  continueReadingPage,
  isAppShortcut,
  openAppShortcutRoute,
} from '../appShortcuts';

jest.mock('@/services/notifications/tapRouter', () => ({
  LISTEN_ROUTE: '/(tabs)/(a.home)',
  MUSHAF_RESTORE_WAIT_MS: 10_000,
  SESSION_WAIT_MS: 20_000,
}));

describe('the shortcut list', () => {
  it('is the list of the widget command guard', () => {
    expect([...APP_SHORTCUTS]).toEqual([...WIDGET_SHORTCUT_TARGETS]);
  });

  it('each shortcut has its link route', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    for (const s of APP_SHORTCUTS) {
      expect(
        fs.existsSync(
          path.join(__dirname, '..', '..', '..', 'app', `${s}.tsx`),
        ),
      ).toBe(true);
    }
  });

  it('isAppShortcut takes only the three', () => {
    expect(isAppShortcut('search')).toBe(true);
    expect(isAppShortcut('settings')).toBe(false);
    expect(isAppShortcut(undefined)).toBe(false);
  });
});

describe('continueReadingPage', () => {
  it('is the last page read', () => {
    expect(continueReadingPage(250)).toBe(250);
    expect(continueReadingPage(604)).toBe(604);
  });

  it('is page 1 (Al-Fatihah) with no reading, or with a bad page', () => {
    expect(continueReadingPage(null)).toBe(1);
    expect(continueReadingPage(undefined)).toBe(1);
    expect(continueReadingPage(0)).toBe(1);
    expect(continueReadingPage(605)).toBe(1);
    expect(continueReadingPage(12.5)).toBe(1);
  });
});

describe('continueListening', () => {
  const deps = (resumed: boolean) => {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        waitForSession: async () => {
          calls.push('session');
        },
        delay: async (ms: number) => {
          calls.push(`delay ${ms}`);
        },
        resumeLastSession: async () => {
          calls.push('resume');
          return resumed;
        },
        navigate: (href: string) => {
          calls.push(`navigate ${href}`);
        },
      },
    };
  };

  it('waits for the session and the back transition, then resumes', async () => {
    const {calls, deps: d} = deps(true);
    await expect(continueListening(d)).resolves.toBe('resume');
    expect(calls).toEqual(['session', `delay ${EXPAND_DELAY_MS}`, 'resume']);
  });

  it('opens the Listen tab when there is nothing to resume', async () => {
    const {calls, deps: d} = deps(false);
    await expect(continueListening(d)).resolves.toBe('listen');
    expect(calls.at(-1)).toBe('navigate /(tabs)/(a.home)');
  });
});

describe('openAppShortcutRoute (the iOS widget command)', () => {
  it('waits for the Mushaf restore, closes the sheets, then pushes the route', async () => {
    const calls: string[] = [];
    await openAppShortcutRoute('continue-reading', {
      waitForMushafRestore: async () => {
        calls.push('restore');
      },
      closeSheets: async () => {
        calls.push('sheets');
      },
      push: href => {
        calls.push(`push ${href}`);
      },
    });
    expect(calls).toEqual(['restore', 'sheets', 'push /continue-reading']);
  });
});
