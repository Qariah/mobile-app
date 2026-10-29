// @ai-generated
// TECH_DEBT #278: no module may read the window size at module load.
//
// A value read once, when the module loads, keeps the size of the window at
// that moment. Metro inline requires can load a module while the window is in
// landscape (on the way back from the Mushaf reader); an iPad window turns and
// resizes on every screen (the app supports multitasking). Read the size in
// render (`useWindowDimensions()`) or when the value is used.
//
// The scan parses each source file and reports every `Dimensions.get(...)`
// call that is not inside a function.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import * as ts from 'typescript';

const ROOT = join(__dirname, '..', '..');
const DIRS = [
  'app',
  'components',
  'hooks',
  'services',
  'store',
  'styles',
  'utils',
  'config',
  'constants',
];

// Module-load reads that stay, each with the reason it is harmless.
const ALLOWED: Record<string, string> = {
  // No module imports these three files, so they never load.
  'app/(tabs)/(a.home)/reciter/_styles.ts': 'never imported',
  'app/(tabs)/(b.search)/reciter/_styles.ts': 'never imported',
  'app/(tabs)/(c.collection)/reciter/_styles.ts': 'never imported',
  // The app uses components/modals/WhatsNewOnboarding; nothing imports this one.
  'components/modals/WhatsNewModal.tsx': 'never imported',
  // Only type imports name this file, so it never loads at run time.
  'styles/theme.ts': 'type imports only',
  // MAX_PLAYER_CONTENT_HEIGHT, the only value from the read, has no consumer.
  'utils/constants.ts': 'the value has no consumer',
  // The phone-portrait snapshot. Some readers still use the snapshot
  // PAGE_PADDING_TOP / PAGE_PADDING_BOTTOM (reading/ReadingPageView.tsx,
  // qcf/QCFPage.tsx). The reader rarely loads in landscape, so we accept it.
  'components/mushaf/constants.ts':
    'snapshot paddings in ReadingPageView and QCFPage; accepted',
  // The horizontal paged FlatList has no key: with a live width, a turn shows
  // a page between two (and Play All dispatches swipedTo).
  'app/(tabs)/(a.home)/adhkar/[superId]/[dhikrId].tsx':
    'hidden in Qariah (adhkar: false); upstream fix needs the orientation key remount (CLAUDE.md RN gotchas)',
  'app/(tabs)/(a.home)/adhkar/saved/[dhikrId].tsx':
    'hidden in Qariah (adhkar: false); upstream fix needs the orientation key remount (CLAUDE.md RN gotchas)',
};

const NEW_READ_HELP =
  'A new module-level window read. If it came from upstream: add an ALLOWED ' +
  'line with a reason; do not edit the upstream file. If it is Qariah code: ' +
  'read the size in render (useWindowDimensions()) or when the value is used.';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function moduleScopeReads(path: string): number[] {
  const text = readFileSync(path, 'utf8');
  if (!text.includes('Dimensions.get')) return [];
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node, inFunction: boolean) => {
    if (
      !inFunction &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'get' &&
      node.expression.expression.getText(source) === 'Dimensions'
    ) {
      lines.push(
        source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      );
    }
    const nowInFunction = inFunction || isFunctionLike(node);
    ts.forEachChild(node, child => visit(child, nowInFunction));
  };
  visit(source, false);
  return lines;
}

describe('window size reads (TECH_DEBT #278)', () => {
  const found: Record<string, number[]> = {};
  for (const dir of DIRS) {
    let files: string[] = [];
    try {
      files = sourceFiles(join(ROOT, dir));
    } catch {
      continue; // the directory does not exist
    }
    for (const path of files) {
      const lines = moduleScopeReads(path);
      if (lines.length) found[relative(ROOT, path)] = lines;
    }
  }

  it('no module reads the window size at module load', () => {
    const unexpected = Object.entries(found)
      .filter(([file]) => !(file in ALLOWED))
      .map(([file, lines]) => `${file}:${lines.join(',')}`);
    if (unexpected.length) {
      throw new Error(`${NEW_READ_HELP}\n${unexpected.join('\n')}`);
    }
  });

  // This also proves that the scan finds a module-load read.
  it('every allowed file still has its read (remove a fixed file from the list)', () => {
    const stale = Object.keys(ALLOWED).filter(file => !(file in found));
    expect(stale).toEqual([]);
  });
});
