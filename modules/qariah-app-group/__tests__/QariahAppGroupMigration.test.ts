// @ai Qariah (TECH_DEBT #289): the one-time App Group move is native code,
// because it must run before React Native opens the MMKV files. This test
// compiles QariahAppGroupMigration.swift with the case file test/main.swift
// (swiftc) and runs the cases in a temporary folder. It needs macOS with
// Xcode; on other machines (Linux CI) it is skipped.

import {execFileSync, spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MODULE_DIR = path.join(__dirname, '..');
const hasSwift =
  process.platform === 'darwin' &&
  spawnSync('xcrun', ['--find', 'swiftc'], {stdio: 'ignore'}).status === 0;

(hasSwift ? describe : describe.skip)(
  'QariahAppGroupMigration (Swift, macOS)',
  () => {
    let dir: string;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qariah-app-group-swift-'));
    });

    afterAll(() => {
      fs.rmSync(dir, {recursive: true, force: true});
    });

    it('passes every case of test/main.swift', () => {
      const binary = path.join(dir, 'migration-cases');
      execFileSync(
        'xcrun',
        [
          'swiftc',
          '-module-cache-path',
          path.join(dir, 'module-cache'),
          '-o',
          binary,
          path.join(MODULE_DIR, 'ios', 'QariahAppGroupMigration.swift'),
          path.join(MODULE_DIR, 'test', 'main.swift'),
        ],
        {stdio: 'pipe', timeout: 240_000},
      );
      const work = path.join(dir, 'containers');
      fs.mkdirSync(work);
      const result = spawnSync(binary, [work], {encoding: 'utf8'});
      expect(result.stdout).not.toMatch(/FAIL/);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/ALL PASS/);
    }, 300_000);
  },
);
