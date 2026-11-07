#!/usr/bin/env node
// Runs `.maestro` flows, or catalog cases, on the test iPhone (TECH_DEBT #299).
// `scripts/iphone-device-test.sh` calls it inside the device lock, after WebDriverAgent starts.
//
//   node scripts/iphone/run.mjs [--app <Qariah.app>] [--out <dir>] <flow.yaml | dir | CASE-ID>...
//
// A CASE-ID (for example QP-04) maps to the flows in its "Maestro" column in
// docs/operations/regression-test-plan.md. A directory runs each `.yaml` in it, in name order.
// It writes one folder of evidence for each flow, `summary.json`, and exits 1 when a flow fails.

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import {join, resolve, basename, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Wda} from './lib/wda.mjs';
import {resolveUdid, installApp, installedApp} from './lib/device.mjs';
import {runFlowFile} from './lib/flow-runner.mjs';
import {CASES} from './cases.mjs';
import {lastApp} from './cli.mjs';
import {IOS_BUNDLE_ID} from '../lib/app-ids.mjs';

const ROOT = execFileSync(
  'git',
  [
    '-C',
    dirname(fileURLToPath(import.meta.url)),
    'rev-parse',
    '--show-toplevel',
  ],
  {
    encoding: 'utf8',
  },
).trim();
const CATALOG = join(ROOT, 'docs/operations/regression-test-plan.md');

/** The flows of a case id, from the "Maestro" column of the case catalog. */
export function flowsForCase(caseId, catalogText) {
  const row = catalogText
    .split('\n')
    .find(l => new RegExp(`^\\|\\s*${caseId}(\\s|\\||→)`).test(l));
  if (!row) throw new Error(`case ${caseId} is not in the case catalog`);
  const flows = [
    ...row.matchAll(/`((?:smoke|regression)\/[\w./-]+\.yaml)`/g),
  ].map(m => m[1]);
  if (flows.length === 0)
    throw new Error(`case ${caseId} has no Maestro flow; run it by its steps`);
  return flows.map(f => join(ROOT, '.maestro/flows', f));
}

function expand(target) {
  // A case with a device script (scripts/iphone/cases.mjs) runs that script; any other case
  // runs the flows of its "Maestro" column.
  if (CASES[target]) return [`case:${target}`];
  if (/^[A-Z]{2,5}-\d{2}$/.test(target))
    return flowsForCase(target, readFileSync(CATALOG, 'utf8'));
  const p = resolve(target);
  if (!existsSync(p)) throw new Error(`no such flow or case: ${target}`);
  if (statSync(p).isDirectory()) {
    return readdirSync(p)
      .filter(f => f.endsWith('.yaml'))
      .sort()
      .map(f => join(p, f));
  }
  return [p];
}

/** Runs one device case script and writes `result.json`, like a flow. */
async function runCase({wda, id, outDir}) {
  mkdirSync(outDir, {recursive: true});
  let shot = 0;
  const ctx = {
    wda,
    log: m => console.log(m),
    shot: async label => {
      shot += 1;
      return wda
        .screenshot(
          join(outDir, `${String(shot).padStart(3, '0')}-${label}.png`),
        )
        .catch(() => null);
    },
  };
  const started = Date.now();
  console.log(`▶ case ${id}`);
  let status = 'PASS';
  let failure = null;
  try {
    await CASES[id](ctx);
  } catch (err) {
    status = 'FAIL';
    failure = {message: err.message};
    console.log(`  ✗ ${err.message}`);
    await ctx.shot('FAIL');
  }
  const result = {
    flow: `case:${id}`,
    status,
    seconds: Math.round((Date.now() - started) / 1000),
    failure,
    outDir,
  };
  writeFileSync(
    join(outDir, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(`${status} ${id} (${result.seconds} s)`);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  let appPath = null;
  let out = null;
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--app') appPath = resolve(args[(i += 1)]);
    else if (args[i] === '--out') out = resolve(args[(i += 1)]);
    else targets.push(args[i]);
  }
  if (targets.length === 0)
    throw new Error('give a flow, a directory or a case id');
  const udid = resolveUdid();
  if (appPath) {
    installApp(udid, appPath);
    const cache =
      process.env.QARIAH_IPHONE_DRIVER_HOME ||
      join(homedir(), 'Library/Caches/qariah-iphone-driver');
    mkdirSync(cache, {recursive: true});
    writeFileSync(
      join(cache, 'last-app.json'),
      `${JSON.stringify({appPath, installedAt: new Date().toISOString()}, null, 2)}\n`,
    );
  }
  appPath = appPath || lastApp();
  const app = installedApp(udid, IOS_BUNDLE_ID);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  out = out || join(homedir(), 'claude/.scratch/iphone-device-test', stamp);
  mkdirSync(out, {recursive: true});
  console.log(
    `iPhone ${udid}; app ${app ? `${app.version} (${app.build})` : 'not installed'}; evidence ${out}`,
  );

  // No de-duplication: a repeated id runs again (an agent repeats a flaky case on purpose).
  const flows = targets.flatMap(expand);
  const wda = new Wda({udid});
  await wda.waitReady(30000);
  const results = [];
  for (const [i, flow] of flows.entries()) {
    const name = flow.startsWith('case:')
      ? flow.slice(5)
      : basename(flow, '.yaml');
    const dir = join(out, `${String(i + 1).padStart(2, '0')}-${name}`);
    results.push(
      flow.startsWith('case:')
        ? await runCase({wda, id: name, outDir: dir})
        : await runFlowFile({wda, udid, file: flow, outDir: dir, appPath}),
    );
  }
  const summary = {
    udid,
    app,
    started: stamp,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    results: results.map(r => ({
      flow: r.flow.replace(`${ROOT}/`, ''),
      status: r.status,
      seconds: r.seconds,
      failure: r.failure?.message,
    })),
  };
  writeFileSync(
    join(out, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(
    `\n${summary.passed}/${results.length} PASS — ${join(out, 'summary.json')}`,
  );
  for (const r of summary.results)
    console.log(`  ${r.status} ${r.flow}${r.failure ? ` — ${r.failure}` : ''}`);
  process.exitCode = summary.failed ? 1 : 0;
}

// Run only as a command, not on an import (the tests import the helpers).
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`iphone-device-test: ${err.message}`);
    process.exit(2);
  });
}
