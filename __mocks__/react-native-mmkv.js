// Jest automatically uses node-module mocks placed under a root-level __mocks__
// directory (see the AsyncStorage mock next to this file). react-native-mmkv 4
// loads react-native-nitro-modules when the package is imported, and that
// throws without the native module, before its own Jest mode can run. Qariah's
// diagnostics and analytics modules create MMKV instances at import time, so
// any suite that reaches them (for example upstream's Mushaf screen suites,
// through app/mushaf.tsx) failed to load. This mock returns the package's own
// in-memory test instance. A suite with its own jest.mock factory still wins.
const {
  createMockMMKV,
} = require('react-native-mmkv/lib/createMMKV/createMockMMKV');

module.exports = {
  createMMKV: config => createMockMMKV(config),
  existsMMKV: () => false,
  deleteMMKV: () => false,
};
