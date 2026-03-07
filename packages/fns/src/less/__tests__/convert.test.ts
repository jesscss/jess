import { describe, it, expect } from 'vitest';
import { Any, Dimension, Quoted } from '@jesscss/core';
import convert from '../convert.js';

describe('convert()', () => {
  it('converts compatible length, duration, and angle units', () => {
    const cm = convert(new Dimension({ number: 1, unit: 'm' }), new Quoted('cm'));
    const ms = convert(new Dimension({ number: 2, unit: 's' }), new Any('ms', { role: 'keyword' }));
    const deg = convert(new Dimension({ number: 1, unit: 'turn' }), new Quoted('deg'));

    expect(cm.value.number).toBe(100);
    expect(cm.value.unit).toBe('cm');
    expect(ms.value.number).toBe(2000);
    expect(ms.value.unit).toBe('ms');
    expect(deg.value.number).toBe(360);
    expect(deg.value.unit).toBe('deg');
  });

  it('returns original value for missing/same/incompatible units', () => {
    const noUnit = new Dimension({ number: 10 });
    const sameUnit = new Dimension({ number: 10, unit: 'px' });
    const incompatible = new Dimension({ number: 10, unit: 'px' });

    expect(convert(noUnit, new Quoted('cm'))).toBe(noUnit);
    expect(convert(sameUnit, new Quoted('px'))).toBe(sameUnit);
    expect(convert(incompatible, new Quoted('s'))).toBe(incompatible);
  });
});
