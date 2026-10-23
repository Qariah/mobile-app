// Runs a `.maestro` flow on the test iPhone through WebDriverAgent (TECH_DEBT #299).
//
// Maestro does not support a physical iPhone. This runner reads the same YAML and runs the
// commands that the Qariah flows use, with Maestro's meaning:
//   - text selectors are full-match, case-insensitive regular expressions;
//   - `tapOn`, `assertVisible` and `assertNotVisible` wait for the element (default 15 s);
//   - `runFlow` with `when` runs only when its condition is true now (no wait);
//   - `launchApp: { clearState: true }` uninstalls and installs the app again (a physical
//     phone has no "clear data"), so the app starts with no data and no permissions.
// A command that the runner does not know stops the flow with an "unsupported" error, so a
// flow never passes by a silent skip.

import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve, join, basename} from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {
  findOne,
  describeScreen,
  resolvePoint,
  center,
  normalizeSelector,
  coveringOverlay,
} from './hierarchy.mjs';
import {installApp, uninstallApp, installedApp} from './device.mjs';
import {IOS_BUNDLE_ID} from '../../lib/app-ids.mjs';

const require = createRequire(import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEFAULT_WAIT_MS = 15000;
const DEFAULT_SETTLE_MS = 700;

export class FlowError extends Error {}

/** Parses a flow file: an optional config document, then the command list. */
export function parseFlow(text) {
  let yaml;
  try {
    yaml = require('js-yaml');
  } catch {
    throw new FlowError(
      'js-yaml is not installed; run npm ci in the repository',
    );
  }
  const docs = yaml.loadAll(text).filter(d => d != null);
  if (docs.length === 0) return {config: {}, commands: []};
  if (docs.length === 1) {
    return Array.isArray(docs[0])
      ? {config: {}, commands: docs[0]}
      : {config: docs[0], commands: []};
  }
  return {config: docs[0] || {}, commands: docs[1] || []};
}

/** One command as [name, args]. A bare string such as `- hideKeyboard` has args null. */
export function commandOf(entry) {
  if (typeof entry === 'string') return [entry, null];
  const keys = Object.keys(entry || {});
  if (keys.length !== 1)
    throw new FlowError(
      `a command must have one key: ${JSON.stringify(entry)}`,
    );
  return [keys[0], entry[keys[0]]];
}

export class FlowRunner {
  /**
   * @param {object} opts
   * @param {import('./wda.mjs').Wda} opts.wda
   * @param {string} opts.udid
   * @param {string} opts.outDir     evidence directory (screenshots, log)
   * @param {string} [opts.appPath]  the .app to install for `clearState`
   * @param {string} [opts.bundleId]
   */
  constructor({
    wda,
    udid,
    outDir,
    appPath = null,
    bundleId = IOS_BUNDLE_ID,
    log = console.log,
  }) {
    this.wda = wda;
    this.udid = udid;
    this.outDir = outDir;
    this.appPath = appPath;
    this.bundleId = bundleId;
    this.log = log;
    this.shot = 0;
    this.scope = {output: {}, maestro: {copiedText: '', platform: 'ios'}};
  }

  // ---- script scope ----

  evalJs(code) {
    const ctx = vm.createContext({
      ...this.scope,
      console: {log: (...a) => this.log(`  [script] ${a.join(' ')}`)},
      json: s => JSON.parse(s),
    });
    return vm.runInContext(code, ctx, {timeout: 5000});
  }

  /** Replaces each `${expr}` in a string with its value (braces inside expr are balanced). */
  interpolate(value) {
    if (typeof value === 'string') {
      const parts = splitTemplate(value);
      if (parts.length === 1 && parts[0].expr !== undefined)
        return this.evalJs(parts[0].expr);
      return parts
        .map(p => (p.expr !== undefined ? String(this.evalJs(p.expr)) : p.text))
        .join('');
    }
    if (Array.isArray(value)) return value.map(v => this.interpolate(v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = k === 'commands' ? v : this.interpolate(v);
      }
      return out;
    }
    return value;
  }

  // ---- evidence ----

  async screenshot(label) {
    mkdirSync(this.outDir, {recursive: true});
    this.shot += 1;
    const file = join(
      this.outDir,
      `${String(this.shot).padStart(3, '0')}-${label.replace(/[^\w.-]+/g, '_').slice(0, 60)}.png`,
    );
    try {
      await this.wda.screenshot(file);
      return file;
    } catch (err) {
      this.log(`  screenshot failed: ${err.message}`);
      return null;
    }
  }

  // ---- selectors ----

  async isVisible(selector) {
    const sel = normalizeSelector(selector);
    const {nodes, screen} = await this.wda.snapshot();
    return Boolean(findOne(nodes, sel, screen));
  }

  async waitVisible(selector, {timeoutMs = DEFAULT_WAIT_MS, not = false} = {}) {
    const sel = normalizeSelector(selector);
    const end = Date.now() + timeoutMs;
    let snap;
    do {
      snap = await this.wda.snapshot();
      const hit = findOne(snap.nodes, sel, snap.screen);
      if (not ? !hit : hit) return {node: hit, ...snap};
      await sleep(300);
    } while (Date.now() < end);
    const err = new FlowError(
      `${not ? 'still visible' : 'not visible'} after ${timeoutMs} ms: ${JSON.stringify(sel)}`,
    );
    err.screen = describeScreen(snap.nodes, snap.screen);
    throw err;
  }

  async condition(when) {
    if (!when) return true;
    if (when.platform && String(when.platform).toLowerCase() !== 'ios')
      return false;
    if (when.true !== undefined) {
      const v = this.interpolate(when.true);
      if (!v || v === 'false') return false;
    }
    if (
      when.visible !== undefined &&
      !(await this.isVisible(this.interpolate(when.visible)))
    )
      return false;
    if (
      when.notVisible !== undefined &&
      (await this.isVisible(this.interpolate(when.notVisible)))
    )
      return false;
    return true;
  }

  // ---- app ----

  async clearState() {
    if (!this.appPath) {
      throw new FlowError(
        'clearState needs the .app to install again: pass --app <path> (or run `scripts/iphone.sh install <app>` once)',
      );
    }
    try {
      await this.wda.terminate(this.bundleId);
    } catch {
      // The app is not running.
    }
    uninstallApp(this.udid, this.bundleId);
    installApp(this.udid, this.appPath);
    const app = installedApp(this.udid, this.bundleId);
    if (!app)
      throw new FlowError(
        `the install of ${this.appPath} did not register ${this.bundleId}`,
      );
  }

  // ---- commands ----

  async run(file, {depth = 0} = {}) {
    const text = readFileSync(file, 'utf8');
    const {config, commands} = parseFlow(text);
    if (config.appId && depth === 0) this.bundleId = config.appId;
    await this.runCommands(commands || [], {file, depth});
  }

  async runCommands(commands, ctx) {
    for (const entry of commands) {
      const [name, rawArgs] = commandOf(entry);
      const optional =
        rawArgs && typeof rawArgs === 'object' && rawArgs.optional === true;
      const started = Date.now();
      const indent = '  '.repeat(ctx.depth + 1);
      try {
        await this.exec(name, rawArgs, ctx);
        if (!['runFlow', 'repeat'].includes(name)) {
          this.log(
            `${indent}✓ ${name} ${summary(rawArgs)} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
          );
        }
      } catch (err) {
        if (optional) {
          this.log(
            `${indent}~ ${name} ${summary(rawArgs)} — optional, skipped: ${err.message}`,
          );
          continue;
        }
        this.log(`${indent}✗ ${name} ${summary(rawArgs)}: ${err.message}`);
        if (!err.reported) {
          err.reported = true;
          err.command = `${name} ${summary(rawArgs)}`;
          err.flowFile = ctx.file;
          err.shotPath = await this.screenshot(`FAIL-${name}`);
          if (!err.screen) {
            try {
              const {nodes, screen} = await this.wda.snapshot();
              err.screen = describeScreen(nodes, screen);
            } catch {
              // The tree is not readable; the screenshot is the evidence.
            }
          }
        }
        throw err;
      }
    }
  }

  async exec(name, rawArgs, ctx) {
    const args =
      name === 'runFlow' || name === 'repeat'
        ? rawArgs
        : this.interpolate(rawArgs);
    switch (name) {
      case 'launchApp': {
        const a = args || {};
        if (a.clearState) await this.clearState();
        else if (a.stopApp === false) {
          // Maestro keeps a running app as it is. XCUITest `launch` would start it again,
          // so bring the running app to the front instead.
          await this.wda.activate(a.appId || this.bundleId);
          await sleep(1500);
          return;
        } else await this.wda.terminate(this.bundleId).catch(() => null);
        await this.wda.launch(
          a.appId || this.bundleId,
          a.arguments
            ? Object.entries(a.arguments).map(([k, v]) => `-${k}=${v}`)
            : [],
        );
        await sleep(1500);
        return;
      }
      case 'stopApp':
        await this.wda.terminate(args || this.bundleId);
        return;
      case 'tapOn':
      case 'longPressOn': {
        const sel = normalizeSelector(args);
        const {nodes, screen} = await this.wda.snapshot();
        let point;
        let node = null;
        if (sel.point && sel.text == null && sel.id == null) {
          point = resolvePoint(sel.point, screen);
        } else {
          node =
            findOne(nodes, sel, screen) ||
            (
              await this.waitVisible(sel, {
                timeoutMs: sel.timeout ?? DEFAULT_WAIT_MS,
              })
            ).node;
          // Maestro taps only on a settled screen. A list can still move after a scroll,
          // and a tap then lands on another row: wait until the element keeps its place.
          node = await this.settledNode(sel, node);
          // An element under the tab bar or the mini player: scroll it into the open area.
          for (let i = 0; i < 3; i += 1) {
            const snap = await this.wda.snapshot();
            const now = findOne(snap.nodes, sel, snap.screen) || node;
            if (!coveringOverlay(now, snap.nodes)) {
              node = now;
              break;
            }
            await this.centerOn(now, snap.screen);
            node = await this.settledNode(sel, now);
          }
          point = center(node.rect);
        }
        const settleMs = Math.min(
          Number(sel.waitToSettleTimeoutMs ?? DEFAULT_SETTLE_MS),
          3000,
        );
        const press = async () => {
          if (name === 'longPressOn')
            await this.wda.longPress(point.x, point.y, 1.0);
          else if (node) await this.wda.tapNode(node);
          else await this.wda.tapPoint(point.x, point.y);
        };
        // As Maestro's `retryTapIfNoChange` (default on): when the screen does not change
        // after a tap, tap once more. A tap during a sheet animation can be lost.
        const before =
          sel.retryTapIfNoChange === false
            ? null
            : screenSignature(nodes, screen);
        await press();
        await sleep(settleMs);
        if (before !== null && !node?.alertButton) {
          const after = await this.wda.snapshot();
          let unchanged = screenSignature(after.nodes, after.screen) === before;
          if (unchanged) {
            // A slow transition can still be on its way: look once more before a second tap.
            await sleep(800);
            const again = await this.wda.snapshot();
            unchanged = screenSignature(again.nodes, again.screen) === before;
          }
          if (unchanged) {
            this.log(`      (no change after the tap; tap again)`);
            await press();
            await sleep(settleMs);
          }
        }
        return;
      }
      case 'assertVisible':
        await this.waitVisible(args, {timeoutMs: DEFAULT_WAIT_MS});
        return;
      case 'assertNotVisible':
        await this.waitVisible(args, {timeoutMs: DEFAULT_WAIT_MS, not: true});
        return;
      case 'extendedWaitUntil': {
        const timeoutMs = Number(args.timeout ?? DEFAULT_WAIT_MS);
        if (args.visible !== undefined)
          await this.waitVisible(args.visible, {timeoutMs});
        else if (args.notVisible !== undefined)
          await this.waitVisible(args.notVisible, {timeoutMs, not: true});
        else
          throw new FlowError('extendedWaitUntil needs visible or notVisible');
        return;
      }
      case 'runFlow': {
        const a = typeof args === 'string' ? {file: args} : args || {};
        if (!(await this.condition(a.when))) {
          this.log(
            `${'  '.repeat(ctx.depth + 1)}· runFlow skipped (${summary(a.when)})`,
          );
          return;
        }
        if (a.env) Object.assign(this.scope, this.interpolate(a.env));
        if (a.file) {
          const target = resolve(dirname(ctx.file), this.interpolate(a.file));
          this.log(
            `${'  '.repeat(ctx.depth + 1)}▶ runFlow ${basename(target)}`,
          );
          const {commands} = parseFlow(readFileSync(target, 'utf8'));
          await this.runCommands(commands || [], {
            file: target,
            depth: ctx.depth + 1,
          });
        } else {
          await this.runCommands(a.commands || [], {
            ...ctx,
            depth: ctx.depth + 1,
          });
        }
        return;
      }
      case 'repeat': {
        const a = args || {};
        const times =
          a.times != null ? Number(this.interpolate(a.times)) : Infinity;
        if (times === Infinity && !a.while)
          throw new FlowError('repeat needs times or while');
        for (let i = 0; i < times; i += 1) {
          if (a.while && !(await this.condition(a.while))) break;
          await this.runCommands(a.commands || [], {
            ...ctx,
            depth: ctx.depth + 1,
          });
        }
        return;
      }
      case 'inputText':
        await this.wda.type(String(args));
        return;
      case 'eraseText': {
        const n =
          typeof args === 'number'
            ? args
            : Number(args?.charactersToErase ?? 50);
        await this.wda.eraseText(n);
        return;
      }
      case 'hideKeyboard':
        await this.wda.hideKeyboard();
        return;
      case 'scroll':
        await this.swipeDirection('DOWN');
        return;
      case 'swipe': {
        const a = args || {};
        if (a.direction)
          return this.swipeDirection(String(a.direction).toUpperCase());
        const {screen} = await this.wda.snapshot({alerts: false});
        await this.wda.swipe(
          resolvePoint(a.start, screen),
          resolvePoint(a.end, screen),
          (a.duration ?? 300) / 1000,
        );
        return;
      }
      case 'scrollUntilVisible': {
        const a = args || {};
        const sel = normalizeSelector(a.element);
        const direction = String(a.direction || 'DOWN').toUpperCase();
        const end = Date.now() + Number(a.timeout ?? 20000);
        let lastCenterY = null;
        for (;;) {
          const {nodes, screen} = await this.wda.snapshot();
          const node = findOne(nodes, sel, screen);
          if (node && (!a.centerElement || nearCenter(node, screen))) return;
          // Centering is best effort (as in Maestro): at the end of a list the element
          // cannot move to the middle. When a centering swipe does not move it, accept it.
          if (node && a.centerElement) {
            const y = center(node.rect).y;
            if (lastCenterY !== null && Math.abs(y - lastCenterY) < 2) return;
            lastCenterY = y;
          }
          if (Date.now() > end) {
            const err = new FlowError(
              `not visible after scrolling: ${JSON.stringify(sel)}`,
            );
            err.screen = describeScreen(nodes, screen);
            throw err;
          }
          if (node && a.centerElement) await this.centerOn(node, screen);
          else await this.swipeDirection(direction, screen);
        }
      }
      case 'waitForAnimationToEnd':
        await this.waitStable(Number(args?.timeout ?? 5000));
        return;
      case 'copyTextFrom': {
        const {node} = await this.waitVisible(args, {
          timeoutMs: DEFAULT_WAIT_MS,
        });
        this.scope.maestro.copiedText = node.label || node.value || node.name;
        return;
      }
      case 'evalScript':
        // `args` is already interpolated: `${...}` ran the script.
        return;
      case 'runScript': {
        const a = typeof args === 'string' ? {file: args} : args;
        if (a.env) Object.assign(this.scope, a.env);
        this.evalJs(readFileSync(resolve(dirname(ctx.file), a.file), 'utf8'));
        return;
      }
      case 'assertTrue': {
        const v =
          typeof args === 'object' && args !== null ? args.condition : args;
        if (!v || v === 'false')
          throw new FlowError(
            `assertTrue is false (${JSON.stringify(rawArgs)})`,
          );
        return;
      }
      case 'takeScreenshot':
        await this.screenshot(
          typeof args === 'string' ? args : args?.path || 'screenshot',
        );
        return;
      case 'openLink':
        await this.wda.openUrl(typeof args === 'string' ? args : args.link);
        await sleep(1500);
        return;
      case 'pressKey': {
        const key = String(args).toLowerCase();
        if (key === 'home') await this.wda.home();
        else if (key === 'lock') await this.wda.lock();
        else if (key === 'enter') await this.wda.type('\n');
        else
          throw new FlowError(
            `pressKey ${args} is not supported on the iPhone`,
          );
        return;
      }
      case 'setOrientation': {
        const map = {
          PORTRAIT: 'PORTRAIT',
          LANDSCAPE_LEFT: 'LANDSCAPE',
          LANDSCAPE_RIGHT: 'UIA_DEVICE_ORIENTATION_LANDSCAPERIGHT',
        };
        const value =
          map[String(args).toUpperCase()] || String(args).toUpperCase();
        await this.wda.orientation(value);
        await sleep(1500);
        return;
      }
      case 'back':
        throw new FlowError('back is an Android command; iOS has no back key');
      default:
        throw new FlowError(
          `unsupported command "${name}" on the iPhone runner`,
        );
    }
  }

  /** Re-reads the element until its rect is the same twice (at most about 3 s). */
  async settledNode(sel, node) {
    let last = node;
    for (let i = 0; i < 10; i += 1) {
      await sleep(250);
      const {nodes, screen} = await this.wda.snapshot();
      const now = findOne(nodes, sel, screen);
      // The element left the screen while it settled: wait for it again, never tap a stale rect.
      if (!now)
        return (await this.waitVisible(sel, {timeoutMs: DEFAULT_WAIT_MS})).node;
      const same =
        Math.abs(now.rect.x - last.rect.x) < 1 &&
        Math.abs(now.rect.y - last.rect.y) < 1;
      last = now;
      if (same) return now;
    }
    return last;
  }

  async swipeDirection(direction, screen) {
    const s = screen || (await this.wda.snapshot({alerts: false})).screen;
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    const dy = s.height * 0.3;
    const dx = s.width * 0.35;
    // DOWN scrolls the content down: the finger moves up.
    const moves = {
      DOWN: [
        {x: cx, y: cy + dy},
        {x: cx, y: cy - dy},
      ],
      UP: [
        {x: cx, y: cy - dy},
        {x: cx, y: cy + dy},
      ],
      RIGHT: [
        {x: cx + dx, y: cy},
        {x: cx - dx, y: cy},
      ],
      LEFT: [
        {x: cx - dx, y: cy},
        {x: cx + dx, y: cy},
      ],
    };
    const m = moves[direction];
    if (!m) throw new FlowError(`unknown direction ${direction}`);
    await this.wda.swipe(m[0], m[1], 0.25);
    await sleep(600);
  }

  async centerOn(node, screen) {
    const c = center(node.rect);
    const target = screen.y + screen.height / 2;
    const delta = Math.max(
      -screen.height * 0.35,
      Math.min(screen.height * 0.35, c.y - target),
    );
    const x = screen.x + screen.width / 2;
    await this.wda.swipe(
      {x, y: target + delta / 2},
      {x, y: target - delta / 2},
      0.4,
    );
    await sleep(600);
  }

  async waitStable(timeoutMs) {
    const end = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < end) {
      const {nodes, screen} = await this.wda.snapshot({alerts: false});
      const sig = screenSignature(nodes, screen);
      if (sig === last) return;
      last = sig;
      await sleep(300);
    }
  }
}

/** Splits "a ${b} c" into text and expression parts; an expression may contain braces. */
export function splitTemplate(str) {
  const parts = [];
  let i = 0;
  let text = '';
  while (i < str.length) {
    if (str[i] === '$' && str[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < str.length && depth > 0) {
        if (str[j] === '{') depth += 1;
        else if (str[j] === '}') depth -= 1;
        j += 1;
      }
      if (depth !== 0) {
        text += str.slice(i);
        break;
      }
      if (text) parts.push({text});
      text = '';
      parts.push({expr: str.slice(i + 2, j - 1)});
      i = j;
    } else {
      text += str[i];
      i += 1;
    }
  }
  if (text || parts.length === 0) parts.push({text});
  return parts;
}

/** The screen tree as text, without the clocks and the percentages of a playing player. */
function screenSignature(nodes, screen) {
  return describeScreen(nodes, screen, 300)
    .split('\n')
    .filter(line => !/\d+:\d{2}|value=\d+%/.test(line))
    .join('\n');
}

function nearCenter(node, screen) {
  const c = center(node.rect);
  return Math.abs(c.y - (screen.y + screen.height / 2)) < screen.height * 0.25;
}

function summary(args) {
  if (args == null) return '';
  const s = typeof args === 'string' ? `"${args}"` : JSON.stringify(args);
  return s.length > 90 ? `${s.slice(0, 87)}...` : s;
}

/** Runs one flow file and writes `result.json`; returns { status, ... }. */
export async function runFlowFile({
  wda,
  udid,
  file,
  outDir,
  appPath,
  log = console.log,
}) {
  const runner = new FlowRunner({wda, udid, outDir, appPath, log});
  const started = Date.now();
  let status = 'PASS';
  let failure = null;
  log(`▶ ${file}`);
  try {
    await runner.run(file);
    await runner.screenshot('PASS-end');
  } catch (err) {
    status = 'FAIL';
    failure = {
      message: err.message,
      command: err.command,
      flow: err.flowFile,
      screenshot: err.shotPath,
      screen: err.screen,
    };
    if (err.screen)
      log(`  screen at failure:\n${err.screen.replace(/^/gm, '    ')}`);
  }
  const result = {
    flow: file,
    status,
    seconds: Math.round((Date.now() - started) / 1000),
    failure,
    outDir,
  };
  mkdirSync(outDir, {recursive: true});
  writeFileSync(
    join(outDir, 'result.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  log(`${status} ${basename(file)} (${result.seconds} s)`);
  return result;
}
