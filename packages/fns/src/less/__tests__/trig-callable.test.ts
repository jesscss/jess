import { describe, expect, it } from 'vitest';
import { invoke } from '../../__tests__/harness.js';
import { makeDimension } from '@jesscss/core';
import { asin } from '../asin.js';
import { atan } from '../atan.js';
import { sqrt } from '../sqrt.js';
import { sin } from '../sin.js';
import { cos } from '../cos.js';
import { tan } from '../tan.js';
import { pow } from '../pow.js';
import { mod } from '../mod.js';

describe('canonical Less trigonometric callables', () => {
  it('returns exact typed dimension nodes', () => {
    expect(invoke(asin, makeDimension(0.5))).toEqual({ type: 'Dimension', number: Math.asin(0.5), unit: 'rad', bytes: '0.5235987756rad' });
    expect(invoke(atan, makeDimension(0.5))).toEqual({ type: 'Dimension', number: Math.atan(0.5), unit: 'rad', bytes: '0.463647609rad' });
    expect(invoke(sqrt, makeDimension(2.4, 'px'))).toEqual({ type: 'Dimension', number: Math.sqrt(2.4), unit: 'px', bytes: '1.5491933385px' });
    expect(invoke(sin, makeDimension(2.4, 'px'))).toEqual({ type: 'Dimension', number: Math.sin(2.4), unit: '', bytes: '0.6754631806' });
    expect(invoke(cos, makeDimension(2.4, 'px'))).toEqual({ type: 'Dimension', number: Math.cos(2.4), unit: '', bytes: '-0.7373937155' });
    expect(invoke(tan, makeDimension(2.4, 'px'))).toEqual({ type: 'Dimension', number: Math.tan(2.4), unit: '', bytes: '-0.9160142897' });
    expect(invoke(pow, makeDimension(3, 'px'), makeDimension(2))).toEqual({ type: 'Dimension', number: 9, unit: 'px', bytes: '9px' });
    expect(invoke(mod, makeDimension(7, 'px'), makeDimension(4))).toEqual({ type: 'Dimension', number: 3, unit: 'px', bytes: '3px' });
  });

  it('exposes callable metadata and rejects legacy/plain inputs', () => {
    expect(asin.params).toEqual([{ name: 'value', type: 'Dimension' }]);
    expect(() => invoke(asin, 0.5)).toThrow('typed value node');
  });
});
