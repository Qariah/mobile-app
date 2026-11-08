#!/usr/bin/env node
// @ai
//
// scripts/__tests__/scripts-no-undef.test.mjs
// -------------------------------------------
// Every `.mjs` file under scripts/ must name only identifiers that it
// declares or imports (ESLint `no-undef`). The repository ESLint config does
// not lint scripts/, so nothing else catches a missing import.
//
// Why: `scripts/daily-card.mjs` called `readOwnerQueue()` without an import
// from 2026-11-05 (`d4944b3`). The call sat inside a try, so the ReferenceError
// blanked the whole NEEDS YOU block of the Daily card, and no run failed
// (issues #793 and #795).
//
// Run:  node --test scripts/__tests__/scripts-no-undef.test.mjs

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Linter} from 'eslint';
import globals from 'globals';

const SCRIPTS = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['__tests__', 'node_modules']);

function mjsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) out.push(...mjsFiles(join(dir, e.name)));
    } else if (e.name.endsWith('.mjs')) out.push(join(dir, e.name));
  }
  return out;
}

const CONFIG = [
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.node},
    },
    rules: {'no-undef': 'error'},
  },
];

/** The `no-undef` hits of one source text. */
export function undefinedNames(source, filename = 'x.mjs') {
  return new Linter({configType: 'flat'})
    .verify(source, CONFIG, filename)
    .filter(m => m.ruleId === 'no-undef')
    .map(m => `${m.line}: ${m.message}`);
}

describe('scripts no-undef', () => {
  it('finds a call with no import (the #795 shape)', () => {
    const src =
      "import {a} from './lib/x.mjs';\n" +
      'function f() {\n  try {\n    return readOwnerQueue();\n  } catch {\n    return a;\n  }\n}\nf();\n';
    assert.deepEqual(undefinedNames(src), [
      "4: 'readOwnerQueue' is not defined.",
    ]);
  });

  it('every scripts/**/*.mjs file declares or imports each name it uses', () => {
    const hits = [];
    for (const f of mjsFiles(SCRIPTS)) {
      for (const h of undefinedNames(readFileSync(f, 'utf8'), f))
        hits.push(`scripts/${relative(SCRIPTS, f)}:${h}`);
    }
    assert.deepEqual(hits, []);
  });
});
