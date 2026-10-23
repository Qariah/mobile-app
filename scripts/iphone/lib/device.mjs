// devicectl helpers for the test iPhone driver (TECH_DEBT #299).
//
// `xcrun devicectl` installs, launches and inspects apps on a physical iPhone over the
// CoreDevice USB tunnel. The driver reads the tunnel address from it, and uses it to reach
// WebDriverAgent on the phone (no port forward is necessary).

import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Runs `xcrun devicectl <args> --json-output <file>` and returns the parsed `result`. */
export function devicectlJson(args, {timeoutMs = 120000} = {}) {
  const dir = mkdtempSync(
    join(process.env.TMPDIR || tmpdir(), 'iphone-devicectl-'),
  );
  const out = join(dir, 'out.json');
  try {
    execFileSync(
      'xcrun',
      ['devicectl', ...args, '--json-output', out, '--quiet'],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: timeoutMs,
      },
    );
    return JSON.parse(readFileSync(out, 'utf8')).result;
  } catch (err) {
    let detail = '';
    try {
      const parsed = JSON.parse(readFileSync(out, 'utf8'));
      detail = parsed.error?.userInfo?.NSLocalizedDescription?.string || '';
    } catch {
      detail = String(err.stderr || err.message || '')
        .trim()
        .split('\n')
        .slice(-3)
        .join(' ');
    }
    throw new Error(
      `devicectl ${args.slice(0, 3).join(' ')} failed: ${detail}`,
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function prop(device, key) {
  // devicectl moves the old *Properties dictionaries into `properties` (`connection`,
  // `device`, `hardware`). Read the new place first, then the old one.
  const p = device.properties || {};
  return (
    p.connection?.[key] ??
    p.device?.[key] ??
    p.hardware?.[key] ??
    device.connectionProperties?.[key] ??
    device.deviceProperties?.[key] ??
    device.hardwareProperties?.[key]
  );
}

/** The paired physical iPhones, as { udid, name, model, osVersion, state }. */
export function listPhones() {
  const res = devicectlJson(['list', 'devices']);
  return (res.devices || [])
    .filter(d => (prop(d, 'reality') || '') === 'physical')
    .filter(d => (prop(d, 'platform') || '') === 'iOS')
    .map(d => ({
      udid: prop(d, 'udid'),
      name: prop(d, 'name'),
      model: prop(d, 'marketingName') || prop(d, 'productType'),
      osVersion: prop(d, 'osVersionNumber'),
      pairingState: prop(d, 'pairingState'),
      tunnelState: prop(d, 'tunnelState'),
    }));
}

/**
 * The udid of the test iPhone: `QARIAH_IPHONE_UDID` when set, else the only paired physical
 * iPhone. Two or more paired iPhones without the variable is an error: the driver must never
 * guess, because the owner's own iPhone gets TestFlight builds only.
 */
export function resolveUdid() {
  if (process.env.QARIAH_IPHONE_UDID) return process.env.QARIAH_IPHONE_UDID;
  const phones = listPhones().filter(p => p.pairingState === 'paired');
  if (phones.length === 1) return phones[0].udid;
  if (phones.length === 0)
    throw new Error('no paired physical iPhone is attached');
  throw new Error(
    `${phones.length} paired iPhones are attached; set QARIAH_IPHONE_UDID to the test iPhone`,
  );
}

/** Device details: developer mode, tunnel address, OS version. */
export function details(udid) {
  const d = devicectlJson(['device', 'info', 'details', '--device', udid]);
  return {
    udid,
    osVersion: prop(d, 'osVersionNumber'),
    developerMode: prop(d, 'developerModeStatus'),
    pairingState: prop(d, 'pairingState'),
    tunnelState: prop(d, 'tunnelState'),
    tunnelIPAddress: prop(d, 'tunnelIPAddress'),
  };
}

/** The base URL of WebDriverAgent on the phone, through the CoreDevice tunnel. */
export function wdaBaseUrl(
  udid,
  port = Number(process.env.QARIAH_WDA_PORT || 8100),
) {
  if (process.env.QARIAH_WDA_URL)
    return process.env.QARIAH_WDA_URL.replace(/\/$/, '');
  const d = details(udid);
  if (!d.tunnelIPAddress)
    throw new Error(`no CoreDevice tunnel to ${udid} (state ${d.tunnelState})`);
  const host = d.tunnelIPAddress.includes(':')
    ? `[${d.tunnelIPAddress}]`
    : d.tunnelIPAddress;
  return `http://${host}:${port}`;
}

export function installApp(udid, appPath) {
  return devicectlJson(
    ['device', 'install', 'app', '--device', udid, appPath],
    {
      timeoutMs: 300000,
    },
  );
}

export function uninstallApp(udid, bundleId) {
  try {
    devicectlJson(['device', 'uninstall', 'app', '--device', udid, bundleId]);
    return true;
  } catch (err) {
    if (/not installed|could not be found|No such/i.test(err.message))
      return false;
    throw err;
  }
}

/** The installed version of an app, or null. */
export function installedApp(udid, bundleId) {
  const res = devicectlJson([
    'device',
    'info',
    'apps',
    '--device',
    udid,
    '--bundle-id',
    bundleId,
  ]);
  const app = (res.apps || [])[0];
  return app
    ? {bundleId, version: app.version, build: app.bundleVersion, url: app.url}
    : null;
}

export function launchApp(udid, bundleId, {terminateExisting = true} = {}) {
  const args = ['device', 'process', 'launch', '--device', udid];
  if (terminateExisting) args.push('--terminate-existing');
  args.push(bundleId);
  return devicectlJson(args);
}

/** True when a process of the app runs on the phone. */
export function isRunning(udid, executableName) {
  const res = devicectlJson(['device', 'info', 'processes', '--device', udid]);
  return (res.runningProcesses || []).some(p =>
    String(p.executable || '').endsWith(`/${executableName}`),
  );
}

export function screenshotTo(udid, destination) {
  execFileSync(
    'xcrun',
    [
      'devicectl',
      'device',
      'capture',
      'screenshot',
      '--device',
      udid,
      '--destination',
      destination,
    ],
    {stdio: 'ignore', timeout: 60000},
  );
  return destination;
}

/** The names of the crash logs of an app on the phone. */
export function crashLogs(udid, match = 'Qariah') {
  const res = devicectlJson([
    'device',
    'info',
    'files',
    '--device',
    udid,
    '--domain-type',
    'systemCrashLogs',
  ]);
  return (res.files || [])
    .map(f => f.relativePath || f.name || '')
    .filter(name => name.includes(match));
}
