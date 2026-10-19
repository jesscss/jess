import { describe, it, expect } from 'vitest';
import { invoke, node } from '../../__tests__/harness.js';
import { makeDimension, makeKeyword, makeQuoted } from '@jesscss/core';
import { convert } from '../convert.js';

describe('convert()', () => {
  it('converts compatible length, duration, and angle units', () => {
    const cm = node(invoke(convert, makeDimension(1, 'm'), makeQuoted('cm', '"', false)), 'Dimension');
    const ms = node(invoke(convert, makeDimension(2, 's'), makeKeyword('ms')), 'Dimension');
    const deg = node(invoke(convert, makeDimension(1, 'turn'), makeQuoted('deg', '"', false)), 'Dimension');

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

    expect(invoke(convert, noUnit, makeQuoted('cm', '"', false))).toMatchObject({ number: 10, unit: '' });
    expect(invoke(convert, sameUnit, makeQuoted('px', '"', false))).toMatchObject({ number: 10, unit: 'px' });
    expect(invoke(convert, incompatible, makeQuoted('s', '"', false))).toMatchObject({ number: 10, unit: 'px' });
  });
});
