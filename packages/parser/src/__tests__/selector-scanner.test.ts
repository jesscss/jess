import { describe, expect, test } from 'vitest';
import {
  scanCheapSelectorComponents,
  scanCheapSelectorListComponents
} from '../selector-scanner.js';

describe('selector scanner helpers', () => {
  test('tokenizes cheap compound and complex selectors without node objects', () => {
    expect(scanCheapSelectorComponents('#id.card')).toEqual([['#id', '.card']]);
    expect(scanCheapSelectorComponents('.a:hover::before')).toEqual([['.a', ':hover', '::before']]);
    expect(scanCheapSelectorComponents('[data-x].a')).toEqual([['[data-x]', '.a']]);
    expect(scanCheapSelectorComponents('.a[data-x=\"{\"].b')).toEqual([['.a', '[data-x="{"]', '.b']]);
    expect(scanCheapSelectorComponents('[data-x = \"y\" i]')).toEqual([['[data-x = "y" i]']]);
    expect(scanCheapSelectorComponents('[data-x = \"y\"]')).toEqual([['[data-x = "y"]']]);
    expect(scanCheapSelectorComponents('[data-x=foo-bar s]')).toEqual([['[data-x=foo-bar s]']]);
    expect(scanCheapSelectorComponents('[*|href]')).toEqual([['[*|href]']]);
    expect(scanCheapSelectorComponents('[svg|href]')).toEqual([['[svg|href]']]);
    expect(scanCheapSelectorComponents('[|href]')).toEqual([['[|href]']]);
    expect(scanCheapSelectorComponents('.æøå > :root')).toEqual([['.æøå'], '>', [':root']]);
    expect(scanCheapSelectorComponents('.a > .b + div')).toEqual([['.a'], '>', ['.b'], '+', ['div']]);
    expect(scanCheapSelectorComponents('.a .b')).toEqual([['.a'], ' ', ['.b']]);
  });

  test('rejects selector structures outside the cheap scanner subset', () => {
    expect(scanCheapSelectorComponents('.a:hover(.b)')).toBeUndefined();
    expect(scanCheapSelectorComponents(':lang(no)')).toBeUndefined();
    expect(scanCheapSelectorComponents('[]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[=x]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data x]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data-x=]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[*]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[|]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[||]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data||x]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data=x=y]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data=foo)]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data=foo(]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data=foo#]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data=-]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data=foo.bar]')).toBeUndefined();
    expect(scanCheapSelectorComponents('[data-x')).toBeUndefined();
    expect(scanCheapSelectorComponents('.a >')).toBeUndefined();
    expect(scanCheapSelectorComponents('.a, .b')).toBeUndefined();
  });

  test('splits cheap selector lists without materializing node objects', () => {
    expect(scanCheapSelectorListComponents('h1, h2 > a > p, h3')).toEqual([
      [['h1']],
      [['h2'], '>', ['a'], '>', ['p']],
      [['h3']]
    ]);
    expect(scanCheapSelectorListComponents('.a[data-x=","], .b')).toEqual([
      [['.a', '[data-x=","]']],
      [['.b']]
    ]);
    expect(scanCheapSelectorListComponents('.a /* before comma */, /* after comma */ .b')).toEqual([
      [['.a']],
      [['.b']]
    ]);
    expect(scanCheapSelectorListComponents('.a, // after comma\n.b', { lineComments: true })).toEqual([
      [['.a']],
      [['.b']]
    ]);
    expect(scanCheapSelectorListComponents('.a // before comma\n, [data-x="//"]', { lineComments: true })).toEqual([
      [['.a']],
      [['[data-x="//"]']]
    ]);
  });

  test('rejects empty selector-list branches', () => {
    expect(scanCheapSelectorListComponents('.a,')).toBeUndefined();
    expect(scanCheapSelectorListComponents('.a,   ')).toBeUndefined();
    expect(scanCheapSelectorListComponents(',.a')).toBeUndefined();
    expect(scanCheapSelectorListComponents('.a,,.b')).toBeUndefined();
  });
});
