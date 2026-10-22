// @ai Qariah (Sprint 46, Pass B story B2): verify-version-sync.js on the
// COMMITTED Xcode project, not on a fixture. scripts/ios-archive.sh runs it as
// the archive pre-flight (and with --fix under VERIFY_FIX=1), so this pins that
// it reads the Qariah app plist and every extension build configuration: the
// share extension and the widget (@bacons/apple-targets, `../targets/` plist),
// Debug and Release. A widget configuration that the check skips would ship
// with a stale CFBundleVersion.
const path = require('path');
const {
  findInfoPlistPath,
  findExtensionConfigBlocks,
} = require('../verify-version-sync');

const ROOT = path.join(__dirname, '..', '..');

describe('verify-version-sync on the committed Qariah project', () => {
  it('reads the app version from ios/Qariah/Info.plist', () => {
    expect(findInfoPlistPath(ROOT)).toBe(
      path.join(ROOT, 'ios', 'Qariah', 'Info.plist'),
    );
  });

  it('checks the share extension and the widget, Debug and Release', () => {
    const {pbxprojPath, blocks} = findExtensionConfigBlocks(ROOT);
    expect(pbxprojPath).toBe(
      path.join(ROOT, 'ios', 'Qariah.xcodeproj', 'project.pbxproj'),
    );
    expect(
      blocks.map(b => `${b.infoPlistRelPath} ${b.configName}`).sort(),
    ).toEqual([
      '../targets/widgets/Info.plist Debug',
      '../targets/widgets/Info.plist Release',
      'ShareExtension/ShareExtension-Info.plist Debug',
      'ShareExtension/ShareExtension-Info.plist Release',
    ]);
  });
});
