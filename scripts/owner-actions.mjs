#!/usr/bin/env node
// @ai
//
// scripts/owner-actions.mjs
// -------------------------
// The owner's next steps of the Claude Cloud migration, checked every day.
// It reads docs/operations/owner-actions.json, runs the check of each item
// (scripts/lib/owner-actions.mjs), and prints one line for each item that
// has something to say:
//   NEEDS YOU · <the exact instruction for Omar>
//   WAITING · <what the loop waits for; Omar has nothing to do>
//   NOT CHECKED · <an item whose live state could not be read today>
//   MAC ONLY · <the due Mac-only items a cloud run cannot read, in one line>
// It prints nothing for an item that is not due yet or done. The daily card (scripts/daily-card.mjs) prints the NEEDS YOU
// lines in its NEEDS YOU section.
//
//   node scripts/owner-actions.mjs              # the lines above
//   node scripts/owner-actions.mjs --json       # every item with its state
//   node scripts/owner-actions.mjs --only=mac   # the Mac-only items (the Mac
//                                               # task after the cutover)
//   node scripts/owner-actions.mjs --today=2026-10-01   # test a date
//
// It never writes. Omar's reply reaches it in one of two ways: a session
// records it in the JSON file (see its `replies` table), or an `owner-reply:`
// comment on the `Daily card` issue applies the phrase's `effect`
// (scripts/lib/owner-replies.mjs, scripts/owner-reply.mjs). Works on the Mac
// and in Claude Cloud (REST only).
// Exit 0 always, unless the list file is missing or broken (exit 1).

import {evaluateOwnerActions, renderLines} from './lib/owner-actions.mjs';
import {
  loadOwnerActionsWithReplies,
  makeFacts,
} from './lib/owner-actions-facts.mjs';
import {ownerDate} from './lib/run-health.mjs';
import {isCloudSession} from './lib/triage-common.mjs';

const ARGS = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

let list;
let replies;
try {
  replies = loadOwnerActionsWithReplies();
  list = replies.list;
} catch (e) {
  console.error(
    `❌ docs/operations/owner-actions.json does not parse: ${e.message}`,
  );
  process.exit(1);
}
if (!list) {
  console.error('❌ docs/operations/owner-actions.json is missing');
  process.exit(1);
}
if (ARGS.only && ARGS.only !== 'mac') {
  console.error(`❌ --only=${ARGS.only}: use --only=mac`);
  process.exit(2);
}

const today =
  typeof ARGS.today === 'string' ? ARGS.today : ownerDate(Date.now());
const results = evaluateOwnerActions(list, {
  today,
  cloud: isCloudSession(),
  only: ARGS.only || undefined,
  facts: makeFacts(list),
});

if (ARGS.json) {
  console.log(
    JSON.stringify(
      {
        today,
        cloud: isCloudSession(),
        results,
        repliesApplied: replies.applied,
        repliesError: replies.repliesError || null,
      },
      null,
      2,
    ),
  );
} else {
  const lines = renderLines(results);
  if (!lines.some(l => l.startsWith('NEEDS YOU')))
    lines.unshift('NEEDS YOU · none');
  if (replies.repliesError)
    lines.push(
      `NOT CHECKED · owner replies (Daily card comments): ${replies.repliesError}`,
    );
  console.log(lines.join('\n'));
}
