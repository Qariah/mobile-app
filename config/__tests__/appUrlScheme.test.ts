// @ai Qariah (TECH_DEBT #342): the one rule for the URL scheme of an iOS
// build, and the scheme that app.config.js gives the embedded app config.

import branding from '../branding';
import {
  ARCHIVE_BUNDLE_ID_ENV,
  OAUTH_CALLBACK_SCHEME,
  devClientScheme,
  urlSchemeForBundleId,
} from '../appUrlScheme';

const PROD = branding.bundleId.ios;
const BETA = `${PROD}.beta`;

describe('urlSchemeForBundleId', () => {
  it('keeps the production scheme for production and the public beta', () => {
    // The public beta archive keeps the production bundle id.
    expect(urlSchemeForBundleId(PROD, PROD, branding.urlScheme)).toBe('qariah');
  });

  it('gives the internal beta its own scheme', () => {
    expect(urlSchemeForBundleId(BETA, PROD, branding.urlScheme)).toBe(
      'qariah-beta',
    );
    expect(devClientScheme('qariah-beta')).toBe('exp+qariah-beta');
  });

  it('rejects an app that is not production or a variant of it', () => {
    expect(() =>
      urlSchemeForBundleId('com.other.app', PROD, branding.urlScheme),
    ).toThrow();
    expect(() =>
      urlSchemeForBundleId(`${PROD}.beta.widget`, PROD, branding.urlScheme),
    ).toThrow();
    expect(() => urlSchemeForBundleId('', PROD, branding.urlScheme)).toThrow();
    expect(() => urlSchemeForBundleId(BETA, PROD, '1bad')).toThrow();
  });

  it('never uses the OAuth callback scheme as the app scheme', () => {
    expect(urlSchemeForBundleId(PROD, PROD, branding.urlScheme)).not.toBe(
      OAUTH_CALLBACK_SCHEME,
    );
  });
});

describe('app.config.js scheme', () => {
  const saved = process.env[ARCHIVE_BUNDLE_ID_ENV];

  afterEach(() => {
    if (saved === undefined) delete process.env[ARCHIVE_BUNDLE_ID_ENV];
    else process.env[ARCHIVE_BUNDLE_ID_ENV] = saved;
  });

  function loadScheme(): unknown {
    let scheme: unknown;
    jest.isolateModules(() => {
      scheme = require('../../app.config.js').expo.scheme;
    });
    return scheme;
  }

  it('is the production scheme when no archive names a bundle id', () => {
    delete process.env[ARCHIVE_BUNDLE_ID_ENV];
    expect(loadScheme()).toEqual(['qariah', OAUTH_CALLBACK_SCHEME]);
  });

  it('is the production scheme for a production archive', () => {
    process.env[ARCHIVE_BUNDLE_ID_ENV] = PROD;
    expect(loadScheme()).toEqual(['qariah', OAUTH_CALLBACK_SCHEME]);
  });

  it('is the beta scheme for a beta archive, and keeps the OAuth scheme', () => {
    process.env[ARCHIVE_BUNDLE_ID_ENV] = BETA;
    expect(loadScheme()).toEqual(['qariah-beta', OAUTH_CALLBACK_SCHEME]);
  });
});
