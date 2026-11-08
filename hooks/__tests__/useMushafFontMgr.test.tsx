/**
 * The Mushaf font manager: the hook loads no fonts and only follows the
 * service. MushafPreloadService.fonts.test.ts covers a failed load.
 */

import React, {act} from 'react';
import TestRenderer from 'react-test-renderer';

type Listener = () => void;
type FontMgr = object | null;

const mockService = {
  fontMgr: null as FontMgr,
  listeners: new Set<Listener>(),
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },
  publish(fontMgr: FontMgr) {
    this.fontMgr = fontMgr;
    for (const listener of this.listeners) listener();
  },
};

const mockFromURI = jest.fn();

jest.mock('@/services/mushaf/MushafPreloadService', () => ({
  get mushafPreloadService() {
    return mockService;
  },
}));

jest.mock('@shopify/react-native-skia', () => ({
  Skia: {Data: {fromURI: (uri: string) => mockFromURI(uri)}},
}));

import {useMushafFontMgr} from '../useMushafFontMgr';

declare const global: {IS_REACT_ACT_ENVIRONMENT?: boolean};
global.IS_REACT_ACT_ENVIRONMENT = true;

function mount() {
  const probe = {current: null as FontMgr, renders: 0};
  function Probe(): null {
    probe.current = useMushafFontMgr();
    probe.renders += 1;
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe />);
  });
  return {
    probe,
    unmount: () =>
      act(() => {
        renderer.unmount();
      }),
  };
}

describe('useMushafFontMgr', () => {
  beforeEach(() => {
    mockService.fontMgr = null;
    mockService.listeners.clear();
    mockFromURI.mockReset();
    // react-test-renderer prints a deprecation notice under React 19.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is null until the service publishes, then gives every caller the provider', () => {
    const first = mount();
    expect(first.probe.current).toBeNull();

    const provider = {name: 'preloaded'};
    act(() => mockService.publish(provider));
    const second = mount();

    expect(first.probe.current).toBe(provider);
    expect(second.probe.current).toBe(provider);
  });

  it('does not render a caller again on a repeat notification', () => {
    mockService.fontMgr = {name: 'preloaded'};

    const {probe} = mount();
    act(() => mockService.publish(mockService.fontMgr));

    expect(probe.renders).toBe(1);
  });

  it('loads no fonts, also while the service has no provider', () => {
    const callers = [mount(), mount(), mount()];
    act(() => mockService.publish(null));

    expect(callers.map(caller => caller.probe.current)).toEqual([
      null,
      null,
      null,
    ]);
    expect(mockFromURI).not.toHaveBeenCalled();
  });

  it('stops listening after an unmount', () => {
    const {unmount} = mount();
    expect(mockService.listeners.size).toBe(1);

    unmount();
    expect(mockService.listeners.size).toBe(0);
  });
});
