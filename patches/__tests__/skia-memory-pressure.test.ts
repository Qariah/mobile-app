// @ai
// DO NOT DROP — guards patches/@shopify+react-native-skia+2.6.2.patch (issue
// #777, Sentry QARIAHV2-7C).
//
// The defect (iOS, production 3.2.3 (3772)): a fatal Hermes abort, "OOM: Max
// heap size was exceeded", in the Mushaf reader while the user changed
// settings. Skia tells Hermes how much native memory each Skia object holds
// (`setExternalMemoryPressure`), and Hermes counts that amount against its
// 3 GB heap limit until the GC frees the object. Skia 2.6.2 reports 1 MB for
// each paragraph and paragraph builder and 5 MB for each canvas recording
// (Skia 2.2.12 in production 1718 reported 8 KB, 4 KB and 16 KB). The reader
// makes hundreds of these objects for each settings change, so the claimed
// total reached 3 GB while the real memory stayed small.
//
// Skia fixed the numbers in Shopify/react-native-skia#4090 (in 2.14.0 and
// 3.x). The patch puts the same numbers into 2.6.2. These tests read the
// native source that the iOS and Android builds compile (both build the Skia
// JSI layer from node_modules). They pass for 2.6.2 with the patch, and for
// 2.14.0 and later.
import {readFileSync} from 'fs';
import {dirname, join} from 'path';

const API = join(
  dirname(require.resolve('@shopify/react-native-skia/package.json')),
  'cpp',
  'api',
);

const KB = 1024;

/** The bytes that `getMemoryPressure()` of a Skia API header returns. */
function reportedPressure(file: string): number {
  const source = readFileSync(join(API, file), 'utf8');
  // 2.6.2 declares `const override`; 2.14.0 and later declare `override`.
  const match = source.match(
    /size_t getMemoryPressure\(\)\s*(?:const\s*)?override\s*\{\s*return ([^;]+);/,
  );
  if (!match) throw new Error(`No constant getMemoryPressure() in ${file}`);
  const expr = match[1].trim();
  if (expr === 'kMinMemoryPressure') return 256;
  const numeric = expr.replace(/\s/g, '');
  if (!/^[0-9*]+$/.test(numeric)) {
    throw new Error(`Unexpected getMemoryPressure() in ${file}: ${expr}`);
  }
  return numeric.split('*').reduce((acc, n) => acc * Number(n), 1);
}

/** Fails with the repair step when the patched value is not there. */
function expectAtMost(file: string, max: number): void {
  const bytes = reportedPressure(file);
  if (bytes > max) {
    throw new Error(
      `${file} reports ${bytes} bytes of memory pressure (max ${max}). ` +
        'Run `npx patch-package`: ' +
        'patches/@shopify+react-native-skia+2.6.2.patch is not applied.',
    );
  }
}

describe('Skia memory pressure (issue #777)', () => {
  it('a paragraph reports 16 KB, not 1 MB', () => {
    expectAtMost('JsiSkParagraph.h', 16 * KB);
  });

  it('a paragraph builder reports the minimum', () => {
    expectAtMost('JsiSkParagraphBuilder.h', 256);
    expectAtMost('JsiSkParagraphBuilderFactory.h', 256);
  });

  it('a canvas recording reports the minimum, not 5 MB', () => {
    expectAtMost('recorder/JsiRecorder.h', 256);
    expectAtMost('JsiSkPictureRecorder.h', 256);
  });

  it('a shader and an image filter report the minimum', () => {
    expectAtMost('JsiSkShader.h', 256);
    expectAtMost('JsiSkImageFilter.h', 256);
  });
});
