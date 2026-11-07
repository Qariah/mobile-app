#!/usr/bin/env node
// @ai
//
// scripts/browserstack/validate-device-sets.mjs
// ---------------------------------------------
// Validate every entry in device-sets.json against BrowserStack's LIVE
// App Automate device catalogue.
//
// Why this exists: device-sets.json was originally hand-written from the
// BrowserStack docs page and never executed. On its first real use
// (2026-08-02, the 3.2.0 release) 5 of its entries did not exist —
// "Xiaomi Redmi Note 12 Pro-12.0" and "Samsung Galaxy A55-14.0" are not
// carried at all, and "iPhone SE 2022" is offered on iOS 15, not 16. A
// run against a bad name fails deep inside the Maestro build with an
// unhelpful error, so validate cheaply up front instead.
//
//   set -a && source .env.local && set +a
//   node scripts/browserstack/validate-device-sets.mjs
//
// Exit 0 = every entry available. Exit 1 = at least one bad entry (prints
// the available OS versions for that device name, when the name exists).
//
// Env: BROWSERSTACK_USERNAME, BROWSERSTACK_ACCESS_KEY

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const USER = process.env.BROWSERSTACK_USERNAME;
const KEY = process.env.BROWSERSTACK_ACCESS_KEY;
if (!USER || !KEY) {
  console.error('❌ set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const sets = JSON.parse(readFileSync(join(here, 'device-sets.json'), 'utf8'));

const res = await fetch(
  'https://api-cloud.browserstack.com/app-automate/devices.json',
  {headers: {authorization: `Basic ${Buffer.from(`${USER}:${KEY}`).toString('base64')}`}},
);
if (!res.ok) {
  console.error(`❌ device catalogue fetch failed: HTTP ${res.status}`);
  process.exit(2);
}
const devices = await res.json();
const available = new Set(devices.map(d => `${d.device}-${d.os_version}`));

let bad = 0;
let checked = 0;
for (const [setName, set] of Object.entries(sets)) {
  if (setName.startsWith('_')) continue;
  for (const [os, list] of Object.entries(set)) {
    if (os.startsWith('_') || !Array.isArray(list)) continue;
    for (const entry of list) {
      checked++;
      if (available.has(entry)) continue;
      bad++;
      const name = entry.replace(/-[^-]*$/, '');
      const alts = devices
        .filter(d => d.device === name)
        .map(d => d.os_version)
        .sort();
      console.error(
        `✗ ${setName}/${os}: "${entry}" not available` +
          (alts.length
            ? ` — "${name}" is offered on OS ${alts.join(', ')}`
            : ` — no device named "${name}" in the catalogue`),
      );
    }
  }
}

if (bad) {
  console.error(`\n❌ ${bad} of ${checked} entries invalid — fix device-sets.json before running a suite.`);
  process.exit(1);
}
console.log(`✓ all ${checked} device entries available on BrowserStack`);
