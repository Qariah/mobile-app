// @ai-generated
// Qariah's i18n layer: the `qariah` namespace and the overlay on upstream keys
// (i18n/qariahOverrides.ts). The general locale rules (no empty strings, the
// same placeholders, every plural category) run for the `qariah` namespace in
// locales.test.ts as well, because it is part of `namespaces`. This suite
// pins the Qariah-specific rules.
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {resources, namespaces} from '../resources';
import {
  QARIAH_OVERRIDES,
  applyOverrides,
  type LocaleTree,
} from '../qariahOverrides';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /{{\s*([\w.]+)\s*(?:,[^}]*)?}}/g;
const ARABIC_PLURALS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const ENGLISH_PLURALS = ['one', 'other'];

function flatten(tree: LocaleTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

function placeholders(value: string, ignoreCount: boolean): string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!(ignoreCount && match[1] === 'count')) names.add(match[1]);
  }
  return [...names].sort();
}

/** Upstream's locale files as they are on disk, without the overlay. */
function upstreamTree(language: string, ns: string): LocaleTree {
  return require(`../locales/${language}/${ns}.json`) as LocaleTree;
}

const upstreamNamespaces: string[] = namespaces.filter(ns => ns !== 'qariah');

const en = flatten(resources.en.qariah as LocaleTree);
const ar = flatten(resources.ar.qariah as LocaleTree);

const GENERATOR = resolve(
  __dirname,
  '../../scripts/i18n-qariah-from-review.mjs',
);
// The generator reads the review pack under planning/, which
// scripts/publish-to-public.sh strips from the public mirror. There the
// generated JSON is all there is, so the two generator checks are skipped.
const REVIEW_PACK = resolve(
  __dirname,
  '../../planning/pass-c/arabic-review/ui-strings.csv',
);
const itWithReviewPack = existsSync(REVIEW_PACK) ? it : it.skip;

describe('qariah namespace', () => {
  itWithReviewPack(
    'matches the review pack (the generator leaves it byte-identical)',
    () => {
      // Throws (and so fails) when the JSON differs from what the CSV gives.
      expect(() =>
        execFileSync(process.execPath, [GENERATOR, '--check'], {
          stdio: 'pipe',
        }),
      ).not.toThrow();
    },
  );

  it('is registered for every language', () => {
    expect(namespaces).toContain('qariah');
    expect(Object.keys(resources.ar)).toContain('qariah');
  });

  it('has the same keys in English and Arabic, apart from plural forms', () => {
    const bases = (flat: Record<string, string>) =>
      [...new Set(Object.keys(flat).map(k => k.replace(PLURAL_SUFFIX, '')))]
        .sort()
        .join('\n');
    expect(bases(ar)).toEqual(bases(en));
  });

  it('gives every English plural key all six Arabic plural forms', () => {
    const pluralBases = new Set(
      Object.keys(en)
        .filter(k => PLURAL_SUFFIX.test(k))
        .map(k => k.replace(PLURAL_SUFFIX, '')),
    );
    for (const base of pluralBases) {
      const englishMissing = ENGLISH_PLURALS.filter(
        c => !(`${base}_${c}` in en),
      );
      const arabicMissing = ARABIC_PLURALS.filter(c => !(`${base}_${c}` in ar));
      expect({base, englishMissing, arabicMissing}).toEqual({
        base,
        englishMissing: [],
        arabicMissing: [],
      });
    }
  });

  it('keeps every English placeholder in each Arabic value', () => {
    for (const [key, value] of Object.entries(ar)) {
      const plural = PLURAL_SUFFIX.test(key);
      const base = key.replace(PLURAL_SUFFIX, '');
      const english = plural ? en[`${base}_other`] : en[key];
      expect({key, vars: placeholders(value, plural)}).toEqual({
        key,
        vars: placeholders(english, plural),
      });
    }
  });
});

describe('Qariah overrides of upstream keys', () => {
  itWithReviewPack(
    'match the review pack, section U (i18n/overrides/ar.json is generated)',
    () => {
      expect(() =>
        execFileSync(process.execPath, [GENERATOR, '--section=U', '--check'], {
          stdio: 'pipe',
        }),
      ).not.toThrow();
    },
  );

  const upstream = Object.fromEntries(
    Object.keys(resources).map(language => [
      language,
      Object.fromEntries(
        upstreamNamespaces.map(ns => [ns, upstreamTree(language, ns)]),
      ),
    ]),
  );

  it('only replace keys that upstream has', () => {
    expect(applyOverrides(upstream, QARIAH_OVERRIDES).problems).toEqual([]);
  });

  it("only name keys in upstream's English source", () => {
    for (const [language, byNamespace] of Object.entries(QARIAH_OVERRIDES)) {
      for (const [ns, tree] of Object.entries(byNamespace)) {
        expect({
          language,
          ns,
          upstream: upstreamNamespaces.includes(ns),
        }).toEqual({language, ns, upstream: true});
        if (!upstreamNamespaces.includes(ns)) continue;
        const english = flatten(upstreamTree('en', ns));
        const englishBases = new Set(
          Object.keys(english).map(k => k.replace(PLURAL_SUFFIX, '')),
        );
        for (const key of Object.keys(flatten(tree))) {
          const base = key.replace(PLURAL_SUFFIX, '');
          expect({ns, key, inEnglish: englishBases.has(base)}).toEqual({
            ns,
            key,
            inEnglish: true,
          });
        }
      }
    }
  });

  it("keep the upstream value's placeholders", () => {
    for (const [language, byNamespace] of Object.entries(QARIAH_OVERRIDES)) {
      for (const [ns, tree] of Object.entries(byNamespace)) {
        if (!upstreamNamespaces.includes(ns)) continue;
        const original = flatten(upstreamTree(language, ns));
        for (const [key, value] of Object.entries(flatten(tree))) {
          if (!(key in original)) continue; // reported by the test above
          const plural = PLURAL_SUFFIX.test(key);
          expect({
            language,
            ns,
            key,
            vars: placeholders(value, plural),
          }).toEqual({
            language,
            ns,
            key,
            vars: placeholders(original[key], plural),
          });
        }
      }
    }
  });

  it('reach the app resources without changing the upstream files', () => {
    expect(resources.en.home.home.exploreByRewayah).toBe('Browse by Rewaya');
    expect(
      flatten(upstreamTree('en', 'home'))['home.exploreByRewayah'],
    ).not.toBe('Browse by Rewaya');
  });

  // The four Qariah English wordings that the Sprint 47 merge replaced, and
  // the Arabic that follows each one (the qariah key with the same English).
  it.each([
    ['home', 'home.exploreByRewayah', 'homeRows.rewayat'],
    ['settings', 'index.items.github.description', 'settings.githubDesc'],
    ['settings', 'defaultReciter.completeOnly', null],
    ['collection', 'notesScreen.emptySubtitle', 'notes.personalHint'],
  ])('restore the Qariah English of %s:%s', (ns, key, twin) => {
    const english = flatten(resources.en[ns as 'home'] as LocaleTree)[key];
    expect(english).toBe(flatten(QARIAH_OVERRIDES.en[ns])[key]);
    expect(english).not.toBe(flatten(upstreamTree('en', ns))[key]);
    if (twin) {
      expect(english).toBe(en[twin]);
      expect(flatten(resources.ar[ns as 'home'] as LocaleTree)[key]).toBe(
        ar[twin],
      );
    }
  });
});
