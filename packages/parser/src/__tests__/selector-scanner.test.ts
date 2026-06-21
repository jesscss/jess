import { describe, expect, test } from 'vitest';
import { scanCheapSelectorComponents } from '../selector-scanner.js';

describe('selector scanner helpers', () => {
  test('tokenizes cheap compound and complex selectors without node objects', () => {
    expect(scanCheapSelectorComponents('#id.card')).toEqual([['#id', '.card']]);
    expect(scanCheapSelectorComponents('.a > .b + div')).toEqual([['.a'], '>', ['.b'], '+', ['div']]);
    expect(scanCheapSelectorComponents('.a .b')).toEqual([['.a'], ' ', ['.b']]);
  });

  test('rejects selector structures outside the cheap scanner subset', () => {
    expect(scanCheapSelectorComponents('.a:hover')).toBeUndefined();
    expect(scanCheapSelectorComponents('.a >')).toBeUndefined();
    expect(scanCheapSelectorComponents('.a, .b')).toBeUndefined();
  });
});
