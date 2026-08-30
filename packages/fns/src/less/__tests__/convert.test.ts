import { describe, it, expect } from 'vitest';
import { makeDimension, makeKeyword, makeQuoted } from '@jesscss/core';
import { convert } from '../convert.js';

describe('convert()', () => {
  it('converts compatible length, duration, and angle units', () => {
    const cm = convert(makeDimension(1, 'm'), makeQuoted('cm'));
    const ms = convert(makeDimension(2, 's'), makeKeyword('ms'));
    const deg = convert(makeDimension(1, 'turn'), makeQuoted('deg'));

    expect(cm.number).toBe(100);
    expect(cm.unit).toBe('cm');
    expect(ms.number).toBe(2000);
    expect(ms.unit).toBe('ms');
    expect(deg.number).toBe(360);
    expect(deg.unit).toBe('deg');
  });

  it('returns original value for missing/same/incompatible units', () => {
    const noUnit = makeDimension(10);
    const sameUnit = makeDimension(10, 'px');
    const incompatible = makeDimension(10, 'px');

    expect(convert(noUnit, makeQuoted('cm'))).toMatchObject({ number: 10, unit: '' });
    expect(convert(sameUnit, makeQuoted('px'))).toMatchObject({ number: 10, unit: 'px' });
    expect(convert(incompatible, makeQuoted('s'))).toMatchObject({ number: 10, unit: 'px' });
  });
});
