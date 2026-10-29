// @ai-generated
// Qariah (TECH_DEBT #346): scripts/verify-catalog-urls.ts checks the URL that
// the app plays. A partial upload with `audio_path: 'suffixed'` is at its
// suffixed file; every other row keeps the legacy file name.
import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {Rewayat, SurahMetadata} from '../../data/reciterData';
import {recitationAudioUrl} from '../../utils/recitationAudioUrl';
import {catalogAudioUrl, serverProblem} from '../lib/catalog-audio-url';

const root = path.resolve(__dirname, '../..');
const SERVER = 'https://cdn.example/reciters/x/hafs';

function rewaya(
  surah_metadata?: SurahMetadata[],
  server = SERVER,
): Pick<Rewayat, 'server' | 'surah_metadata'> {
  return {server, surah_metadata};
}

// Surah 2: a suffixed partial (the ops console upload). Surah 18: a legacy
// partial (no audio_path). Surah 114: a complete row.
const METADATA: SurahMetadata[] = [
  {surah: 2, is_full: false, range: {from: 1, to: 16}, audio_path: 'suffixed'},
  {surah: 18, is_full: false, range: {from: 1, to: 10}},
  {surah: 114, is_full: true},
];

describe('catalogAudioUrl', () => {
  it('checks a suffixed partial upload at its suffixed file', () => {
    expect(catalogAudioUrl(rewaya(METADATA), 2)).toBe(`${SERVER}/002-1-16.mp3`);
  });

  it('keeps the legacy file for a legacy partial (no audio_path)', () => {
    expect(catalogAudioUrl(rewaya(METADATA), 18)).toBe(`${SERVER}/018.mp3`);
  });

  it('keeps the legacy file for a complete surah and for a row with no metadata', () => {
    expect(catalogAudioUrl(rewaya(METADATA), 114)).toBe(`${SERVER}/114.mp3`);
    expect(catalogAudioUrl(rewaya(), 1)).toBe(`${SERVER}/001.mp3`);
  });

  it('accepts a server with a trailing slash, as the old verifier did', () => {
    expect(catalogAudioUrl(rewaya(METADATA, `${SERVER}/`), 2)).toBe(
      `${SERVER}/002-1-16.mp3`,
    );
    expect(catalogAudioUrl(rewaya(undefined, `${SERVER}/`), 1)).toBe(
      `${SERVER}/001.mp3`,
    );
  });

  it('gives the legacy file when the suffixed range is bad', () => {
    const bad: SurahMetadata[] = [
      {
        surah: 2,
        is_full: false,
        range: {from: 9, to: 3},
        audio_path: 'suffixed',
      },
    ];
    expect(catalogAudioUrl(rewaya(bad), 2)).toBe(`${SERVER}/002.mp3`);
  });

  it('gives the URL of the app builder for every listed surah of the bundled catalog', () => {
    const catalog = JSON.parse(
      fs.readFileSync(path.join(root, 'assets/data/catalog.json'), 'utf8'),
    ) as {rewayat?: Rewayat[]}[];
    let checked = 0;
    for (const reciter of catalog) {
      for (const rw of reciter.rewayat ?? []) {
        for (const surah of rw.surah_list ?? []) {
          if (typeof surah !== 'number') continue;
          expect(catalogAudioUrl(rw, surah)).toBe(
            recitationAudioUrl(rw, surah),
          );
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('serverProblem', () => {
  it('is null for a server without a final slash', () => {
    expect(serverProblem({server: SERVER})).toBeNull();
  });

  it('calls a final slash a warning (the app requests server//018.mp3)', () => {
    expect(serverProblem({server: `${SERVER}/`})).toBe('final-slash');
  });

  it('calls an absent, empty, blank or non-string server missing', () => {
    expect(serverProblem({})).toBe('missing');
    expect(serverProblem({server: ''})).toBe('missing');
    expect(serverProblem({server: '  '})).toBe('missing');
    expect(serverProblem({server: 7 as unknown as string})).toBe('missing');
    expect(serverProblem(null)).toBe('missing');
    expect(serverProblem(undefined)).toBe('missing');
  });

  it('makes catalogAudioUrl throw a clear error for a missing server', () => {
    expect(() =>
      catalogAudioUrl({} as Pick<Rewayat, 'server' | 'surah_metadata'>, 1),
    ).toThrow('the row has no server URL');
  });
});

describe('scripts/verify-catalog-urls.ts', () => {
  const source = fs.readFileSync(
    path.join(root, 'scripts/verify-catalog-urls.ts'),
    'utf8',
  );

  it('builds each URL with catalogAudioUrl and not with its own template', () => {
    expect(source).toContain('catalogAudioUrl(rewayat, surah)');
    expect(source).not.toMatch(/\$\{pad3\([^)]*\)\}\.mp3/);
  });

  // A run of the real script on a local catalog. The host refuses the
  // connection at once, so no request leaves this machine.
  it('fails a row with no server alone, and warns for a final slash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-catalog-'));
    try {
      const file = path.join(dir, 'catalog.json');
      fs.writeFileSync(
        file,
        JSON.stringify([
          {
            name: 'Probe',
            rewayat: [
              {name: 'No server', surah_list: [1]},
              {
                name: 'Final slash',
                server: 'http://127.0.0.1:9/x/',
                surah_list: [18],
              },
              {name: 'Plain', server: 'http://127.0.0.1:9/y', surah_list: [2]},
            ],
          },
        ]),
      );
      const run = spawnSync(
        process.execPath,
        [
          path.join(root, 'node_modules/tsx/dist/cli.mjs'),
          path.join(root, 'scripts/verify-catalog-urls.ts'),
          '--catalog',
          file,
          '--fast',
          '--no-sniff',
        ],
        {encoding: 'utf8', timeout: 60000},
      );
      const out = `${run.stdout}${run.stderr}`;
      // Exit 1 = failures present. Exit 2 would be the TypeError of one row ending the run.
      expect(run.status).toBe(1);
      expect(out).not.toMatch(/Fatal|TypeError/);
      expect(out).toContain('✗ Probe · No server → no server URL');
      expect(out).toMatch(
        /⚠ Probe · Final slash: server "http:\/\/127\.0\.0\.1:9\/x\/" ends with "\/"/,
      );
      expect(out).toContain('Warnings: 1');
      // The other two rows were still checked (their host refuses the connection).
      expect(out).toContain('http://127.0.0.1:9/x/018.mp3 → ');
      expect(out).toContain('http://127.0.0.1:9/y/002.mp3 → ');
      expect(out).toContain('Failed: 3 / 3');
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
