// CLAUDE.md loads in each session and in each subagent, so it must stay small.
// Since 2026-11-08 the standing rules live in one file for each theme, and the
// history lives in docs/operations/claude-md-history.md.
//
// Permanent checks:
//   - CLAUDE.md is under 50 KB;
//   - each theme file that the CLAUDE.md index names exists;
//   - each theme file has a line in the index;
//   - the history file exists.
//
// One-time proof of no loss (the split of 2026-11-08): set CLAUDE_MD_OLD to a copy of
// the CLAUDE.md before the split (`git show <old ref>:CLAUDE.md`). Each non-empty line of
// that file must exist in CLAUDE.md or in one of the new files. A line that the split
// changed on purpose is in CHANGED_ON_PURPOSE.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const claude = read('CLAUDE.md');
const THEME_DIR = 'docs/operations/standing-rules';

const themeFiles = () =>
  fs.readdirSync(path.join(ROOT, THEME_DIR)).filter(f => f.endsWith('.md') && f !== 'README.md');

test('CLAUDE.md stays under 50 KB', () => {
  assert.ok(
    Buffer.byteLength(claude) < 50 * 1024,
    `CLAUDE.md is ${Buffer.byteLength(claude)} bytes. Move text to a theme file or to docs/operations/claude-md-history.md.`,
  );
});

test('each theme file in the CLAUDE.md index exists', () => {
  const named = [...claude.matchAll(/docs\/operations\/standing-rules\/([a-z0-9-]+\.md)/g)].map(m => m[1]);
  assert.ok(named.length >= 11, 'the index names the theme files');
  for (const f of new Set(named)) {
    assert.ok(fs.existsSync(path.join(ROOT, THEME_DIR, f)), `${THEME_DIR}/${f} is named in CLAUDE.md but missing`);
  }
});

test('each theme file has a line in the CLAUDE.md index', () => {
  for (const f of themeFiles()) {
    assert.ok(claude.includes(`${THEME_DIR}/${f}`), `${THEME_DIR}/${f} is not in the CLAUDE.md index`);
  }
});

test('the history file exists and keeps the collapsed history', () => {
  const h = read('docs/operations/claude-md-history.md');
  assert.match(h, /^## Dated history \(collapsed/m);
  assert.match(h, /^## Older sprints/m);
});

test('CLAUDE.md keeps the 16 hard rules and one dated entry', () => {
  const hard = claude.split(/^## Operating principles \(hard rules\)$/m)[1].split(/^## /m)[0];
  const numbers = [...hard.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1]));
  assert.deepEqual(numbers, Array.from({length: 16}, (_, i) => i + 1));
  assert.equal((claude.match(/^20\d\d-\d\d-\d\d — /gm) || []).length, 1);
});

// Lines that the split changed on purpose. Each key is the start of the OLD line.
// The value is the start of the line that replaced it.
const CHANGED_ON_PURPOSE = {
  '- **Doc & memory maintenance (2026-07-19):**': '- **Doc & memory maintenance (2026-07-19; changed 2026-11-08):**',
  '- **An unattended run does not use AskUserQuestion,': '- **An unattended run does not use AskUserQuestion,',
  '## Standing rules (consolidated 2026-07-19)': '## Standing rules (consolidated 2026-07-19)',
};

const OLD = process.env.CLAUDE_MD_OLD;
test('no line of the old CLAUDE.md is lost', {skip: !OLD && 'set CLAUDE_MD_OLD to run the one-time proof'}, () => {
  const haystack = [claude, ...['docs/operations/claude-md-history.md', `${THEME_DIR}/README.md`, ...themeFiles().map(f => `${THEME_DIR}/${f}`)].map(read)].join('\n');
  const have = new Set(haystack.split('\n'));
  const lost = [];
  let checked = 0;
  for (const line of fs.readFileSync(OLD, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    checked += 1;
    if (have.has(line)) continue;
    const key = Object.keys(CHANGED_ON_PURPOSE).find(k => line.startsWith(k));
    if (key && haystack.includes(CHANGED_ON_PURPOSE[key])) continue;
    lost.push(line.slice(0, 120));
  }
  console.log(`no-loss check: ${checked} non-empty lines checked, ${lost.length} lost`);
  assert.deepEqual(lost, []);
});
