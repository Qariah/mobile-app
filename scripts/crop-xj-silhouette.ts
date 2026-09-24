/**
 * Sprint 23 (S23.4 — TECH_DEBT #72) — crop the XJ (Xinjiang / East
 * Turkistan) country silhouette to a tight viewBox.
 *
 * `assets/country-shapes/XJ.ts` was extracted (Sprint 21 S21.U3) from a
 * "Xinjiang highlighted in China" map and inherited the source SVG's full
 * China viewBox (`0 0 2220.489 1938.905`). Xinjiang lies in NW China, so
 * the silhouette rendered small and offset toward the upper-left of the
 * icon canvas instead of centred.
 *
 * The fix is purely a viewBox change — the path `d` data already lives in
 * the source coordinate space; an SVG `viewBox` of `minX minY w h` simply
 * reframes that space, no path translation needed. This script computes
 * the true bounding box of the (curve-aware) path data via `svg-path-bbox`,
 * adds a small uniform padding, and rewrites the `viewBox:` line in
 * `XJ.ts`.
 *
 * Re-runnable + idempotent: running it again on an already-cropped file
 * recomputes the same bbox (the path data is unchanged) and rewrites the
 * identical viewBox line.
 *
 *   npx tsx scripts/crop-xj-silhouette.ts
 */
import {readFileSync, writeFileSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';
import {svgPathBbox} from 'svg-path-bbox';
import {XJ} from '../assets/country-shapes/XJ';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const XJ_PATH = join(SCRIPT_DIR, '..', 'assets', 'country-shapes', 'XJ.ts');

// Padding as a fraction of the larger bbox dimension — keeps the
// silhouette off the canvas edge without distorting the aspect ratio.
const PADDING_FRACTION = 0.03;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function main(): void {
  const paths = XJ.paths;
  if (!paths.length) {
    throw new Error('XJ.paths is empty — nothing to crop.');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const d of paths) {
    const [x1, y1, x2, y2] = svgPathBbox(d);
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }

  const rawW = maxX - minX;
  const rawH = maxY - minY;
  const pad = Math.max(rawW, rawH) * PADDING_FRACTION;

  const vbX = round(minX - pad);
  const vbY = round(minY - pad);
  const vbW = round(rawW + pad * 2);
  const vbH = round(rawH + pad * 2);
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`;

  const src = readFileSync(XJ_PATH, 'utf8');
  const next = src.replace(/(\n\s*viewBox:\s*)'[^']*'/, `$1'${viewBox}'`);
  if (next === src) {
    throw new Error('viewBox line not found / unchanged in XJ.ts.');
  }
  writeFileSync(XJ_PATH, next);

  console.log(
    `[crop-xj] tight bbox = [${round(minX)}, ${round(minY)}, ` +
      `${round(maxX)}, ${round(maxY)}]`,
  );
  console.log(
    `[crop-xj] new viewBox = '${viewBox}' (was '0 0 2220.489 1938.905')`,
  );
}

main();
