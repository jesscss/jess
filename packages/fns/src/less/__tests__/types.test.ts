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

    expect(iscolor(color).data).toBe(true);
    expect(isnumber(px).data).toBe(true);
    expect(isstring(quoted).data).toBe(true);
    expect(iskeyword(keyword).data).toBe(true);
    expect(iskeyword(ident).data).toBe(true);
    expect(isurl(url).data).toBe(true);
    expect(ispixel(px).data).toBe(true);
    expect(ispercentage(pct).data).toBe(true);
    expect(isem(em).data).toBe(true);
    expect(isunit(px, new Quoted('PX')).data).toBe(true);
    expect(isunit(px, new Quoted('em')).data).toBe(false);
    expect(isunit(keyword, new Quoted('px')).data).toBe(false);
  });
});
