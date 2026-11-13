// @ai-generated
// Qariah (#847): the pure coverage helpers of the "Follow Along" chip and row.
import {
  listFollowAlongSurahs,
  parseFollowAlongPreview,
  resolveFollowAlongPreview,
  withFollowAlongPreview,
  type SurahCoverage,
} from '../followAlongCoverage';

const none: SurahCoverage = () => false;
const all: SurahCoverage = () => true;

describe('listFollowAlongSurahs', () => {
  it('keeps the listed surahs that the rule accepts, in list order', () => {
    const covers: SurahCoverage = (_id, surah) => surah % 2 === 0;
    expect(
      listFollowAlongSurahs({id: 'rw', surah_list: [10, 3, 4, 7, 2]}, covers),
    ).toEqual([10, 4, 2]);
  });

  it('passes the rewayah id to the rule', () => {
    const covers = jest.fn((id: string) => id === 'rw-a');
    expect(
      listFollowAlongSurahs({id: 'rw-a', surah_list: [1]}, covers),
    ).toEqual([1]);
    expect(
      listFollowAlongSurahs({id: 'rw-b', surah_list: [1]}, covers),
    ).toEqual([]);
    expect(covers).toHaveBeenCalledWith('rw-a', 1);
  });

  it('leaves out nulls, non-integers and repeats', () => {
    expect(
      listFollowAlongSurahs(
        {id: 'rw', surah_list: [1, null, 1.5, 2, 1, NaN] as (number | null)[]},
        all,
      ),
    ).toEqual([1, 2]);
  });

  it('gives nothing for a missing list, a bad rewayah, or a rule that says no', () => {
    expect(
      listFollowAlongSurahs({id: 'rw'} as {id: string; surah_list: []}, all),
    ).toEqual([]);
    expect(
      listFollowAlongSurahs(
        null as unknown as {id: string; surah_list: number[]},
        all,
      ),
    ).toEqual([]);
    expect(listFollowAlongSurahs({id: 'rw', surah_list: [1, 2]}, none)).toEqual(
      [],
    );
  });
});

describe('the test preview', () => {
  it('reads "<rewayahId>:<surah>,<surah>" entries joined by ";"', () => {
    const preview = parseFollowAlongPreview(' rw-a:1, 36 ;rw-b:50;;bad;rw-c:');
    expect([...preview.keys()]).toEqual(['rw-a', 'rw-b']);
    expect([...(preview.get('rw-a') ?? [])]).toEqual([1, 36]);
    expect([...(preview.get('rw-b') ?? [])]).toEqual([50]);
  });

  it('leaves out a surah number outside 1–114', () => {
    const preview = parseFollowAlongPreview('rw:0,115,x,114');
    expect([...(preview.get('rw') ?? [])]).toEqual([114]);
  });

  it('works only in a build with no telemetry keys (a lab build, never a store build)', () => {
    expect(resolveFollowAlongPreview({preview: 'rw:1'}).size).toBe(1);
    expect(
      resolveFollowAlongPreview({
        preview: 'rw:1',
        sentryDsn: 'https://key@o1.ingest.example/1',
      }).size,
    ).toBe(0);
    expect(
      resolveFollowAlongPreview({preview: 'rw:1', posthogKey: 'phc_x'}).size,
    ).toBe(0);
    expect(resolveFollowAlongPreview({}).size).toBe(0);
  });

  it('adds the preview surahs to the rule, and changes nothing without a preview', () => {
    const base: SurahCoverage = (id, surah) => id === 'rw-real' && surah === 2;
    expect(withFollowAlongPreview(base, new Map())).toBe(base);
    const covers = withFollowAlongPreview(
      base,
      parseFollowAlongPreview('rw-test:5'),
    );
    expect(covers('rw-test', 5)).toBe(true);
    expect(covers('rw-test', 6)).toBe(false);
    expect(covers('rw-real', 2)).toBe(true);
  });
});
