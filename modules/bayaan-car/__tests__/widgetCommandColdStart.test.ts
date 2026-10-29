// @ai Qariah — DO NOT DROP at an upstream sync (TECH_DEBT #374).
//
// The defect (iOS, test iPhone on iOS 27): with the app stopped, a tap on a
// widget play button (Quick Surah, Continue Listening) played nothing. The
// play buttons are AudioPlaybackIntents: they run in the app process and only
// queue a command for JS (targets/widgets/_shared/WidgetCommandQueue.swift),
// which posts "BayaanWidgetCommandQueued" in that process. With the app
// stopped, iOS launches it in the background with no scene. React Native
// starts only from a scene delegate or a background Siri launch
// (BayaanCarSceneBridge.ensureStarted()), so JS never ran and the command
// expired after 60 s.
//
// The fix: BayaanCarSceneBridge observes that notification from configure()
// (the app delegate calls it at every launch) and starts React offscreen.
// These tests read the Swift sources: the iOS launch cannot run in Jest.
import {readFileSync} from 'fs';
import {join} from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const BRIDGE = read('modules/bayaan-car/ios/BayaanCarSceneBridge.swift');
const QUEUE = read('targets/widgets/_shared/WidgetCommandQueue.swift');
const WIDGETS_MODULE = read(
  'modules/bayaan-widgets/ios/BayaanWidgetsModule.swift',
);

/** The body of the Swift function `name`, braces included. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`func ${name}(`);
  if (start === -1) throw new Error(`No function: ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

/** Every `Notification.Name("…")` literal in a source. */
function notificationNames(source: string): string[] {
  return [...source.matchAll(/Notification\.Name\("([^"]+)"\)/g)].map(
    m => m[1],
  );
}

describe('a widget command starts React after a cold launch (TECH_DEBT #374)', () => {
  it('configure() starts to observe the widget commands', () => {
    expect(functionBody(BRIDGE, 'configure')).toContain(
      'observeWidgetCommands()',
    );
  });

  it('observes the notification that the intents post', () => {
    const posted = notificationNames(QUEUE);
    expect(posted).toHaveLength(1);
    expect(notificationNames(BRIDGE)).toEqual(posted);
    // The JS module listens to the same name when the app is running.
    expect(notificationNames(WIDGETS_MODULE)).toEqual(posted);
  });

  it('starts React only when no React host exists, with background time', () => {
    const observe = functionBody(BRIDGE, 'observeWidgetCommands');
    expect(observe).toMatch(/hostWindow == nil/);
    expect(observe).toContain('ensureStarted()');
    expect(observe).toContain('holdBackgroundTime(');
    const hold = functionBody(BRIDGE, 'holdBackgroundTime');
    expect(hold).toContain('beginBackgroundTask');
    expect(hold).toContain('endBackgroundTime()');
    expect(functionBody(BRIDGE, 'endBackgroundTime')).toContain(
      'endBackgroundTask',
    );
  });
});
