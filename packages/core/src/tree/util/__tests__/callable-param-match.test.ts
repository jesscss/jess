import { describe, expect, it } from 'vitest';
import { any, list, rest, vardecl } from '../../index.js';
import { Sequence } from '../../sequence.js';
import { matchCallableParams } from '../callable-param-match.js';

describe('callable param matching helpers', () => {
  it('matches named/default/rest parameters without rules closure state', () => {
    const matched = matchCallableParams({
      params: list([
        any('color', { role: 'property' }),
        vardecl({ name: 'size', value: any('16px') }, { paramVar: true }),
        rest('rest')
      ]),
      args: [
        any('blue'),
        vardecl({ name: 'size', value: any('1px') }, { paramVar: true }),
        any('2px'),
        any('3px')
      ],
      hasFileContext: true
    });

    expect(matched).toBeDefined();
    expect(matched?.bindings.map(binding => binding.name)).toEqual(['color', 'size', 'rest']);
    expect(matched?.bindings[0]?.value?.valueOf()).toBe('blue');
    expect(matched?.bindings[1]?.value?.valueOf()).toBe('1px');
    const preparedRest = matched?.bindings[2]?.prepareValue?.(undefined);
    expect(preparedRest).toBeInstanceOf(Sequence);
    if (!(preparedRest instanceof Sequence)) {
      throw new Error('Expected Sequence rest binding');
    }
    expect(preparedRest.value.map(node => node.valueOf())).toEqual(['2px', '3px']);
    expect(matched?.signatureKey).toBe('blue;1px;2px 3px');
  });

  it('rejects extra positional args for a single required parameter overload', () => {
    const matched = matchCallableParams({
      params: list([vardecl({ name: 'size', value: any('') }, { paramVar: true })]),
      args: [any('1px'), any('2px')],
      hasFileContext: false
    });

    expect(matched).toBeUndefined();
  });
});
