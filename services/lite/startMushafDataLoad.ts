// @ai Qariah (Lite mode, step 1) — start the Mushaf data load on demand.
//
// Required when a load starts, not at import: the Mushaf service pulls in
// Skia, which does not belong on the Lite boot path. Callers: the route hook
// (hooks/useLiteOnDemandData.ts) and the player's "Show text" button, when a
// Mushaf screen is needed before the boot's own load after the splash
// (services/qariahBoot.ts). It loads what that boot load loads: the Mushaf
// data and the DigitalKhatt fonts for React Native text.
export function startMushafDataLoad(): void {
  const {mushafPreloadService} =
    require('@/services/mushaf/MushafPreloadService') as typeof import('@/services/mushaf/MushafPreloadService');
  const Font = require('expo-font') as typeof import('expo-font');
  Promise.all([
    mushafPreloadService.initialize(),
    Font.loadAsync({
      DigitalKhattV1: require('@/data/mushaf/legacy/DigitalKhattQuranicV1.otf'),
      DigitalKhattV2: require('@/data/mushaf/digitalkhatt/DigitalKhattFont.otf'),
    }),
  ]).catch(() => undefined);
}
