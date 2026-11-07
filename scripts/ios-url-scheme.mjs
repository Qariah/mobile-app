#!/usr/bin/env node
// @ai
//
// scripts/ios-url-scheme.mjs
// --------------------------
// Qariah (TECH_DEBT #342, Sprint 51): the URL scheme step of
// scripts/ios-archive.sh. The logic is in scripts/lib/ios-url-scheme.mjs; the
// rule is in config/appUrlScheme.js.
//
//   resolve --bundle-id <app id> [--field scheme|dev-client]
//       Print the URL scheme of an archive of that app (or its Expo dev
//       client scheme).
//   apply   --bundle-id <app id> [--root <dir>]
//       Rewrite the app-link files to the scheme of that app. The archive
//       script backs up the files first and restores them on exit.
//   check   --bundle-id <app id> [--root <dir>]
//       Print one line for each file that does not use the scheme of that
//       app, and for an app.config.js (read with the archive's environment)
//       that does not. Exit 1 when there is a line.
//   show    [--root <dir>]
//       Print the URL types, the hand-off and the widget scheme of the tree.
//
// The production bundle id and scheme come from config/branding.js
// (scripts/lib/app-ids.mjs).

import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {APP_URL_SCHEME, IOS_BUNDLE_ID} from './lib/app-ids.mjs';
import {
  ARCHIVE_BUNDLE_ID_ENV,
  applyUrlScheme,
  archiveSchemes,
  checkUrlScheme,
  configSchemeProblems,
  describeUrlSchemes,
} from './lib/ios-url-scheme.mjs';

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} needs a value`);
    }
    options[arg.slice(2)] = value;
    i += 1;
  }
  return {command, options};
}

function schemesFor(options) {
  const bundleId = options['bundle-id'];
  if (!bundleId) throw new Error('--bundle-id is required');
  return archiveSchemes(bundleId, IOS_BUNDLE_ID, APP_URL_SCHEME);
}

/** app.config.js as the archive's build reads it (ARCHIVE_BUNDLE_ID_ENV set). */
function loadAppConfig(root, bundleId) {
  const file = path.join(root, 'app.config.js');
  if (!existsSync(file)) return null;
  process.env[ARCHIVE_BUNDLE_ID_ENV] = bundleId;
  return createRequire(file)(file);
}

function main() {
  const {command, options} = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  switch (command) {
    case 'resolve': {
      const schemes = schemesFor(options);
      const field = options.field ?? 'scheme';
      if (field !== 'scheme' && field !== 'dev-client') {
        throw new Error('--field must be scheme or dev-client');
      }
      console.log(
        field === 'scheme' ? schemes.scheme : schemes.devClientScheme,
      );
      return 0;
    }
    case 'apply': {
      const changed = applyUrlScheme(root, schemesFor(options));
      for (const rel of changed) console.log(`  ${rel}`);
      return 0;
    }
    case 'check': {
      const schemes = schemesFor(options);
      const problems = checkUrlScheme(root, schemes);
      const config = loadAppConfig(root, options['bundle-id']);
      if (config) problems.push(...configSchemeProblems(config, schemes));
      for (const line of problems) console.log(line);
      return problems.length > 0 ? 1 : 0;
    }
    case 'show':
      for (const line of describeUrlSchemes(root)) console.log(line);
      return 0;
    default:
      throw new Error(
        'usage: ios-url-scheme.mjs resolve|apply|check|show [options]',
      );
  }
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ios-url-scheme: ${error.message}`);
  process.exitCode = 4;
}
