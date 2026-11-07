// Device cases that a `.maestro` flow cannot express on the test iPhone (TECH_DEBT #299):
// a lock for 60 s, the system media controls, a tap in the first second after a launch.
// `scripts/iphone-device-test.sh <CASE-ID>` runs one of these when the case has no flow.
//
// iOS blanks every screenshot of the locked screen, so these cases read the system media
// controls in Control Center (the Now Playing module). They use the same remote commands
// (MPRemoteCommandCenter) as the controls on the lock screen.

import {findOne} from './lib/hierarchy.mjs';
import {IOS_BUNDLE_ID} from '../lib/app-ids.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class CaseFail extends Error {}

function check(condition, message) {
  if (!condition) throw new CaseFail(message);
}

/** "2:18", "1:02:03" or "−57:17" → seconds (the sign is ignored). */
export function parseClock(text) {
  const m = String(text || '').match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return m[3] !== undefined
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    : Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Opens Control Center at its Now Playing page. Control Center opens at the page that was last
 * shown, and its pages scroll vertically, so the function swipes between pages in the middle of
 * the screen until the Now Playing module shows. It never taps on a page: the Connectivity page
 * has the Wi-Fi and Airplane Mode switches.
 */
async function openControlCenter(wda) {
  const {screen} = await wda.snapshot({alerts: false});
  await wda.swipe(
    {x: screen.width - 30, y: 5},
    {x: screen.width - 30, y: screen.height * 0.55},
    0.3,
  );
  await sleep(1500);
  // The page indicator on the right edge has one slot for each page. A tap on a slot shows
  // that page. Tap only the indicator, slot by slot, until the Now Playing page shows.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const {nodes, screen: cc} = await wda.snapshot({alerts: false});
    // The other pages are in the tree too: test only the elements on screen. Page 1 can
    // have a small Now Playing tile with no clock; the full module has the position slider.
    if (findOne(nodes, 'Track position', cc)) return;
    const pager = nodes.find(n => n.id === 'Page control');
    const m = String(pager?.value || '').match(/Page (\d+) of (\d+)/);
    if (!pager || !m)
      throw new CaseFail('Control Center has no page indicator');
    const count = Number(m[2]);
    const slot = (attempt % count) + 1;
    const {x, y, width, height} = pager.rect;
    const vertical = height >= width;
    await wda.tapPoint(
      vertical ? x + width / 2 : x + (width * (slot - 0.5)) / count,
      vertical ? y + (height * (slot - 0.5)) / count : y + height / 2,
    );
    await sleep(1000);
  }
  throw new CaseFail('the Now Playing page of Control Center did not show');
}

/** Closes Control Center with the Home command, then brings Qariah to the front again. */
async function closeControlCenter(wda) {
  await wda.home();
  await sleep(800);
  await wda.activate(IOS_BUNDLE_ID);
  await sleep(1200);
}

/** The Now Playing module: { title, elapsed (s), playing, node map }. */
async function nowPlaying(wda) {
  const {nodes, screen} = await wda.snapshot({alerts: false});
  const module = findOne(nodes, {id: 'Now Playing'}, screen);
  const pause = findOne(nodes, 'Pause', screen);
  const play = findOne(nodes, 'Play', screen);
  const clock = nodes.find(
    n => /StaticText$/.test(n.type) && /^\d+:\d{2}(:\d{2})?$/.test(n.label),
  );
  // The title is the first text inside the module's rect.
  const r = module?.rect;
  const title = r
    ? nodes.find(
        n =>
          /StaticText$/.test(n.type) &&
          n.label &&
          !/^[-\u200e\u2212]?\d+:\d{2}/.test(n.label) &&
          n.rect.x >= r.x &&
          n.rect.y >= r.y &&
          n.rect.x + n.rect.width <= r.x + r.width &&
          n.rect.y + n.rect.height <= r.y + r.height,
      )
    : null;
  return {
    present: Boolean(module),
    title: title && /StaticText$/.test(title.type) ? title.label : null,
    elapsed: clock ? parseClock(clock.label) : null,
    playing: Boolean(pause) && !play,
    pause,
    play,
  };
}

/** Scrolls the screen down, then up, until the selector is on screen. */
async function scrollTo(wda, selector, {maxSwipes = 6} = {}) {
  for (const dir of ['DOWN', 'UP']) {
    for (let i = 0; i <= maxSwipes; i += 1) {
      if ((await wda.find(selector)).node) return;
      const {screen} = await wda.snapshot({alerts: false});
      const x = screen.width / 2;
      const [y0, y1] = dir === 'DOWN' ? [0.7, 0.35] : [0.35, 0.7];
      await wda.swipe(
        {x, y: screen.height * y0},
        {x, y: screen.height * y1},
        0.3,
      );
      await sleep(800);
    }
  }
  throw new CaseFail(`not found after scrolling: ${selector}`);
}

