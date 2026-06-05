import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { any, list, rest, rules, vardecl } from '../../index.js';
import { Sequence } from '../../sequence.js';
import { evaluateCallableArgs } from '../callable-args.js';

describe('callable arg evaluation helper', () => {
  it('keeps named arguments unevaluated for later parameter binding', async () => {
    const context = new Context();
    const rulesContext = rules([]);
    const namedArg = vardecl({ name: 'tone', value: any('red') }, { paramVar: true });

    const evaluated = await evaluateCallableArgs({
      context,
      rulesContext,
      args: [namedArg]
    });

    expect(evaluated).toEqual([namedArg]);
    expect(evaluated[0]).toBe(namedArg);
  });

  it('expands rest sequence/list values into positional args without freezing direct eval results', async () => {
    const context = new Context();
    const rulesContext = rules([]);
    const firstArg = any('red');
    const restArg = rest(new Sequence([any('blue'), any('green')]));

    const evaluated = await evaluateCallableArgs({
      context,
      rulesContext,
      args: [firstArg, restArg]
    });

    const rendered = new Array<unknown>(evaluated.length);
    for (let i = 0; i < evaluated.length; i++) {
      rendered[i] = evaluated[i]?.valueOf();
    }
    expect(rendered).toEqual(['red', 'blue', 'green']);
    expect(evaluated[0]?.frozen).toBe(false);
  });

  it('casts non-node args into evaluated node values', async () => {
    const context = new Context();
    const rulesContext = rules([]);

    const evaluated = await evaluateCallableArgs({
      context,
      rulesContext,
      args: ['literal', true, [any('nested')]]
    });

    expect(evaluated[0]?.valueOf()).toBe('literal');
    expect(evaluated[0]?.evaluated).toBe(true);
    expect(evaluated[1]?.valueOf()).toBe(true);
    expect(evaluated[2]?.type).toBe('List');
    if (evaluated[2]?.type !== 'List') {
      throw new Error('Expected cast list');
    }
    expect(evaluated[2].value.map(item => item.valueOf())).toEqual(['nested']);
  });
});
