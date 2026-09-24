import {createMMKV, type MMKV} from 'react-native-mmkv';

const SCHEMA_VERSION = 2;

export interface QCFPageLayoutMetrics {
  /**
   * Width (at `REF_FONT_SIZE`) of the line the page font is calibrated
   * against. Deliberately orientation-independent: the render font size is
   * derived from this and the LIVE content width at render time. Caching a
   * concrete `fontSize` here would be wrong, because the cache key is
   * `(fontFamily, pageNumber)` only — a page measured in portrait would
   * hand a portrait font size back to a landscape render.
   */
  widestRef: number;
  lineWidthsAtRef: Array<{
    lineIndex: number;
    width: number;
  }>;
}

function mmkvKey(fontFamily: string, pageNumber: number): string {
  return `qcf:${fontFamily}:${pageNumber}`;
}

class QCFLayoutCacheService {
  private mmkv: MMKV;
  private memCache = new Map<string, QCFPageLayoutMetrics>();

  constructor() {
    this.mmkv = createMMKV({id: 'qcf-layouts'});

    const storedVersion = this.mmkv.getNumber('qcf_schema_version');
    if (storedVersion !== SCHEMA_VERSION) {
      this.mmkv.clearAll();
      this.mmkv.set('qcf_schema_version', SCHEMA_VERSION);
    }
  }

  getPageLayout(
    pageNumber: number,
    fontFamily: string,
  ): QCFPageLayoutMetrics | undefined {
    const key = mmkvKey(fontFamily, pageNumber);
    const memHit = this.memCache.get(key);
    if (memHit) return memHit;

    const json = this.mmkv.getString(key);
    if (!json) return undefined;

    try {
      const parsed = JSON.parse(json) as QCFPageLayoutMetrics;
      if (
        !parsed ||
        !(parsed.widestRef > 0) || // a 0/NaN/non-number ref is a failed measurement, not a layout
        !Array.isArray(parsed.lineWidthsAtRef) ||
        parsed.lineWidthsAtRef.length === 0
      ) {
        return undefined;
      }
      this.memCache.set(key, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  setPageLayout(
    pageNumber: number,
    fontFamily: string,
    data: QCFPageLayoutMetrics,
  ): void {
    const key = mmkvKey(fontFamily, pageNumber);
    this.memCache.set(key, data);
    this.mmkv.set(key, JSON.stringify(data));
  }

  clearAll(): void {
    this.memCache.clear();
    this.mmkv.clearAll();
    this.mmkv.set('qcf_schema_version', SCHEMA_VERSION);
  }
}

export const qcfLayoutCacheService = new QCFLayoutCacheService();
