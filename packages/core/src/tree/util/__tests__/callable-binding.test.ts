import { describe, expect, it } from 'vitest';
import { any } from '../../any.js';
import { F_HAS_NODE_CHILD } from '../../node.js';
import { list } from '../../list.js';
import { createArgumentsBindingValue, createRestBindingValue, getArgumentsBindingValues } from '../callable-binding.js';

describe('callable binding helpers', () => {
  it('creates rest binding values through a named helper', () => {
    const value = any('1px');

    const rest = createRestBindingValue([value]);

    expect(rest.value).toHaveLength(1);
    expect(rest.value[0]).toBe(value);
    expect(rest.value[0]?.valueOf()).toBe('1px');
  });

  it('creates arguments binding values without copying existing evaluated args', () => {
    const value = any('2px');

    const args = createArgumentsBindingValue([value]);

    expect(args.value).toEqual([value]);
    expect(args.hasFlag(F_HAS_NODE_CHILD)).toBe(true);
  });

  it('keeps empty arguments binding values childless', () => {
    const args = createArgumentsBindingValue([]);

    expect(args.value).toEqual([]);
    expect(args.hasFlag(F_HAS_NODE_CHILD)).toBe(false);
  });

  it('returns original argument values when no rest sequence needs flattening', () => {
    const value = any('2px');
    const args = [value];

    expect(getArgumentsBindingValues(args)).toBe(args);
  });

  it('flattens rest sequences before creating @arguments bindings', () => {
    const first = any('1px');
    const second = any('2px');
    const rest = createRestBindingValue([first, second]);

    expect(getArgumentsBindingValues([rest])).toEqual(rest.value);
  });

  it('reuses source-free static scalar leaves for rest bindings', () => {
    const value = any('3px');

    const rest = createRestBindingValue([value]);

    expect(rest.value[0]).toBe(value);
  });

  it('keeps static containers on the owned binding path for now', () => {
    const source = list([any('4px')]);

    const rest = createRestBindingValue([source]);

    expect(rest.value[0]).not.toBe(source);
    expect(rest.value[0]?.valueOf()).toBe(source.valueOf());
    expect(source.value[0]?.parent).toBe(source);
  });
});
