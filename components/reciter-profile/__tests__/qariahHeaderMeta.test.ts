// @ai-generated
// Qariah (TECH_DEBT #306): the reciter header shows each count once. The
// Qariah parts go into upstream's meta row (qariahHeaderMeta.ts).
import type {Reciter} from '@/data/reciterData';
import {qariahNarrationLine, qariahRecitationsCount} from '../qariahHeaderMeta';

type Rewayah = Reciter['rewayat'][number];

function rewayah(name: string): Rewayah {
  return {name} as Rewayah;
}

describe('qariahRecitationsCount', () => {
  it('is null when it equals the surah count that upstream already shows', () => {
    expect(qariahRecitationsCount(45, 45)).toBeNull();
  });

  it('is the count when it differs from the surah count', () => {
    expect(qariahRecitationsCount(52, 45)).toBe(52);
  });

  it('is null without a positive count', () => {
    expect(qariahRecitationsCount(null, 45)).toBeNull();
    expect(qariahRecitationsCount(undefined, 45)).toBeNull();
    expect(qariahRecitationsCount(0, 45)).toBeNull();
  });

  it('is null for every reciter in the bundled catalog today', () => {
    const catalog: Reciter[] = require('../../../assets/data/catalog.json');
    for (const reciter of catalog) {
      const surahs = new Set<number>();
      for (const r of reciter.rewayat) {
        for (const id of r.surah_list) if (id != null) surahs.add(id);
      }
      expect(
        qariahRecitationsCount(reciter.recitationsCount, surahs.size),
      ).toBe(null);
    }
  });
});

describe('qariahNarrationLine', () => {
  const label = (r: Rewayah) => r.name.toUpperCase();

  it('lists two or more narrations, in catalog order', () => {
    expect(
      qariahNarrationLine([rewayah('hafs'), rewayah('warsh')], label),
    ).toBe('HAFS · WARSH');
  });

  it('is null for one narration', () => {
    expect(qariahNarrationLine([rewayah('hafs')], label)).toBeNull();
  });

  it('skips a narration with no name', () => {
    expect(
      qariahNarrationLine([rewayah('hafs'), rewayah('')], label),
    ).toBeNull();
  });
});
