import { describe, expect, it } from 'vitest';
import { any, list, vardecl } from '../../index.js';
import { matchCallableParams } from '../callable-param-match.js';

describe('callable param matching helpers', () => {
  it('rejects extra positional args for a single required parameter overload', () => {
    const matched = matchCallableParams({
      params: list([vardecl({ name: 'size', value: any('') }, { paramVar: true })]),
      args: [any('1px'), any('2px')],
      hasFileContext: false
    });

    expect(matched).toBeUndefined();
  });
});
