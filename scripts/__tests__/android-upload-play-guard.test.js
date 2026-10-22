// @ai
//
// scripts/android-upload-play.sh must never send a production build to 100% of
// users by default. Before PR #529, the qariah-main copy sent `completed` for
// every track. These tests run only the argument checks. Every case uses an
// AAB path that does not exist. So the script stops before it reads a secret
// or calls Google Play.

const {spawnSync} = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'android-upload-play.sh');
const NO_AAB = path.join(__dirname, 'no-such-dir', 'missing.aab');
const ARCHIVE = path.join(__dirname, '..', 'android-archive.sh');
// android-archive.sh refuses to run from a shell in another checkout, so run
// both scripts from this repository's root.
const REPO_ROOT = path.join(__dirname, '..', '..');

function run(script, args) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    cwd: REPO_ROOT,
  });
  // The script wraps each message in ANSI colour codes. Each assertion below
  // checks a substring inside one message, so the codes do not interfere.
  return {status: r.status, out: `${r.stdout}${r.stderr}`};
}

describe('android-upload-play.sh argument guard', () => {
  it('refuses --track=production without an explicit --status', () => {
    const {status, out} = run(SCRIPT, ['--track=production', NO_AAB]);
    expect(status).toBe(1);
    expect(out).toContain('--track=production requires an explicit --status');
  });

  it('refuses --status=halted and points to the Play Console', () => {
    const {status, out} = run(SCRIPT, [
      '--track=production',
      '--status=halted',
      NO_AAB,
    ]);
    expect(status).toBe(1);
    expect(out).toContain('Invalid --status: halted');
    expect(out).toContain('Play Console');
  });

  it('refuses a staged rollout without a fraction', () => {
    const {status, out} = run(SCRIPT, [
      '--track=production',
      '--status=inProgress',
      NO_AAB,
    ]);
    expect(status).toBe(1);
    expect(out).toContain('requires --user-fraction');
  });

  it.each([
    '20',
    '1.0',
    '1',
    '0',
    '0.0',
    'abc',
    '0.01, "status": "completed"',
    '0.5\n{"x":1}',
    '0.99999999999999999999',
    '0.12345',
    '0.0000',
  ])('refuses the fraction %p', fraction => {
    const {status, out} = run(SCRIPT, [
      '--track=production',
      '--status=inProgress',
      `--user-fraction=${fraction}`,
      NO_AAB,
    ]);
    expect(status).toBe(1);
    expect(out).toContain('--user-fraction must be a decimal between 0 and 1');
  });

  it('refuses a staged rollout on the internal track', () => {
    const {status, out} = run(SCRIPT, [
      '--track=internal',
      '--status=inProgress',
      '--user-fraction=0.1',
      NO_AAB,
    ]);
    expect(status).toBe(1);
    expect(out).toContain('not valid on the internal track');
  });

  it('refuses a fraction without --status=inProgress', () => {
    const {status, out} = run(SCRIPT, [
      '--track=production',
      '--status=draft',
      '--user-fraction=0.1',
      NO_AAB,
    ]);
    expect(status).toBe(1);
    expect(out).toContain('only valid with --status=inProgress');
  });

  it.each([
    [['--track=production', '--status=draft']],
    [['--track=production', '--status=inProgress', '--user-fraction=0.2']],
    [['--track=production', '--status=inProgress', '--user-fraction=.05']],
    [['--track=production', '--status=inProgress', '--user-fraction=0.50']],
    [['--track=production', '--status=inProgress', '--user-fraction=0.10']],
    [['--track=production', '--status=inProgress', '--user-fraction=0.0001']],
    [['--track=internal']],
  ])('passes the guard for %p (stops at the missing AAB)', args => {
    const {status, out} = run(SCRIPT, [...args, NO_AAB]);
    expect(status).toBe(1);
    expect(out).toContain('AAB not found');
  });

  it('--help prints the production warning', () => {
    const {status, out} = run(SCRIPT, ['--help']);
    expect(status).toBe(0);
    expect(out).toContain('REQUIRED');
    expect(out).toContain('Manage rollout');
  });
});

describe('android-upload-play.sh live-rollout check', () => {
  // The jq filter that finds a live staged rollout, read from the script, run
  // on sample track JSON. The script refuses a production upload when it
  // prints anything.
  const filter = require('fs')
    .readFileSync(SCRIPT, 'utf8')
    .match(/^LIVE_STAGED_JQ='(.+)'$/m)[1];
  const live = track => {
    const r = spawnSync('jq', ['-r', filter], {
      input: JSON.stringify(track),
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    return r.stdout.trim();
  };

  it('finds an inProgress release', () => {
    expect(
      live({
        track: 'production',
        releases: [
          {versionCodes: ['2027'], status: 'inProgress', userFraction: 0.2},
          {versionCodes: ['1717'], status: 'completed'},
        ],
      }),
    ).toBe('2027');
  });

  it('blocks an inProgress release with no versionCodes', () => {
    expect(
      live({
        track: 'production',
        releases: [{status: 'inProgress', userFraction: 0.2}],
      }),
    ).toBe('?');
  });

  it('treats an error response as unreadable (the script refuses)', () => {
    const r = spawnSync('jq', ['-e', '.track'], {
      input: JSON.stringify({error: {code: 403, message: 'denied'}}),
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
  });

  it('ignores completed, halted and draft releases', () => {
    expect(
      live({
        track: 'production',
        releases: [
          {versionCodes: ['2027'], status: 'halted'},
          {versionCodes: ['1717'], status: 'completed'},
          {versionCodes: ['2030'], status: 'draft'},
        ],
      }),
    ).toBe('');
  });
});

describe('android-archive.sh --upload guard', () => {
  it('refuses --upload=production before the build starts', () => {
    // --prod with --prelive is a conflict that android-archive.sh refuses
    // before any side effect. If a later edit lets --upload=production
    // through, that check stops the script, and the message check fails.
    const {status, out} = run(ARCHIVE, [
      '--upload=production',
      '--prod',
      '--prelive',
    ]);
    expect(status).toBe(1);
    expect(out).toContain('--upload=production is not supported');
  });
});
