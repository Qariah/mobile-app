// @ai
//
// scripts/lib/build-lines.mjs
// ---------------------------
// "Is the fix of build F inside production build P?" — answered by the git
// release line, not by comparing the two numbers.
//
// WHY. A build number is `git rev-list --count <commit>` + VERSION_CODE_OFFSET
// (scripts/generate-version.js), and each branch carries its own offset. So the
// numbers of two lines interleave. On 2026-09-28 Android production started to
// ramp 3.2.1 (2027) from `hotfix/3.2.0-anr-splash`, while the `qariah-main`
// betas 1769–2025 carry fixes that 2027 does not contain. A number compare
// (1922 <= 2027) would close those issues as live in production.
//
// HOW.
//   1. Index every commit that is reachable from the published refs (default:
//      `--remotes=origin --tags`, plus the production commit): its ancestor
//      count + the offset in its own copy of generate-version.js = the build it
//      derives. Offset bumps make several commits derive the same number, so a
//      build maps to a LIST of candidate commits.
//   2. The fix of build F is in production commit P when EVERY candidate of F
//      is an ancestor of P (`git merge-base --is-ancestor`). When NO candidate
//      is an ancestor, the fix is on another line. Anything else — no
//      candidate, a mixed list, a shallow clone, an unknown P — is `unknown`,
//      and the caller holds the issue open. It never closes on a guess.
//   3. F === the production build number is `in`: production IS build F.
//
// Limits (stated, not hidden): a build made with a BUILD_NUMBER override
// derives nothing (so its issues hold); an offset bump often makes the build
// before or after it derive the same number (a mixed list, so they hold).
//
// The pure functions have no I/O (unit tests: scripts/__tests__/build-lines.test.mjs).
// `gitBuildLines()` is the only part that runs git.

import {execFileSync} from 'node:child_process';

export const VERSION_SCRIPT = 'scripts/generate-version.js';
const OFFSET_RE = /const VERSION_CODE_OFFSET = (\d+);/;

/**
 * The VERSION_CODE_OFFSET in one copy of generate-version.js. A copy with no
 * offset line is from the time before the offset existed, so its offset is 0.
 * @param {string} text
 * @returns {number}
 */
export function parseVersionCodeOffset(text) {
  const m = String(text || '').match(OFFSET_RE);
  return m ? Number(m[1]) : 0;
}

/* eslint-disable no-bitwise -- countAncestors keeps one bitset of ancestors per commit; popcount counts it */
/**
 * The number of commits reachable from each commit, itself included — the
 * value of `git rev-list --count <sha>`.
 * @param {{sha:string, parents:string[]}[]} commits every parent before its
 *   children (`git rev-list --topo-order --reverse --parents`)
 * @returns {Map<string, number>}
 * @throws when a parent is not in the list (a shallow or partial history)
 */
