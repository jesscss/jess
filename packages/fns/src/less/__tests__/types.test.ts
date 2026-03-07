import { describe, it, expect } from 'vitest';
import { Any, Color, Dimension, Quoted, Url } from '@jesscss/core';
import {
  iscolor,
  isem,
  iskeyword,
  isnumber,
  ispercentage,
  ispixel,
  isstring,
  isunit,
  isurl
} from '../types.js';

describe('types()', () => {
  it('checks node categories and units', () => {
    const quoted = new Quoted('hello');
    const keyword = new Any('screen', { role: 'keyword' });
    const ident = new Any('solid', { role: 'ident' });
    const px = new Dimension({ number: 3, unit: 'px' });
    const em = new Dimension({ number: 3, unit: 'em' });
    const pct = new Dimension({ number: 3, unit: '%' });
    const color = new Color('#ff0000');
    const url = new Url(new Quoted('/foo.png'));

    expect(iscolor(color).value).toBe(true);
    expect(isnumber(px).value).toBe(true);
    expect(isstring(quoted).value).toBe(true);
    expect(iskeyword(keyword).value).toBe(true);
    expect(iskeyword(ident).value).toBe(true);
    expect(isurl(url).value).toBe(true);
    expect(ispixel(px).value).toBe(true);
    expect(ispercentage(pct).value).toBe(true);
    expect(isem(em).value).toBe(true);
    expect(isunit(px, new Quoted('PX')).value).toBe(true);
    expect(isunit(px, new Quoted('em')).value).toBe(false);
    expect(isunit(keyword, new Quoted('px')).value).toBe(false);
  });
});