/** Makes sure that a Qariah track plays and the app shows its mini player. */
async function ensurePlaying(ctx) {
  const {wda} = ctx;
  await wda.activate(IOS_BUNDLE_ID);
  await sleep(1500);
  // Close an open alert first (for example "Cache has been cleared." from QP-08): it
  // covers the tab bar and the mini player.
  for (let i = 0; i < 2; i += 1) {
    const buttons = await wda.alertButtons();
    if (buttons.length === 0) break;
    await wda.alertAccept(buttons.includes('OK') ? 'OK' : undefined);
    await sleep(800);
  }
  let {nodes, screen} = await wda.snapshot();
  // A pushed screen (for example the Mushaf reader) hides the tab bar: go back first.
  for (let i = 0; i < 3 && !(await wda.find('.*Listen')).node; i += 1) {
    const back =
      (await wda.find({id: 'BackButton'})).node ||
      (await wda.find('Back')).node;
    if (!back) break;
    await wda.tapNode(back);
    await sleep(1200);
  }
  ({nodes, screen} = await wda.snapshot());
  // An open full player hides the tab bar and the mini player: close it.
  const close = findOne(nodes, {id: 'player-close'}, screen);
  if (close) {
    await wda.tapNode(close);
    await sleep(1500);
    ({nodes, screen} = await wda.snapshot());
  }
  if (!findOne(nodes, {id: 'mini-player-play-pause'}, screen)) {
    await wda.tap('.*Listen', {timeoutMs: 10000});
    await sleep(1500);
    // The Listen tab keeps its scroll position: go back to its top.
    for (
      let i = 0;
      i < 3 && !(await wda.find({id: 'recitation-card'})).node;
      i += 1
    ) {
      const {screen: s2} = await wda.snapshot({alerts: false});
      await wda.swipe(
        {x: s2.width / 2, y: s2.height * 0.3},
        {x: s2.width / 2, y: s2.height * 0.8},
        0.25,
      );
      await sleep(800);
    }
    await wda.tap({id: 'recitation-card', index: 0}, {timeoutMs: 15000});
    await sleep(4000);
    const close = await wda.find('Close');
    if (close.node) await wda.tapNode(close.node);
    await sleep(1500);
    ({nodes, screen} = await wda.snapshot());
  }
  const button = findOne(nodes, {id: 'mini-player-play-pause'}, screen);
  check(button, 'no mini player after a play');
  if (button.label === 'Play') {
    await wda.tapNode(button);
    await sleep(2000);
  }
  await ctx.shot('playing');
}

