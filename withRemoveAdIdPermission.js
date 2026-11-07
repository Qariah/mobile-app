/**
 * Expo config plugin: strip the AD_ID permission auto-injected by Google
 * Play Services from the Android merged manifest.
 *
 * Qariah does not use the advertising identifier (no ads, no ad attribution
 * SDKs, no AdMob, no FB/AppsFlyer/Adjust/Branch). One of our transitive
 * deps (likely a Play Services library) auto-merges
 *   <uses-permission android:name="com.google.android.gms.permission.AD_ID"/>
 * into the merged manifest, which makes Play Console's tracker scan flag
 * the app and reject the AAB until we file an advertising-ID declaration
 * via the Play form.
 *
 * We've declared "No, does not use advertising ID" in Play Console. This
 * plugin makes the manifest match the declaration unambiguously by
 * injecting the standard `tools:node="remove"` override so the manifest
 * merger drops the permission at build time.
 *
 * See TECH_DEBT #29 (Play upload-key reset thread) + Sprint 24 S24.0.
 */

const {withAndroidManifest} = require('@expo/config-plugins');

const AD_ID = 'com.google.android.gms.permission.AD_ID';

const withRemoveAdIdPermission = config => {
  return withAndroidManifest(config, async cfg => {
    const manifest = cfg.modResults.manifest;
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const already = manifest['uses-permission'].some(
      entry => entry?.$?.['android:name'] === AD_ID,
    );
    if (!already) {
      manifest['uses-permission'].push({
        $: {
          'android:name': AD_ID,
          'tools:node': 'remove',
        },
      });
    }

    // Ensure xmlns:tools is declared on the root <manifest> element (the
    // manifest-merger needs it to honour the tools:node attribute).
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    return cfg;
  });
};

module.exports = withRemoveAdIdPermission;
