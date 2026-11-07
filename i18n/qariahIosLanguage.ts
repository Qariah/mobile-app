// @ai-generated
// Qariah: the iOS per-app language follows the in-app language choice
// (Sprint 47, Pass C, Tier-2 fix).
//
// On iOS, a Text without `textAlign` has the "natural" alignment, and UIKit
// takes "natural" from the app's iOS localization, not from React Native's
// layout direction. `I18nManager.forceRTL` (i18n/language.ts) flips the
// layout, but with the device in English the localization stays English, so
// Arabic labels were aligned left (Android takes the direction from the text
// and aligned them right). An iOS device in Arabic, or the per-app language in
// the iOS Settings app, does not show the defect.
//
// The fix does what the per-app language setting of iOS does: it writes the
// app's `AppleLanguages` user default (through a native setter, because
// "System default" must remove it). UIKit reads it at launch, so it takes
// effect with the restart that a language change already needs. A marker key
// records the value that this module wrote, so "System default" removes only
// our own value and never a per-app language that the person set in the iOS
// Settings app.
//
// With an RTL iOS localization, UIKit also mirrors native controls. A UISlider
// (@react-native-community/slider) then fills from the right even inside
// `forceLTR`, which only sets the Yoga direction. An iOS device in Arabic
// already did this. `invertLtrNativeSlider` is true in that state; a slider
// that upstream keeps left to right passes it as `inverted`.
import {Platform, Settings} from 'react-native';
import type {LanguagePreference} from './language';
import {getLanguageConfig, isAppLanguage} from './languages';

const APPLE_LANGUAGES = 'AppleLanguages';
const MARKER = 'qariah_apple_languages';

function readFirstAppleLanguage(): string | null {
  const value = Settings.get(APPLE_LANGUAGES);
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
}

/**
 * Whether UIKit runs right to left in this launch: the first language in
 * `AppleLanguages` (as read at startup) that the app is localized for is an
 * RTL language. The app's bundle picks its localization the same way.
 */
function launchLocalizationIsRTL(): boolean {
  try {
    if (Platform?.OS !== 'ios') return false;
    const languages = Settings.get(APPLE_LANGUAGES);
    if (!Array.isArray(languages)) return false;
    for (const tag of languages) {
      if (typeof tag !== 'string') continue;
      const code = tag.split(/[-_]/)[0];
      if (isAppLanguage(code)) {
        return getLanguageConfig(code).direction === 'rtl';
      }
    }
  } catch {
    // No native settings module (tests).
  }
  return false;
}

/**
 * True when a native slider inside `forceLTR` must be `inverted` to stay left
 * to right (iOS with an RTL localization; see the header comment).
 */
export const invertLtrNativeSlider: boolean = launchLocalizationIsRTL();

interface AppLanguageModule {
  setPreferredLanguage(code: string | null): void;
  getSystemLanguages?(): string[];
}

/**
 * The native setter (modules/qariah-memory, iOS only). React Native's
 * `Settings` cannot remove a user default, and "System default" must remove
 * it. Null when the binary does not have it (an older build): then nothing is
 * synced.
 */
function appLanguageModule(): AppLanguageModule | null {
  try {
    const core = require('expo') as {
      requireOptionalNativeModule<T>(name: string): T | null;
    };
    return core.requireOptionalNativeModule<AppLanguageModule>(
      'QariahAppLanguage',
    );
  } catch {
    return null;
  }
}

// What this session wrote; `Settings.get` can lag behind a native write.
let writtenThisSession: string | null = null;

/**
 * The device's language codes, without the per-app value that Qariah wrote.
 * Null when no Qariah value is active (or not iOS, or an older binary): then
 * `expo-localization` already reports the device languages. While a Qariah
 * value is active, `getLocales()` returns that value first, so "System
 * default" would resolve to the in-app choice (Sprint 47 review).
 */
export function deviceLanguagesWithoutOverride(): string[] | null {
  try {
    if (Platform?.OS !== 'ios') return null;
    const marker = Settings.get(MARKER);
    if (typeof marker !== 'string' || !marker) return null;
    const native = appLanguageModule();
    const tags = native?.getSystemLanguages?.();
    if (!Array.isArray(tags) || tags.length === 0) return null;
    return tags.map(tag => tag.split(/[-_]/)[0]);
  } catch {
    return null;
  }
}

/**
 * Writes the iOS per-app language for `preference`. Returns true when it
 * changed the value that the next launch reads (the app must restart).
 * Does nothing on other platforms.
 */
export function syncIosAppLanguage(preference: LanguagePreference): boolean {
  try {
    if (Platform?.OS !== 'ios') return false;
    const native = appLanguageModule();
    if (!native) return false;
    const marker = Settings.get(MARKER);
    const written = typeof marker === 'string' && marker ? marker : null;
    if (preference === 'system') {
      if (!written) return false;
      // Remove our value only while it is still the active one, never a
      // per-app language that the person set in the iOS Settings app.
      const ours =
        writtenThisSession === written || readFirstAppleLanguage() === written;
      if (ours) native.setPreferredLanguage(null);
      Settings.set({[MARKER]: ''});
      writtenThisSession = null;
      return ours;
    }
    if (written === preference && readFirstAppleLanguage() === preference) {
      return false;
    }
    native.setPreferredLanguage(preference);
    Settings.set({[MARKER]: preference});
    writtenThisSession = preference;
    return true;
  } catch {
    // No native settings module (tests, a broken native build): the layout
    // still works; only the iOS alignment of unaligned text is off.
    return false;
  }
}