export function countAncestors(commits) {
  const index = new Map(commits.map((c, i) => [c.sha, i]));
  const words = Math.ceil(commits.length / 32) || 1;
  const sets = new Array(commits.length);
  const counts = new Map();
  commits.forEach((c, i) => {
    const s = new Uint32Array(words);
    for (const p of c.parents) {
      const j = index.get(p);
      if (j === undefined || j >= i)
        throw new Error(
          `parent ${p.slice(0, 8)} of ${c.sha.slice(0, 8)} is not in the history`,
        );
      const ps = sets[j];
      for (let w = 0; w < words; w++) s[w] |= ps[w];
    }
    s[i >>> 5] |= 1 << (i & 31);
    sets[i] = s;
    let n = 0;
    for (let w = 0; w < words; w++) n += popcount(s[w]);
    counts.set(c.sha, n);
  });
  return counts;
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
/* eslint-enable no-bitwise */

/**
 * Build number → the commits that derive it.
 * @param {Map<string, number>} counts from countAncestors
 * @param {(sha:string) => ?number} offsetOf null when the commit has no
 *   generate-version.js (it derives no build)
 * @returns {Map<number, string[]>}
 */
export function buildIndex(counts, offsetOf) {
  const out = new Map();
  for (const [sha, count] of counts) {
    const offset = offsetOf(sha);
    if (offset === null || offset === undefined) continue;
    const build = count + offset;
    if (!out.has(build)) out.set(build, []);
    out.get(build).push(sha);
  }
  return out;
}

const short = s => String(s).slice(0, 8);
const list = xs => xs.map(short).join(', ');

/**
 * Is the fix of build `fixBuild` inside the production build?
 * @param {{
 *   fixBuild: number,
 *   prod: {build:number, commit:?string, why?:string},
 *   candidates: ?string[],       the commits that derive fixBuild; null when the index failed
 *   indexError?: ?string,
 *   isAncestor: (a:string, b:string) => boolean,
 * }} o
 * @returns {{state:'in'|'out'|'unknown', why:string}}
 */
export function lineVerdict({
  fixBuild,
  prod,
  candidates,
  indexError,
  isAncestor,
}) {
  if (!prod.commit)
    return {
      state: 'unknown',
      why: `production commit unknown: ${prod.why || 'not resolved'}`,
    };
  if (fixBuild === prod.build)
    return {state: 'in', why: `build ${fixBuild} is the production build`};
  if (!candidates)
    return {
      state: 'unknown',
      why: `cannot map builds to commits: ${indexError || 'no index'}`,
    };
  if (!candidates.length)
    return {
      state: 'unknown',
      why: `no published commit derives build ${fixBuild} (a BUILD_NUMBER override, or a branch that is not on origin)`,
    };
  const on = candidates.filter(c => isAncestor(c, prod.commit));
  if (on.length === candidates.length)
    return {
      state: 'in',
      why: `build ${fixBuild} (${list(candidates)}) is an ancestor of production ${short(prod.commit)}`,
    };
  if (!on.length)
    return {
      state: 'out',
      why: `build ${fixBuild} (${list(candidates)}) is on another line — not in production ${short(prod.commit)}`,
    };
  return {
    state: 'unknown',
    why: `build ${fixBuild} is ambiguous: ${candidates.length} commits derive it and ${on.length} are in production ${short(prod.commit)} (${list(candidates)})`,
  };
}

/**
 * The git side. Every call runs in `cwd`. The index is built once, on the
 * first `candidates()` call, from `refs` plus every commit given to `addRev()`
 * before that call.
 * @param {{cwd?:string, refs?:string[]}} [o]
 */
export function gitBuildLines({
  cwd = process.cwd(),
  refs = ['--remotes=origin', '--tags'],
} = {}) {
  const git = (args, input) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      input,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const extra = [];
  let index = null;
  let indexError = null;

  const shallow = (() => {
    try {
      return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
    } catch {
      return true; // not a git checkout: nothing can be resolved
    }
  })();

  function build() {
    if (index || indexError) return;
    if (shallow) {
      indexError =
        'shallow clone — the history needed to derive build numbers is missing';
      return;
    }
    try {
      const commits = git([
        'rev-list',
        '--topo-order',
        '--reverse',
        '--parents',
        ...refs,
        ...extra,
      ])
        .split('\n')
        .filter(Boolean)
        .map(l => {
          const [sha, ...parents] = l.split(' ');
          return {sha, parents};
        });
      const counts = countAncestors(commits);
      const blobs = git(
        ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
        commits.map(c => `${c.sha}:${VERSION_SCRIPT}`).join('\n') + '\n',
      )
        .split('\n')
        .filter(Boolean);
      const blobOf = new Map();
      commits.forEach((c, i) => {
        const [id, type] = blobs[i].split(' ');
        blobOf.set(c.sha, type === 'blob' ? id : null);
      });
      const offsetByBlob = new Map();
      index = buildIndex(counts, sha => {
        const id = blobOf.get(sha);
        if (!id) return null;
        if (!offsetByBlob.has(id))
          offsetByBlob.set(
            id,
            parseVersionCodeOffset(git(['cat-file', '-p', id])),
          );
        return offsetByBlob.get(id);
      });
    } catch (e) {
      indexError = String(e.message || e)
        .split('\n')[0]
        .slice(0, 200);
    }
  }

  return {
    shallow,
    /** @param {string} rev @returns {?string} the full sha, or null when it is not in this clone */
    resolve(rev) {
      try {
        return (
          git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim() ||
          null
        );
      } catch {
        return null;
      }
    },
    /** Put a commit (and its history) into the index. Call before `candidates()`. */
    addRev(sha) {
      if (!index && !indexError) extra.push(sha);
    },
    /** @param {number} b @returns {?string[]} null when the index failed (see `indexError`) */
    candidates(b) {
      build();
      return index ? index.get(Number(b)) || [] : null;
    },
    get indexError() {
      return indexError;
    },
    /** `git merge-base --is-ancestor a b` */
    isAncestor(a, b) {
      try {
        git(['merge-base', '--is-ancestor', a, b]);
        return true;
      } catch (e) {
        if (e.status === 1) return false;
        throw e;
      }
    },
  };
}

/**
 * The production commit for a production build.
 * @param {{build:number, sha?:?string}} target `sha` from the rollout file or --sha
 * @param {ReturnType<typeof gitBuildLines>} lines
 * @returns {{build:number, commit:?string, why:string}}
 */
export function resolveProduction(target, lines) {
  const build = Number(target.build);
  if (lines.shallow)
    return {
      build,
      commit: null,
      why: 'shallow clone — run prod-close on a full checkout (the Mac loop)',
    };
  if (target.sha) {
    const commit = lines.resolve(target.sha);
    if (!commit)
      return {
        build,
        commit: null,
        why: `recorded commit ${target.sha} is not in this clone (git fetch first)`,
      };
    lines.addRev(commit);
    return {build, commit, why: `recorded commit ${short(commit)}`};
  }
  const c = lines.candidates(build);
  if (!c)
    return {
      build,
      commit: null,
      why: `cannot map builds to commits: ${lines.indexError}`,
    };
  if (c.length === 1)
    return {build, commit: c[0], why: `the one commit that derives ${build}`};
  if (!c.length)
    return {
      build,
      commit: null,
      why: `no published commit derives build ${build} — pass --sha=<commit>`,
    };
  return {
    build,
    commit: null,
    why: `${c.length} commits derive build ${build} (${list(c)}) — record the build commit (rollout \`sha\`, or --sha)`,
  };
}
