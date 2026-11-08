// @ai GitHub #731: the "Share as Image" PNG carried the upstream file name
// (`bayaan-share.png`), and the iOS share sheet showed it as the title. The
// capture now reads the name from config/branding.js.
import {captureShareCard} from '../captureShareCard';
import branding from '@/config/branding';

const mockWriteAsStringAsync = jest.fn(
  async (..._args: unknown[]) => undefined,
);

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: {Base64: 'base64'},
  writeAsStringAsync: (...args: unknown[]) => mockWriteAsStringAsync(...args),
}));

jest.mock('@shopify/react-native-skia', () => ({
  ImageFormat: {PNG: 'png'},
}));

function canvasRef(base64: string | null) {
  return {
    current:
      base64 === null
        ? null
        : {
            makeImageSnapshot: () => ({
              encodeToBase64: () => base64,
            }),
          },
  } as unknown as React.RefObject<
    import('@shopify/react-native-skia').CanvasRef | null
  >;
}

describe('captureShareCard', () => {
  beforeEach(() => mockWriteAsStringAsync.mockClear());

  it('writes the PNG under the branded file name, not the upstream one', async () => {
    const uri = await captureShareCard(canvasRef('QUJD'));

    expect(uri).toBe(`file:///cache/${branding.shareImageFileName}`);
    expect(uri).toBe('file:///cache/qariah-share.png');
    expect(uri).not.toMatch(/bayaan/i);
    expect(mockWriteAsStringAsync).toHaveBeenCalledWith(uri, 'QUJD', {
      encoding: 'base64',
    });
  });

  it('throws when the canvas has no snapshot', async () => {
    await expect(captureShareCard(canvasRef(null))).rejects.toThrow(
      'Failed to capture share card image',
    );
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
  });
});
