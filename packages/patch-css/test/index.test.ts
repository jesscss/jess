/* eslint-disable @typescript-eslint/naming-convention -- custom property and variable names */
import { describe, expect, it } from 'vitest';
import { exposeVars, exposedVars, writeVars, type StyleTarget } from '../src/index.js';

const spec = { keys: { brand: 'brand', gap: 'gap', mix: 'mix-weight', ratio: 'ratio' }, units: { gap: 'px', ratio: '', 'mix-weight': '%' } };

function target(): StyleTarget & { readonly writes: Array<[string, string]> } {
  const writes: Array<[string, string]> = [];
  return { writes, style: { setProperty: (name, value) => {
    writes.push([name, value]);
  } } };
}

describe('exposedVars', () => {
  it('maps each key to its --name', () => {
    expect(exposedVars(spec, { brand: '#c00', mix: '25%' })).toEqual({ '--brand': '#c00', '--mix-weight': '0.25' });
  });

  it('holds a % export a CSS form reads as its ratio', () => {
    expect(exposedVars(spec, { mix: '50%' })['--mix-weight']).toBe('0.5');
    expect(exposedVars(spec, { mix: '33.3%' })['--mix-weight']).toBe('0.333');
    expect(exposedVars(spec, { mix: '-.5%' })['--mix-weight']).toBe('-0.005');
  });

  it('takes a value in the unit a CSS form reads, in any case', () => {
    expect(exposedVars(spec, { gap: '12PX', ratio: '1.5e1' })).toEqual({ '--gap': '12PX', '--ratio': '1.5e1' });
  });

  it('rejects a value in another unit than the CSS form reads', () => {
    expect(() => exposedVars(spec, { gap: '1em' })).toThrow('gap is read by a CSS form in px, as its compile-time value is; 1em would mean something else there.');
    expect(() => exposedVars(spec, { ratio: '2px' })).toThrow('in a number');
    expect(() => exposedVars(spec, { mix: '0.5' })).toThrow('in %');
    expect(() => exposedVars(spec, { gap: 'calc(1px)' })).toThrow();
    expect(() => exposedVars(spec, { gap: '5.px' })).toThrow();
    expect(() => exposedVars(spec, { gap: '1px 2px' })).toThrow();
  });

  it('rejects a key the stylesheet does not expose', () => {
    expect(() => exposedVars(spec, { toString: 'x' })).toThrow('The stylesheet exposes no variable with the key toString.');
  });
});

describe('writeVars', () => {
  it('sets each changed --name, and skips a value already set', () => {
    const el = target();
    writeVars({ '--brand': '#c00', '--gap': '4px' }, el);
    writeVars({ '--brand': '#c00', '--gap': '8px' }, el);
    expect(el.writes).toEqual([['--brand', '#c00'], ['--gap', '4px'], ['--gap', '8px']]);
  });

  it('keeps what each target was given apart', () => {
    const a = target();
    const b = target();
    writeVars({ '--brand': '#c00' }, a);
    writeVars({ '--brand': '#c00' }, b);
    expect(b.writes).toEqual([['--brand', '#c00']]);
  });
});

describe('exposeVars', () => {
  it('sets one call\'s values as one batch, checked before anything is written', () => {
    const el = target();
    const { set, vars } = exposeVars(spec);
    expect(() => {
      set({ brand: '#00c', gap: '1em' }, el);
    }).toThrow();
    expect(el.writes).toEqual([]);
    set({ brand: '#00c', mix: '10%' }, el);
    expect(el.writes).toEqual([['--brand', '#00c'], ['--mix-weight', '0.1']]);
    expect(vars({ gap: '2px' })).toEqual({ '--gap': '2px' });
  });
});