export const CASES = {
  /** QP-06 → BGA-01, BGA-02: the audio continues while locked; the system controls work. */
  'QP-06': async ctx => {
    const {wda, log} = ctx;
    await ensurePlaying(ctx);
    await openControlCenter(wda);
    const before = await nowPlaying(wda);
    await ctx.shot('control-center-before-lock');
    check(
      before.present && before.playing,
      `Now Playing is not playing Qariah before the lock (${JSON.stringify(before.title)})`,
    );
    log(`  before the lock: "${before.title}" at ${before.elapsed} s, playing`);
    await closeControlCenter(wda);
    await wda.lock();
    log('  locked for 60 s');
    await sleep(60000);
    await wda.unlock();
    await sleep(1500);
    await openControlCenter(wda);
    const after = await nowPlaying(wda);
    await ctx.shot('control-center-after-60s-lock');
    log(`  after 60 s locked: at ${after.elapsed} s, playing=${after.playing}`);
    check(after.playing, 'the audio stopped while the phone was locked');
    // The track can end during the lock and the next one start (its clock restarts).
    const moved =
      after.title && before.title && after.title !== before.title
        ? true
        : after.elapsed != null &&
          before.elapsed != null &&
          after.elapsed - before.elapsed >= 50;
    check(
      moved,
      `the position moved ${after.elapsed - before.elapsed} s in 60 s (title ${before.title} → ${after.title})`,
    );
    // BGA-02: pause and play from the system controls.
    await wda.tapNode(after.pause);
    await sleep(2000);
    const paused1 = await nowPlaying(wda);
    await sleep(4000);
    const paused2 = await nowPlaying(wda);
    await ctx.shot('control-center-paused');
    check(
      !paused2.playing && paused2.elapsed === paused1.elapsed,
      `Pause did not stop the audio (${paused1.elapsed} → ${paused2.elapsed} s)`,
    );
    await wda.tapNode(paused2.play);
    await sleep(4000);
    const resumed = await nowPlaying(wda);
    await ctx.shot('control-center-resumed');
    check(
      resumed.playing && resumed.elapsed > paused2.elapsed,
      'Play did not resume the audio',
    );
    await closeControlCenter(wda);
    log(
      `  system Pause held the position at ${paused2.elapsed} s; Play resumed to ${resumed.elapsed} s`,
    );
  },

  /** QP-07 → PLY-04: after a force-quit, a tap on play in the first second starts the audio. */
  'QP-07': async ctx => {
    const {wda, log} = ctx;
    await ensurePlaying(ctx);
    const button = await wda.find({id: 'mini-player-play-pause'});
    if (button.node?.label === 'Pause') await wda.tapNode(button.node);
    await sleep(1000);
    await wda.terminate(IOS_BUNDLE_ID);
    await sleep(1500);
    const started = Date.now();
    await wda.launch(IOS_BUNDLE_ID);
    // Tap as soon as the mini player shows (the restore), in the first second if possible.
    // A find by accessibility id is much faster than a read of the whole screen tree.
    let tappedAt = null;
    while (Date.now() - started < 15000) {
      const uuid = await wda.findIdFast('mini-player-play-pause');
      if (uuid) {
        await wda.clickElement(uuid);
        tappedAt = Date.now() - started;
        break;
      }
      await sleep(50);
    }
    check(tappedAt !== null, 'the mini player did not show after the launch');
    log(
      `  tapped play ${tappedAt} ms after the launch command (the restored mini player showed then)`,
    );
    await sleep(3000);
    const after = await wda.find({id: 'mini-player-play-pause'});
    await ctx.shot('after-early-tap');
    check(
      after.node?.label === 'Pause',
      `the button shows "${after.node?.label}", not Pause`,
    );
    await openControlCenter(wda);
    const np1 = await nowPlaying(wda);
    await sleep(3000);
    const np2 = await nowPlaying(wda);
    await ctx.shot('control-center');
    await closeControlCenter(wda);
    check(
      np2.playing && np2.elapsed > np1.elapsed,
      'the audio does not advance after the early tap',
    );
  },

  /** QP-08 (iOS part): "Clear cache" while audio plays stops it and removes the system card. */
  'QP-08': async ctx => {
    const {wda, log} = ctx;
    await ensurePlaying(ctx);
    await wda.tap('.*Settings', {timeoutMs: 10000});
    await sleep(1500);
    // The Settings tab keeps its stack (an earlier run can leave Storage open): go back to
    // the root first.
    for (let i = 0; i < 3; i += 1) {
      const back =
        (await wda.find({id: 'BackButton'})).node ||
        (await wda.find('Back')).node;
      if (!back) break;
      await wda.tapNode(back);
      await sleep(1200);
    }
    // Settings → Storage → "Clear cache" → "Clear".
    await scrollTo(wda, 'Storage, View and manage storage.*');
    await wda.tap('Storage, View and manage storage.*', {timeoutMs: 10000});
    await sleep(1500);
    await scrollTo(wda, 'Clear cache');
    // The row has the title "Clear cache" and a button "Clear"; the dialog has "Clear" too.
    await wda.tap('Clear', {timeoutMs: 10000});
    await sleep(1000);
    await ctx.shot('clear-dialog');
    check(
      (await wda.alertButtons()).includes('Clear'),
      'the "Clear cache" dialog did not open',
    );
    await wda.alertAccept('Clear');
    const t0 = Date.now();
    await wda.waitFor('.*Cache has been cleared.*', {timeoutMs: 10000});
    log(`  "Cache has been cleared." after ${Date.now() - t0} ms`);
    await ctx.shot('cleared');
    const ok = await wda.find('OK');
    if (ok.node) await wda.tapNode(ok.node);
    await sleep(1000);
    const mini = await wda.find({id: 'mini-player-play-pause'});
    check(!mini.node, 'the mini player is still on screen');
    await openControlCenter(wda);
    const np = await nowPlaying(wda);
    await ctx.shot('control-center-after-clear');
    await closeControlCenter(wda);
    check(
      !(np.present && np.playing),
      `the system still shows "${np.title}" playing`,
    );
    log(
      `  Now Playing after the clear: ${np.present ? `"${np.title}", playing=${np.playing}` : 'no Qariah card'}`,
    );
    // The new play works (#235).
    await ensurePlaying(ctx);
  },
};
