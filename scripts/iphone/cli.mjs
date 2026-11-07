#!/usr/bin/env node
// The command line of the test iPhone driver (TECH_DEBT #299). `scripts/iphone.sh` calls it.
// It is the iPhone peer of the `adb shell input …` / `screencap` / `uiautomator dump` commands.
//
//   scripts/iphone.sh status                     WebDriverAgent and device state
//   scripts/iphone.sh install <Qariah.app>       install a build; clearState reinstalls it
//   scripts/iphone.sh launch | terminate | uninstall
//   scripts/iphone.sh tap "<text regex>"         tap by visible text (full-match, as Maestro)
//   scripts/iphone.sh tap --id <testID> [--index n]
//   scripts/iphone.sh tap --point 50%,32%
//   scripts/iphone.sh longpress "<text>" | --id <testID>
//   scripts/iphone.sh type "<text>" | erase [n] | hidekeyboard
//   scripts/iphone.sh swipe up|down|left|right   (down = scroll the content down)
//   scripts/iphone.sh visible "<text>" | --id <testID>      exit 0 when on screen, else 1
//   scripts/iphone.sh wait "<text>" [--timeout ms] [--not]
//   scripts/iphone.sh tree [--all]               the visible elements (type, id, label, value)
//   scripts/iphone.sh screenshot <file.png>
//   scripts/iphone.sh a11y <file.png>            screenshot with a box on each VoiceOver element
//   scripts/iphone.sh record <dir> [--seconds 5] [--fps 30]   frames of the screen + a contact sheet
//   scripts/iphone.sh home | lock | unlock
//   scripts/iphone.sh alert                      the system alert text and buttons, if any
//   scripts/iphone.sh alert accept|dismiss ["<button>"]
//   scripts/iphone.sh orientation [portrait|landscape]
//   scripts/iphone.sh open <url>                 open a link (deep link) on the phone
//   scripts/iphone.sh crashlogs                  the Qariah crash logs on the phone
//
// Environment: QARIAH_IPHONE_UDID (default: the only paired physical iPhone),
// QARIAH_IPHONE_DRIVER_HOME (default: ~/Library/Caches/qariah-iphone-driver).

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Wda} from './lib/wda.mjs';
import {
  resolveUdid,
  details,
  installApp,
  uninstallApp,
  installedApp,
  crashLogs,
} from './lib/device.mjs';
import {
  describeScreen,
  resolvePoint,
  center,
  findOne,
  isOnScreen,
} from './lib/hierarchy.mjs';
import {IOS_BUNDLE_ID} from '../lib/app-ids.mjs';

const CACHE =
  process.env.QARIAH_IPHONE_DRIVER_HOME ||
  join(homedir(), 'Library/Caches/qariah-iphone-driver');
const LAST_APP = join(CACHE, 'last-app.json');
const BUNDLE_ID = process.env.QARIAH_IPHONE_BUNDLE_ID || IOS_BUNDLE_ID;

/** The .app that `install` recorded, for a later clearState. */
export function lastApp() {
  try {
    return JSON.parse(readFileSync(LAST_APP, 'utf8')).appPath;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) opt[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--'))
        opt[k] = argv[(i += 1)];
      else opt[k] = true;
    } else pos.push(a);
  }
  return {pos, opt};
}

