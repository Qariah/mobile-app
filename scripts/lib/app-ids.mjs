// @ai
//
// scripts/lib/app-ids.mjs
// -----------------------
// The store ids of the app, read from config/branding.js (TECH_DEBT #246).
// Before this file, ten scripts each wrote 'com.qariah.app' or '1594917787'.
//
// config/branding.js is a CommonJS module, so an ES module loads it with a
// default import. It has no top-level `require` of a React Native package, so
// plain Node loads it without node_modules.
//
// A script still lets an environment variable win (PLAY_PACKAGE, ASC_APP_ID,
// ...). These are the defaults.
//
// The Sentry org and project are NOT here: branding.js holds no Sentry data.
// They are named constants in scripts/lib/sentry-client.mjs.

import branding from '../../config/branding.js';

/** e.g. 'qariah' */
export const APP_SLUG = branding.appSlug;

/** The Google Play package name, e.g. 'com.qariah.app'. */
export const ANDROID_PACKAGE_NAME = branding.bundleId.android;

/** The App Store bundle id, e.g. 'com.qariah.app'. */
export const IOS_BUNDLE_ID = branding.bundleId.ios;

/** The numeric App Store Connect app id, as a string. */
export const APP_STORE_ID = branding.appStoreId;
