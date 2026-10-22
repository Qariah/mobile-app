/**
 * Expo config plugin: strip the QF OAuth callback scheme (`com.qariah.app`)
 * from the iOS CFBundleURLTypes that Expo auto-generates from the top-level
 * `scheme` array in app.config.ts.
 *
 * WHY (the public-beta sign-in breakage, 2026-06):
 * QF's OAuth client is registered with the redirect URI
 * `com.qariah.app:/quranoauth2redirect`, so the app's `scheme` array lists
 * `com.qariah.app` — which Expo turns into a CFBundleURLTypes entry on BOTH
 * platforms. On iOS that is actively harmful: `WebBrowser.openAuthSessionAsync`
 * uses `ASWebAuthenticationSession`, which intercepts the callback URL scheme
 * at the *session* level and does NOT need the scheme registered in
 * Info.plist. When the scheme IS also a registered app URL scheme, iOS races
 * the OS-level `openURL` delivery against the session and the openURL path can
 * win — it foregrounds the app (Expo Router then navigates to the default tab)
 * and CANCELS the active ASWebAuthenticationSession. The result: the OAuth
 * `code` never reaches `signIn()`, no tokens are exchanged/persisted, and the
 * app silently lands on the Listen tab. Removing the scheme from iOS lets the
 * session capture the redirect cleanly.
 *
 * Android is the OPPOSITE: its Chrome-Custom-Tabs OAuth flow relies on the
 * redirect returning to the app via the `com.qariah.app` intent-filter, so the
 * scheme MUST stay registered there. This plugin therefore touches iOS only;
 * `scheme` keeps `com.qariah.app` for Android, and `AndroidManifest.xml` is
 * left untouched.
 *
 * The committed `ios/Qariah/Info.plist` is also edited directly (the build
 * uses the committed file when no prebuild runs — see CLAUDE.md Sprint 32
 * rule #4); this plugin keeps a re-prebuild from regressing it.
 */

const {withInfoPlist} = require('@expo/config-plugins');

const OAUTH_CALLBACK_SCHEME = 'com.qariah.app';

const withIosRemoveOAuthCallbackScheme = config => {
  return withInfoPlist(config, cfg => {
    const urlTypes = cfg.modResults.CFBundleURLTypes;
    if (!Array.isArray(urlTypes)) return cfg;

    for (const entry of urlTypes) {
      if (Array.isArray(entry?.CFBundleURLSchemes)) {
        entry.CFBundleURLSchemes = entry.CFBundleURLSchemes.filter(
          scheme => scheme !== OAUTH_CALLBACK_SCHEME,
        );
      }
    }

    // Drop any URL-type entries left with no schemes after the filter.
    cfg.modResults.CFBundleURLTypes = urlTypes.filter(
      entry =>
        !Array.isArray(entry?.CFBundleURLSchemes) ||
        entry.CFBundleURLSchemes.length > 0,
    );

    return cfg;
  });
};

module.exports = withIosRemoveOAuthCallbackScheme;