function selectorFrom(pos, opt) {
  const sel = {};
  if (opt.id) sel.id = opt.id;
  if (pos[0] !== undefined) sel.text = pos[0];
  if (opt.index !== undefined) sel.index = Number(opt.index);
  if (opt.point) sel.point = opt.point;
  if (!sel.id && sel.text === undefined && !sel.point)
    throw new Error('give a text, --id or --point');
  return sel;
}

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const {pos, opt} = parseArgs(rest);
  const udid = resolveUdid();
  const wda = new Wda({udid, bundleId: BUNDLE_ID});

  switch (verb) {
    case 'status': {
      const d = details(udid);
      let w = null;
      try {
        w = await wda.status();
      } catch (err) {
        w = {error: err.message};
      }
      const app = installedApp(udid, BUNDLE_ID);
      console.log(
        JSON.stringify(
          {
            device: d,
            wda: w.error
              ? w
              : {version: w.build?.version, ready: w.ready, url: wda.url()},
            app,
            lastApp: lastApp(),
          },
          null,
          2,
        ),
      );
      return;
    }
    case 'install': {
      const appPath = resolve(pos[0] || '');
      if (!pos[0] || !existsSync(join(appPath, 'Info.plist')))
        throw new Error('give the path of a built Qariah.app');
      installApp(udid, appPath);
      mkdirSync(CACHE, {recursive: true});
      writeFileSync(
        LAST_APP,
        `${JSON.stringify({appPath, installedAt: new Date().toISOString()}, null, 2)}\n`,
      );
      console.log(JSON.stringify(installedApp(udid, BUNDLE_ID)));
      return;
    }
    case 'uninstall':
      console.log(
        uninstallApp(udid, BUNDLE_ID) ? 'uninstalled' : 'not installed',
      );
      return;
    case 'launch':
      await wda.launch(BUNDLE_ID);
      return;
    case 'terminate':
      await wda.terminate(BUNDLE_ID);
      return;
    case 'tap':
    case 'longpress': {
      const sel = selectorFrom(pos, opt);
      const timeoutMs = Number(opt.timeout ?? 10000);
      if (sel.point && sel.text === undefined && !sel.id) {
        const {screen} = await wda.snapshot({alerts: false});
        const point = resolvePoint(sel.point, screen);
        if (verb === 'longpress')
          await wda.longPress(point.x, point.y, Number(opt.duration ?? 1));
        else await wda.tapPoint(point.x, point.y);
        console.log(`point ${point.x},${point.y}`);
        return;
      }
      if (verb === 'tap') {
        // wda.tap scrolls an element out from under the tab bar or the mini player.
        const node = await wda.tap(sel, {timeoutMs});
        console.log(
          `${node.type} ${node.id ? `id=${node.id} ` : ''}"${node.label}"`,
        );
        return;
      }
      const {node} = await wda.waitFor(sel, {timeoutMs});
      const p = center(node.rect);
      await wda.longPress(p.x, p.y, Number(opt.duration ?? 1));
      console.log(
        `${node.type} ${node.id ? `id=${node.id} ` : ''}"${node.label}"`,
      );
      return;
    }
    case 'type':
      await wda.type(pos.join(' '));
      return;
    case 'erase':
      await wda.eraseText(Number(pos[0] ?? 50));
      return;
    case 'hidekeyboard':
      await wda.hideKeyboard();
      return;
    case 'swipe': {
      const dir = String(pos[0] || 'down').toUpperCase();
      const {screen} = await wda.snapshot({alerts: false});
      const cx = screen.width / 2;
      const cy = screen.height / 2;
      const dy = screen.height * 0.3;
      const dx = screen.width * 0.35;
      const m = {
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
      }[dir];
      if (!m) throw new Error('swipe up|down|left|right');
      await wda.swipe(m[0], m[1], 0.25);
      return;
    }
    case 'visible': {
      const {nodes, screen} = await wda.snapshot();
      const hit = findOne(nodes, selectorFrom(pos, opt), screen);
      console.log(hit ? `visible: ${hit.type} "${hit.label}"` : 'not visible');
      process.exitCode = hit ? 0 : 1;
      return;
    }
    case 'wait':
      await wda.waitFor(selectorFrom(pos, opt), {
        timeoutMs: Number(opt.timeout ?? 15000),
        not: Boolean(opt.not),
      });
      console.log('ok');
      return;
    case 'tree': {
      const {nodes, screen} = await wda.snapshot();
      console.log(describeScreen(nodes, screen, opt.all ? 2000 : 120));
      return;
    }
    case 'screenshot': {
      const file = resolve(pos[0] || `iphone-${Date.now()}.png`);
      await wda.screenshot(file);
      console.log(file);
      return;
    }
    case 'record': {
      // Records the screen through the WebDriverAgent MJPEG stream (devicectl cannot record
      // this phone). Writes one JPEG for each frame and a contact sheet, for a frame count
      // such as the rotation check of QP-10. Needs ffmpeg (and ImageMagick for the sheet).
      const dir = resolve(pos[0] || `iphone-record-${Date.now()}`);
      const seconds = Number(opt.seconds ?? 5);
      const fps = Number(opt.fps ?? 30);
      mkdirSync(dir, {recursive: true});
      await wda.settings({
        mjpegServerFramerate: fps,
        mjpegScalingFactor: Number(opt.scale ?? 50),
        mjpegServerScreenshotQuality: 60,
      });
      execFileSync(
        'ffmpeg',
        [
          '-loglevel',
          'error',
          '-f',
          'mjpeg',
          '-i',
          wda.mjpegUrl(),
          '-t',
          String(seconds),
          '-fps_mode',
          'passthrough',
          '-q:v',
          '3',
          join(dir, 'frame-%04d.jpg'),
        ],
        {stdio: 'inherit', timeout: (seconds + 30) * 1000},
      );
      const frames = readdirSync(dir)
        .filter(f => /^frame-\d+\.jpg$/.test(f))
        .sort();
      if (opt.sheet !== 'false' && frames.length > 0) {
        execFileSync('magick', [
          'montage',
          ...frames.map(f => join(dir, f)),
          '-tile',
          '10x',
          '-geometry',
          '+2+2',
          '-resize',
          '160x',
          join(dir, 'contact-sheet.jpg'),
        ]);
      }
      console.log(`${frames.length} frames in ${seconds} s → ${dir}`);
      return;
    }
    case 'a11y': {
      // A screenshot with a numbered box on each accessibility element (what VoiceOver can
      // focus), and the list of the elements. Needs ImageMagick (`magick`).
      const file = resolve(pos[0] || `iphone-a11y-${Date.now()}.png`);
      const raw = `${file}.raw.png`;
      await wda.screenshot(raw);
      const {nodes, screen} = await wda.snapshot({alerts: false});
      const els = nodes.filter(n => n.accessible && isOnScreen(n, screen));
      const size = execFileSync('magick', ['identify', '-format', '%w', raw], {
        encoding: 'utf8',
      });
      const k = Number(size) / screen.width;
      const colors = [
        '#ff3b30',
        '#34c759',
        '#0a84ff',
        '#ff9f0a',
        '#bf5af2',
        '#64d2ff',
      ];
      const draw = [];
      els.forEach((n, i) => {
        const c = colors[i % colors.length];
        const [x0, y0] = [Math.round(n.rect.x * k), Math.round(n.rect.y * k)];
        const [x1, y1] = [
          Math.round((n.rect.x + n.rect.width) * k) - 1,
          Math.round((n.rect.y + n.rect.height) * k) - 1,
        ];
        draw.push(
          '-fill',
          'none',
          '-stroke',
          c,
          '-strokewidth',
          '6',
          '-draw',
          `rectangle ${x0},${y0} ${x1},${y1}`,
        );
        draw.push(
          '-stroke',
          'none',
          '-fill',
          c,
          '-draw',
          `rectangle ${x0},${y0} ${x0 + 70},${y0 + 56}`,
        );
        draw.push(
          '-fill',
          'white',
          '-pointsize',
          '44',
          '-annotate',
          `+${x0 + 8}+${y0 + 46}`,
          String(i + 1),
        );
      });
      execFileSync('magick', [raw, ...draw, file]);
      unlinkSync(raw);
      els.forEach((n, i) =>
        console.log(
          `${String(i + 1).padStart(2)} ${n.type.replace(/^XCUIElementType/, '')} ${n.id ? `id=${n.id} ` : ''}"${n.label}"${n.value ? ` value=${n.value}` : ''}`,
        ),
      );
      console.log(file);
      return;
    }
    case 'home':
      await wda.home();
      return;
    case 'lock':
      await wda.lock();
      return;
    case 'unlock':
      await wda.unlock();
      return;
    case 'alert': {
      if (pos[0] === 'accept') await wda.alertAccept(pos[1]);
      else if (pos[0] === 'dismiss') await wda.alertDismiss(pos[1]);
      else
        console.log(
          JSON.stringify({
            text: await wda.alertText(),
            buttons: await wda.alertButtons(),
          }),
        );
      return;
    }
    case 'orientation': {
      if (!pos[0]) console.log(await wda.orientation());
      else
        await wda.orientation(
          pos[0].toUpperCase() === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT',
        );
      return;
    }
    case 'open':
      await wda.openUrl(pos[0]);
      return;
    case 'crashlogs':
      console.log(crashLogs(udid).join('\n') || '(none)');
      return;
    default:
      throw new Error(
        `unknown verb "${verb ?? ''}"; see the header of scripts/iphone/cli.mjs`,
      );
  }
}

// Run only as a command, not on an import (the tests import the helpers).
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`iphone: ${err.message}`);
    if (err.screen) console.error(err.screen);
    process.exit(1);
  });
}
