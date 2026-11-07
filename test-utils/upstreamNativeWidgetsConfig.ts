/**
 * Qariah-only test helper: upstream Bayaan's native widget list (RFC-021).
 *
 * Bayaan ships every widget surface (`widgets: undefined`). Qariah ships a
 * core set only (config/nativeWidgets.config.js, owner decision O5,
 * 2026-10-18). An upstream suite that pins Bayaan's full widget set mocks
 * the config with this module, so the inherited code path stays under test:
 *
 *   jest.mock('@/config/nativeWidgets.config', () =>
 *     jest.requireActual('@/test-utils/upstreamNativeWidgetsConfig'),
 *   );
 *
 * config/__tests__/nativeWidgets.qariah.test.ts asserts Qariah's own list.
 */
import type {NativeWidgetsConfig} from '@/config/nativeWidgets.config';

const upstreamNativeWidgetsConfig: NativeWidgetsConfig = {widgets: undefined};

export default upstreamNativeWidgetsConfig;
