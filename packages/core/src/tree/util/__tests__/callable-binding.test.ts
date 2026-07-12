import { describe, expect, it } from 'vitest';
import { any } from '../../any.js';
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
  });

  it('flattens rest sequences before creating @arguments bindings', () => {
    const first = any('1px');
    const second = any('2px');
    const rest = createRestBindingValue([first, second]);

    expect(getArgumentsBindingValues([rest])).toEqual(rest.value);
  });
});
