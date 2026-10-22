// @ai Qariah: the widget surfaces Qariah ships (RFC-021 fork seam).
// Owner decision O5, 2026-10-18 (Sprint 46 GATE 1): a core set only.
// A change to this list needs a native build and a DIVERGENCE_LEDGER update.
import {featureFlags} from '@/config/featureFlags';
import nativeWidgetsConfig from '@/config/nativeWidgets.config';
import {ANDROID_WIDGET_IDS, resolveNativeWidgets} from '@/config/nativeWidgets';

const QARIAH_WIDGETS = [
  'ContinueListening',
  'ContinueReading',
  'QuickSurah',
  'AyahOfTheDay',
  'LiveActivity',
  'PlaybackControl',
];

describe('Qariah native widget list', () => {
  it('ships exactly the core set', () => {
    expect(nativeWidgetsConfig.widgets).toEqual(QARIAH_WIDGETS);
  });

  it('keeps every listed surface with the Qariah feature flags', () => {
    const resolved = resolveNativeWidgets(
      nativeWidgetsConfig.widgets,
      featureFlags,
    );
    expect(resolved.enabled).toEqual(QARIAH_WIDGETS);
  });

  it('ships the four Android surfaces of the core set', () => {
    const resolved = resolveNativeWidgets(
      nativeWidgetsConfig.widgets,
      featureFlags,
    );
    expect(
      resolved.enabled.filter(id => ANDROID_WIDGET_IDS.includes(id)),
    ).toEqual([
      'ContinueListening',
      'ContinueReading',
      'QuickSurah',
      'AyahOfTheDay',
    ]);
  });
});
