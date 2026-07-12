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

  it('coerces parser value-shape args and casts JS-interop values', async () => {
    const context = new Context();
    const rulesContext = rules([]);

    const evaluated = await evaluateCallableArgs({
      context,
      rulesContext,
      // A bare string terminal and a space-group array are parser value-shapes;
      // a boolean is a JS-interop value. Value-shapes coerce (string → keyword,
      // multi-item array → space `Sequence`); JS values still go through `cast`.
      args: ['literal', true, [any('a'), any('b')]]
    });

    expect(evaluated[0]?.valueOf()).toBe('literal');
    expect(evaluated[1]?.valueOf()).toBe(true);
    // A space-group array is a space-separated `Sequence`, not a comma `List`.
    expect(evaluated[2]?.type).toBe('Sequence');
    if (evaluated[2]?.type !== 'Sequence') {
      throw new Error('Expected coerced Sequence');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    expect((evaluated[2] as unknown as Sequence).value.map(item => item.valueOf())).toEqual(['a', 'b']);
  });
});
