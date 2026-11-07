// @ai-generated
import {isolate} from '../qariahBidi';

it('wraps a run in a first-strong isolate', () => {
  expect(isolate('@OKKHALIL3')).toBe('⁨@OKKHALIL3⁩');
});

it('keeps the visible text unchanged', () => {
  expect(isolate('AGPL-3.0').replace(/[⁨⁩]/g, '')).toBe('AGPL-3.0');
});
