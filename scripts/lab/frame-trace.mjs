#!/usr/bin/env node
// @ai Qariah: the longest main-thread frames in an atrace file (the PERF-09 return stall).
// Usage: node scripts/lab/frame-trace.mjs <trace> <pid> [--after=<seconds>]
// Prints the frame count, the six longest Choreographer#doFrame slices of that
// thread (ms@seconds from the trace start) and the first five frames.
// --after=N counts only the frames that start N seconds or more after the
// first event of the process (scripts/lab/anr-probe.sh --link-at).
import fs from 'node:fs';

const argv = process.argv.slice(2);
const [file, pid] = argv.filter(x => !x.startsWith('--'));
const afterArg = argv.find(x => x.startsWith('--after='));
const after = afterArg ? Number(afterArg.split('=')[1]) : 0;
if (!file || !pid) {
  console.error('usage: frame-trace.mjs <trace> <pid>');
  process.exit(2);
}
const re =
  /^\s*(\S+)-(\d+)\s+.*?\s(\d+\.\d+): tracing_mark_write: ([BE])\|?(\d+)?\|?(.*)$/;
const stack = [];
const frames = [];
let first = null;
let last = null;
for (const line of fs.readFileSync(file, 'latin1').split('\n')) {
  const m = line.match(re);
  if (!m || m[2] !== pid) continue;
  const t = Number(m[3]);
  first ??= t;
  last = t;
  if (m[4] === 'B') {
    stack.push({name: m[6], t});
  } else {
    const open = stack.pop();
    if (open && /doFrame/.test(open.name) && open.t - first >= after) {
      frames.push({at: open.t - first, ms: (t - open.t) * 1000});
    }
  }
}
const fmt = f => `${f.ms.toFixed(0)}ms@${f.at.toFixed(2)}s`;
console.log('frames', frames.length, 'span', last === null ? 0 : last - first);
console.log(
  'longest',
  [...frames]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 6)
    .map(fmt)
    .join(' '),
);
console.log('first frames', frames.slice(0, 5).map(fmt).join(' '));
