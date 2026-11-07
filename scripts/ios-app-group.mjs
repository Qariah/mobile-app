#!/usr/bin/env node
// @ai
//
// scripts/ios-app-group.mjs
// -------------------------
// Qariah (TECH_DEBT #289, Sprint 50): the App Group step of
// scripts/ios-archive.sh. The logic is in scripts/lib/ios-app-group.mjs.
//
//   resolve --bundle-id <app id> [--field group|legacy]
//       Print the group of an archive of that app (or the group it moves its
//       data from; an empty line when there is none).
//   apply   --bundle-id <app id> [--root <dir>]
//       Rewrite the App Group files to the group of that app. The archive
//       script backs up the files first and restores them on exit.
//   check   --bundle-id <app id> [--root <dir>]
//       Print one line for each file that does not use the group of that app.
//       Exit 1 when there is a line.
//   show    [--root <dir>]
//       Print the bundle id and the entitlement groups of each target.
//   portal  [--root <dir>] [--rerun <command>]
//       Read (App Store Connect API, GET only) whether the developer portal
//       allows the groups that each target asks for. Print the owner step
//       when it does not. Exit 0 OK, 1 MISSING, 2 UNCONFIRMED, 3 not checked.
//
// The production bundle id comes from config/branding.js (scripts/lib/app-ids.mjs).

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {IOS_BUNDLE_ID} from './lib/app-ids.mjs';
import {
  applyAppGroup,
  archiveGroups,
  archiveTargets,
  checkAppGroup,
  fetchPortalTarget,
  ownerInstructions,
  portalLines,
} from './lib/ios-app-group.mjs';

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

function groupsFor(options) {
  const bundleId = options['bundle-id'];
  if (!bundleId) throw new Error('--bundle-id is required');
  return archiveGroups(bundleId, IOS_BUNDLE_ID);
}

async function portal(root, rerun) {
  let targets;
  try {
    targets = archiveTargets(root);
  } catch (error) {
    console.log(`  Portal:    not checked (${error.message})`);
    return 3;
  }
  let get;
  try {
    const {ascGet, ascJwt} = await import('./lib/asc-client.mjs');
    const jwt = ascJwt();
    get = p => ascGet(p, jwt);
  } catch (error) {
    console.log(
      `  Portal:    not checked: no App Store Connect API key (${error.message})`,
    );
    return 3;
  }
  const results = [];
  try {
    for (const target of targets) {
      results.push(await fetchPortalTarget(target, get));
    }
  } catch (error) {
    console.log(`  Portal:    not checked (${error.message})`);
    return 3;
  }
  console.log('  Portal (App Store Connect, read only):');
  for (const line of portalLines(results)) console.log(line);
  const steps = ownerInstructions(results, {rerun});
  if (steps.length > 0) {
    console.log('');
    for (const line of steps) console.log(line);
    return 1;
  }
  return results.some(r => r.status === 'unconfirmed') ? 2 : 0;
}

async function main() {
  const {command, options} = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  switch (command) {
    case 'resolve': {
      const {group, legacyGroup} = groupsFor(options);
      const field = options.field ?? 'group';
      if (field !== 'group' && field !== 'legacy') {
        throw new Error('--field must be group or legacy');
      }
      console.log(field === 'group' ? group : (legacyGroup ?? ''));
      return 0;
    }
    case 'apply': {
      const groups = groupsFor(options);
      const changed = applyAppGroup(root, groups);
      for (const rel of changed) console.log(`  ${rel}`);
      return 0;
    }
    case 'check': {
      const problems = checkAppGroup(root, groupsFor(options));
      for (const line of problems) console.log(line);
      return problems.length > 0 ? 1 : 0;
    }
    case 'show': {
      for (const t of archiveTargets(root)) {
        console.log(
          `      ${t.target}: ${t.bundleId} -> ${t.groups.join(', ') || '<no group>'}`,
        );
      }
      return 0;
    }
    case 'portal':
      return portal(root, options.rerun);
    default:
      throw new Error(
        'usage: ios-app-group.mjs resolve|apply|check|show|portal [options]',
      );
  }
}

main().then(
  code => {
    process.exitCode = code;
  },
  error => {
    console.error(`ios-app-group: ${error.message}`);
    process.exitCode = 4;
  },
);
