// WebDriverAgent client for the test iPhone driver (TECH_DEBT #299).
//
// WebDriverAgent is the XCUITest runner of Appium. It runs on the phone as a UI test, and it
// serves an HTTP API on port 8100. This client talks to it through the CoreDevice USB tunnel.
// It uses only Node built-ins (`fetch`).
//
// The client reads the screen tree once for each query and finds elements in Node
// (`hierarchy.mjs`), then taps by coordinates. This is the same model as Maestro, so the
// `.maestro` flows keep their meaning on the iPhone.

/* global AbortSignal -- the Node 18+ global, for the time limit of each WebDriverAgent call */
import {writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {
  flatten,
  screenOf,
  findOne,
  findAll,
  center,
  describeScreen,
  coveringOverlay,
} from './hierarchy.mjs';
import {wdaBaseUrl} from './device.mjs';
import {IOS_BUNDLE_ID} from '../../lib/app-ids.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class WdaError extends Error {}

export class Wda {
  constructor({
    udid,
    baseUrl,
    bundleId = IOS_BUNDLE_ID,
    log = () => undefined,
  } = {}) {
    this.udid = udid;
    this.baseUrl = baseUrl || null;
    this.bundleId = bundleId;
    this.sessionId = null;
    this.log = log;
  }

  url() {
    if (!this.baseUrl) this.baseUrl = wdaBaseUrl(this.udid);
    return this.baseUrl;
  }

  /** One HTTP call. A network error re-reads the tunnel address once (it changes on reconnect). */
  async call(method, path, body, {timeoutMs = 60000, retry = true} = {}) {
    const target = `${this.url()}${path}`;
    let res;
    try {
      res = await fetch(target, {
        method,
        headers: body ? {'content-type': 'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (retry && !process.env.QARIAH_WDA_URL) {
        this.baseUrl = null;
        return this.call(method, path, body, {timeoutMs, retry: false});
      }
      throw new WdaError(
        `WebDriverAgent is not reachable at ${target}: ${err.cause?.code || err.message}`,
      );
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new WdaError(`${method} ${path}: HTTP ${res.status}, not JSON`);
    }
    if (!res.ok || json.value?.error) {
      const msg =
        json.value?.message || json.value?.error || `HTTP ${res.status}`;
      const err = new WdaError(
        `${method} ${path}: ${String(msg).split('\n')[0]}`,
      );
      err.status = res.status;
      err.wdaError = json.value?.error;
      throw err;
    }
    return json.value;
  }

  async status() {
    return this.call('GET', '/status', null, {timeoutMs: 10000});
  }

  /** Waits until WebDriverAgent answers /status. */
  async waitReady(timeoutMs = 120000) {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      try {
        return await this.status();
      } catch (err) {
        last = err;
        await sleep(2000);
      }
    }
    throw last || new WdaError('WebDriverAgent did not start');
  }

  /**
   * Starts a session. Without `bundleId` the session attaches to the app in front. The settings
   * turn off the waits for an idle app: a React Native app animates all the time, and the
   * default wait would block each call for seconds.
   */
  async startSession({bundleId = null} = {}) {
    const caps = {
      shouldWaitForQuiescence: false,
      shouldUseTestManagerForVisibilityDetection: false,
    };
    if (bundleId) caps.bundleId = bundleId;
    const value = await this.call('POST', '/session', {
      capabilities: {alwaysMatch: caps, firstMatch: [{}]},
    });
    this.sessionId = value.sessionId;
    await this.call('POST', `/session/${this.sessionId}/appium/settings`, {
      settings: {
        waitForIdleTimeout: 0,
        animationCoolOffTimeout: 0,
        snapshotMaxDepth: 60,
        useFirstMatch: false,
        reduceMotion: false,
      },
    }).catch(err => this.log(`settings not applied: ${err.message}`));
    return this.sessionId;
  }

  async ensureSession() {
    if (this.sessionId) return this.sessionId;
    return this.startSession();
  }

  async s(method, path, body, opts) {
    await this.ensureSession();
    try {
      return await this.call(
        method,
        `/session/${this.sessionId}${path}`,
        body,
        opts,
      );
    } catch (err) {
      if (/invalid session|Session does not exist/i.test(err.message)) {
        this.sessionId = null;
        await this.ensureSession();
        return this.call(
          method,
          `/session/${this.sessionId}${path}`,
          body,
          opts,
        );
      }
      throw err;
    }
  }

  // ---- screen ----

  /**
   * The flattened screen tree and the screen rect. A system alert (for example the notification
   * permission dialog) belongs to SpringBoard, not to the app, so it is not in the app's tree.
   * Its buttons are added as `AlertButton` elements, so that a flow can see and tap "Allow" the
   * same way on iOS as on Android.
   */
  async snapshot({alerts = true} = {}) {
    const raw = await this.call('GET', '/source?format=json', null, {
      timeoutMs: 60000,
    });
    const nodes = flatten(raw);
    const screen = screenOf(nodes);
    if (alerts) {
      const buttons = await this.alertButtons();
      buttons.forEach((label, i) => {
        nodes.push({
          type: 'AlertButton',
          id: '',
          name: label,
          label,
          value: '',
          enabled: true,
          visibleFlag: true,
          alertButton: label,
          // A stand-in rect on screen, in button order. A tap on it accepts the alert by name.
          rect: {
            x: screen.x + 10,
            y: screen.y + 10 + i * 50,
            width: 100,
            height: 44,
          },
        });
      });
    }
    return {nodes, screen};
  }

  async screenshot(path) {
    const b64 = await this.call('GET', '/screenshot', null, {timeoutMs: 60000});
    writeFileSync(path, Buffer.from(b64, 'base64'));
    return path;
  }

  async find(selector) {
    const {nodes, screen} = await this.snapshot();
    return {node: findOne(nodes, selector, screen), nodes, screen};
  }

  async findAll(selector) {
    const {nodes, screen} = await this.snapshot();
    return findAll(nodes, selector, screen);
  }

  /** Polls until the selector is on screen (or off screen with `{ not: true }`). */
  async waitFor(
    selector,
    {timeoutMs = 10000, not = false, intervalMs = 400} = {},
  ) {
    const end = Date.now() + timeoutMs;
    let last;
    do {
      last = await this.find(selector);
      if (not ? !last.node : last.node) return last;
      await sleep(intervalMs);
    } while (Date.now() < end);
    const err = new WdaError(
      `${not ? 'still visible' : 'not visible'} after ${timeoutMs} ms: ${JSON.stringify(selector)}`,
    );
    err.screen = describeScreen(last.nodes, last.screen);
    throw err;
  }

  /** The WebDriverAgent element id of an accessibility id, or null (a fast query). */
  async findIdFast(id) {
    try {
      const el = await this.s(
        'POST',
        '/element',
        {using: 'accessibility id', value: id},
        {timeoutMs: 10000},
      );
      return el?.ELEMENT || el?.['element-6066-11e4-a52e-4f735466cecf'] || null;
    } catch {
      return null;
    }
  }

  async clickElement(uuid) {
    return this.s('POST', `/element/${uuid}/click`, {});
  }

  // ---- input ----

  async tapPoint(x, y) {
    return this.s('POST', '/wda/tap', {x, y});
  }

  async tap(selector, opts = {}) {
    let {node, nodes, screen} = await this.waitFor(selector, opts);
    // An element under the tab bar or the mini player: scroll it into the open area first.
    for (let i = 0; i < 3 && coveringOverlay(node, nodes); i += 1) {
      const target = screen.y + screen.height * 0.4;
      const dy = Math.min(center(node.rect).y - target, screen.height * 0.4);
      const x = screen.x + screen.width / 2;
      await this.swipe({x, y: target + dy}, {x, y: target}, 0.3);
      await new Promise(r => setTimeout(r, 700));
      ({node, nodes, screen} = await this.waitFor(selector, opts));
    }
    await this.tapNode(node);
    return node;
  }

  /** Taps an element of a snapshot; an alert button is pressed by name. */
  async tapNode(node) {
    if (node.alertButton) return this.alertAccept(node.alertButton);
    const p = center(node.rect);
    return this.tapPoint(p.x, p.y);
  }

  async longPress(x, y, durationSec = 1.0) {
    return this.s('POST', '/wda/touchAndHold', {x, y, duration: durationSec});
  }

  async swipe(from, to, durationSec = 0.3) {
    return this.s('POST', '/wda/dragfromtoforduration', {
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      duration: durationSec,
    });
  }

  /**
   * Types text into the element that has the keyboard focus. It waits for the keyboard first,
   * and it types at 15 keys a second: keys typed while the keyboard moves in are lost (on the
   * test iPhone "Walrus" became "Wrus" and "Pelican" became "Plican").
   */
  async type(text, {frequency = 15} = {}) {
    await this.waitKeyboard();
    return this.s('POST', '/wda/keys', {value: [...String(text)], frequency});
  }

  /** Waits until a keyboard is on screen and has stopped moving. False after the time limit. */
  async waitKeyboard(timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    do {
      try {
        await this.s(
          'POST',
          '/element',
          {using: 'class name', value: 'XCUIElementTypeKeyboard'},
          {timeoutMs: 5000},
        );
        await sleep(400);
        return true;
      } catch {
        // No keyboard yet.
      }
      await sleep(200);
    } while (Date.now() < end);
    return false;
  }

  async eraseText(count = 50) {
    return this.s('POST', '/wda/keys', {value: Array(count).fill('\b')});
  }

  async hideKeyboard() {
    return this.s('POST', '/wda/keyboard/dismiss', {}).catch(() => null);
  }

  // ---- device and apps ----

  async home() {
    return this.call('POST', '/wda/homescreen', {});
  }

  async lock() {
    return this.call('POST', '/wda/lock', {});
  }

  async unlock() {
    return this.call('POST', '/wda/unlock', {});
  }

  async isLocked() {
    return this.call('GET', '/wda/locked', null);
  }

  async launch(bundleId = this.bundleId, args = []) {
    return this.s('POST', '/wda/apps/launch', {bundleId, arguments: args});
  }

  async activate(bundleId = this.bundleId) {
    return this.s('POST', '/wda/apps/activate', {bundleId});
  }

  async terminate(bundleId = this.bundleId) {
    return this.s('POST', '/wda/apps/terminate', {bundleId});
  }

  /** 1 not installed, 2 background suspended, 3 background running, 4 foreground. */
  async appState(bundleId = this.bundleId) {
    return this.s('POST', '/wda/apps/state', {bundleId});
  }

  /** Sets WebDriverAgent settings (for example the MJPEG stream rate and size). */
  async settings(values) {
    return this.s('POST', '/appium/settings', {settings: values});
  }

  /** The URL of the MJPEG screen stream (port 9100) through the same tunnel. */
  mjpegUrl(port = Number(process.env.QARIAH_WDA_MJPEG_PORT || 9100)) {
    return this.url().replace(/:\d+$/, `:${port}`);
  }

  async orientation(value) {
    if (value == null) return this.s('GET', '/orientation');
    return this.s('POST', '/orientation', {orientation: value});
  }

  async openUrl(url) {
    return this.s('POST', '/url', {url});
  }

  // ---- system alerts ----

  async alertText() {
    try {
      return await this.s('GET', '/alert/text');
    } catch (err) {
      if (err.status === 404 || /no alert/i.test(err.message)) return null;
      throw err;
    }
  }

  async alertButtons() {
    try {
      const value = await this.s('GET', '/wda/alert/buttons');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  async alertAccept(name) {
    return this.s('POST', '/alert/accept', name ? {name} : {});
  }

  async alertDismiss(name) {
    return this.s('POST', '/alert/dismiss', name ? {name} : {});
  }
}
