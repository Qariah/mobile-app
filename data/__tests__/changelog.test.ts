// @ai-generated
// Qariah (Sprint 48, S48.8, Task 18): the changelog that Settings → What's New
// shows. Its first entry is the newest release.
import * as semver from 'semver';
import ioniconsGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import changelogData from '../changelog.json';
import type {ChangelogEntry} from '@/types/changelog';

// tsc checks that the JSON fits the type that the What's New screen uses.
const changelog: ChangelogEntry[] = changelogData;

const normalize = (version: string): string =>
  semver.valid(semver.coerce(version)) ?? version;

describe('data/changelog.json', () => {
  it('starts with the draft 3.3.0 entry', () => {
    const [latest] = changelog;
    expect(latest.version).toBe('3.3.0');
    expect(latest.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(latest.title.length).toBeGreaterThan(0);
    expect(latest.highlights.length).toBeGreaterThanOrEqual(3);
    expect(latest.highlights.length).toBeLessThanOrEqual(4);
    expect(latest.fullChangelog?.features?.length).toBeGreaterThan(0);
    expect(latest.fullChangelog?.improvements?.length).toBeGreaterThan(0);
    expect(latest.fullChangelog?.fixes?.length).toBeGreaterThan(0);
  });

  it('lists the newest release first', () => {
    const versions = changelog.map(entry => normalize(entry.version));
    const sorted = [...versions].sort(semver.rcompare);
    expect(versions).toEqual(sorted);
  });

  it('gives each highlight a title, a text and an Ionicons name', () => {
    for (const entry of changelog) {
      for (const highlight of entry.highlights) {
        expect(typeof highlight.title).toBe('string');
        expect(highlight.title.length).toBeGreaterThan(0);
        expect(highlight.description.length).toBeGreaterThan(0);
        expect({
          version: entry.version,
          icon: highlight.icon,
          known: highlight.icon in ioniconsGlyphs,
        }).toEqual({version: entry.version, icon: highlight.icon, known: true});
      }
    }
  });
});
