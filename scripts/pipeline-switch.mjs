#!/usr/bin/env node
// @ai
//
// scripts/pipeline-switch.mjs — may this scheduled run start?
// ---------------------------------------------------------------------------
//   node scripts/pipeline-switch.mjs <task>
//
// Reads the labels of the pinned "Daily card" issue (REST only, so it works
// on the Mac and in a cloud session) and applies scripts/lib/pipeline-switch.mjs.
// `scripts/run-start.sh` calls it before every run.
//
// Exit 0 = the run may start. Exit 3 = a label stops the run.
// A read that fails exits 0 with a WARN line (fail open): a GitHub outage must
// not stop the daily work. The Daily card is the only place to look, so a
// missing card is the same as no label.

import {DAILY_CARD_TITLE, GH_REPO, ghApi} from './lib/triage-common.mjs';
import {switchFor} from './lib/pipeline-switch.mjs';

const task = process.argv[2];
if (!task || task.startsWith('-')) {
  console.error('usage: node scripts/pipeline-switch.mjs <task>');
  process.exit(2);
}

let labels;
try {
  const cards = ghApi(`repos/${GH_REPO}/issues`, {
    query: {state: 'open', labels: 'ops', per_page: 100},
  });
  const card = (cards || []).find(
    i => !i.pull_request && i.title === DAILY_CARD_TITLE,
  );
  labels = card ? (card.labels || []).map(l => (typeof l === 'string' ? l : l.name)) : [];
} catch (e) {
  console.log(
    `pipeline-switch: WARN could not read the Daily card labels (${String(e.message || e).split('\n')[0]}). The run continues.`,
  );
  process.exit(0);
}

const s = switchFor(labels, task);
if (s.stop) {
  console.log(`pipeline-switch: STOP ${task}: ${s.reason}.`);
  console.log(
    `pipeline-switch: to start it again, remove the label \`${s.label}\` from the Daily card.`,
  );
  process.exit(3);
}
console.log(`pipeline-switch: OK ${task} (${s.reason})`);
