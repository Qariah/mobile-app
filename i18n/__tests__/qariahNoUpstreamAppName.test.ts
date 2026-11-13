// @ai Sprint 52: no UI string names the upstream app.
//
// Pass D brought two iOS language strings that name "Bayaan" (بيان) in a
// sentence, and Qariah had no override for them, so the iOS Language screen
// told users to look for Bayaan's settings. This test resolves each English
// and Arabic string as the app does (the upstream locale file, then
// i18n/overrides/<lang>.json) and fails on the upstream app's name outside the
// places that name it on purpose.
import {readdirSync, readFileSync, existsSync} from 'fs';
import path from 'path';

const I18N = path.resolve(__dirname, '..');

/**
 * Keys that name Bayaan on purpose (the credits, a tafsir title, and the
 * release notes: 3.1.3 "Qariah, rebuilt on Bayaan" and Bayaan's own releases
 * 2.0 to 2.2 in data/changelog.json, review pack section Q).
 */
const ALLOWED = [
  /^qariah\.credits\.bayaan/,
  /^qariah\.changelog\./,
  /^home\.tafseerNames\./,
  /^settings\.credits\./,
];

type Tree = {[key: string]: string | Tree};

function merge(base: Tree, over: Tree): Tree {
  for (const [key, value] of Object.entries(over)) {
    const current = base[key];
    if (typeof value === 'object' && typeof current === 'object') {
      merge(current, value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function resolved(lang: string): Tree {
  const dir = path.join(I18N, 'locales', lang);
  const tree: Tree = {};
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    tree[file.replace(/\.json$/, '')] = JSON.parse(
      readFileSync(path.join(dir, file), 'utf8'),
    );
  }
  const overrides = path.join(I18N, 'overrides', `${lang}.json`);
  if (existsSync(overrides)) {
    merge(tree, JSON.parse(readFileSync(overrides, 'utf8')));
  }
  return tree;
}

function hits(tree: Tree, pattern: RegExp, prefix = ''): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix + key;
    if (typeof value === 'string') {
      if (pattern.test(value) && !ALLOWED.some(rule => rule.test(full))) {
        found.push(full);
      }
    } else {
      found.push(...hits(value, pattern, `${full}.`));
    }
  }
  return found;
}

describe('no UI string names the upstream app', () => {
  it('English', () => {
    expect(hits(resolved('en'), /\bBayaan\b/)).toEqual([]);
  });

  it('Arabic (بيان as a word, not inside بيانات or البيان)', () => {
    expect(hits(resolved('ar'), /(^|[^؀-ۿ])بيان([^؀-ۿ]|$)/)).toEqual([]);
  });
});
