// @ai-start
// @ai Qariah (Pass C, Sprint 47): the cache keeps Qariah's `widestRef` shape
// (GH #364) under upstream's content-width key, at schema 3.

const mockData = new Map<string, string | number>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getNumber: (key: string) => mockData.get(key),
    getString: (key: string) => mockData.get(key),
    set: (key: string, value: string | number) => mockData.set(key, value),
    clearAll: () => mockData.clear(),
  }),
}));

const {qcfLayoutCacheService} = require('../QCFLayoutCacheService');

describe('QCF layout cache', () => {
  beforeEach(() => qcfLayoutCacheService.clearAll());

  it('keeps page sizes and font variants separate when the reader resizes', () => {
    const phone = {
      widestRef: 1200,
      lineWidthsAtRef: [{lineIndex: 0, width: 1200}],
    };
    const tablet = {...phone, widestRef: 1100};
    qcfLayoutCacheService.setPageLayout(3, 'p3-v4', 320, phone);
    qcfLayoutCacheService.setPageLayout(3, 'p3-v4', 512, tablet);

    expect(qcfLayoutCacheService.getPageLayout(3, 'p3-v4', 320)).toEqual(phone);
    expect(qcfLayoutCacheService.getPageLayout(3, 'p3-v4', 512)).toEqual(
      tablet,
    );
    expect(
      qcfLayoutCacheService.getPageLayout(3, 'p3-v2', 320),
    ).toBeUndefined();
    expect(
      qcfLayoutCacheService.getPageLayout(3, 'p3-v4-dark', 320),
    ).toBeUndefined();
    expect(
      qcfLayoutCacheService.getPageLayout(3, 'p3-v4', 640),
    ).toBeUndefined();

    jest.isolateModules(() => {
      const restored =
        require('../QCFLayoutCacheService').qcfLayoutCacheService;
      expect(restored.getPageLayout(3, 'p3-v4', 320)).toEqual(phone);
      expect(restored.getPageLayout(3, 'p3-v4', 512)).toEqual(tablet);
    });
  });

  it('drops layouts saved before page width was included in the key', () => {
    mockData.set('qcf_schema_version', 1);
    mockData.set('qcf:p3-v4:3', '{"fontSize":90}');
    jest.isolateModules(() => {
      require('../QCFLayoutCacheService');
      expect(mockData.has('qcf:p3-v4:3')).toBe(false);
      expect(mockData.get('qcf_schema_version')).toBe(3);
    });
  });
});
// @ai-end
