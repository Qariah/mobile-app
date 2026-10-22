import {
  ANDROID_WIDGET_IDS,
  NATIVE_WIDGET_IDS,
  resolveNativeWidgets,
} from '@/config/nativeWidgets';
import {featureFlags} from '@/config/featureFlags';
import nativeWidgetsConfig from '@/config/nativeWidgets.config';

// @ai Qariah: this upstream suite pins Bayaan's widget set, which needs the
// flags Qariah turns off (adhkar, the ambient overlay). Run it with upstream's
// flag values (see test-utils/upstreamFeatureFlags.ts).
jest.mock('@/config/featureFlags', () =>
  jest.requireActual('@/test-utils/upstreamFeatureFlags'),
);
// @ai Qariah: the same for the widget list. Qariah ships a core set (owner
// decision O5, 2026-10-18); Bayaan ships every surface. Run this suite with
// upstream's list (see test-utils/upstreamNativeWidgetsConfig.ts).
// config/__tests__/nativeWidgets.qariah.test.ts asserts Qariah's list.
jest.mock('@/config/nativeWidgets.config', () =>
  jest.requireActual('@/test-utils/upstreamNativeWidgetsConfig'),
);

const ALL_ON = {
  adhkar: true,
  ambientAudioOverlay: true,
  sleepTimer: true,
  userUploads: true,
};

describe('resolveNativeWidgets', () => {
  it('ships every surface and feature for Bayaan', () => {
    const resolved = resolveNativeWidgets(
      nativeWidgetsConfig.widgets,
      featureFlags,
    );
    expect(resolved.enabled).toEqual([...NATIVE_WIDGET_IDS]);
    expect(resolved.features).toEqual({
      adhkar: true,
      sleepTimer: true,
      ambient: true,
    });
  });

  it('treats an absent list as every surface', () => {
    expect(resolveNativeWidgets(undefined, ALL_ON).enabled).toEqual([
      ...NATIVE_WIDGET_IDS,
    ]);
    expect(resolveNativeWidgets(undefined, undefined).enabled).toEqual([
      ...NATIVE_WIDGET_IDS,
    ]);
  });

  it('keeps only listed surfaces, in canonical order, ignoring unknown ids', () => {
    const resolved = resolveNativeWidgets(
      ['QuickSurah', 'NotAWidget', 'ContinueListening'],
      ALL_ON,
    );
    expect(resolved.enabled).toEqual(['ContinueListening', 'QuickSurah']);
    expect(resolveNativeWidgets([], ALL_ON).enabled).toEqual([]);
  });

  it('drops the adhkar surfaces and cards when adhkar is off', () => {
    const resolved = resolveNativeWidgets(undefined, {
      ...ALL_ON,
      adhkar: false,
    });
    expect(resolved.enabled).not.toContain('Adhkar');
    expect(resolved.enabled).not.toContain('Tasbeeh');
    expect(resolved.enabled).toContain('BayaanNow');
    expect(resolved.features.adhkar).toBe(false);
  });

  it('drops the Bedtime widget and card when the sleep timer is off', () => {
    const resolved = resolveNativeWidgets(undefined, {
      ...ALL_ON,
      sleepTimer: false,
    });
    expect(resolved.enabled).not.toContain('Bedtime');
    expect(resolved.features.sleepTimer).toBe(false);
  });

  it('keeps Bedtime but drops its ambient option without ambient audio', () => {
    const resolved = resolveNativeWidgets(undefined, {
      ...ALL_ON,
      ambientAudioOverlay: false,
    });
    expect(resolved.enabled).toContain('Bedtime');
    expect(resolved.features.ambient).toBe(false);
  });

  it('applies flags on top of an explicit list', () => {
    const resolved = resolveNativeWidgets(['Adhkar', 'QuickSurah'], {
      ...ALL_ON,
      adhkar: false,
    });
    expect(resolved.enabled).toEqual(['QuickSurah']);
  });

  it('lists Android surfaces as a prefix of all surfaces', () => {
    expect(ANDROID_WIDGET_IDS).toEqual(NATIVE_WIDGET_IDS.slice(0, 12));
    expect(ANDROID_WIDGET_IDS).not.toContain('LiveActivity');
    expect(ANDROID_WIDGET_IDS).not.toContain('VerseOfTheDayAccessory');
  });
});
