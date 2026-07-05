import { beforeEach, describe, expect, it } from 'vitest';
import { call, dimension, list, num, op, paren } from '../index.js';
import type { Node } from '../node.js';
import { Context } from '../../context.js';

/**
 * Less reduces `calc()` where it can and preserves what it can't:
 *  - single-arg / fully-numeric calc collapses to a bare value
 *  - constant sub-expressions fold
 *  - unit-aware collapse (matching units add/subtract)
 *  - nested calc composition
 *  - mixed-unit / incompatible parts stay wrapped as `calc(...)`
 *
 * Reduction lives in the eval/math path: Operation catches operate()'s
 * incompatible-unit TypeError and preserves the operation as `calc(l op r)`;
 * the calc Call unwraps a single arg that collapses to a Dimension.
 */
describe('calc reduction', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context({ unitMode: 'preserve' });
  });

  const calc = (arg: Parameters<typeof op>[0] | ReturnType<typeof dimension>) => {
    const inner: Node = (Array.isArray(arg) ? op(arg) : arg)!;
    return call({ name: 'calc', args: list([inner]) });
  };

  // Reduction happens in the eval/math path (as the declaration pipeline does:
  // eval the value, then render the reduced node), so evaluate before rendering.
  const render = async (node: ReturnType<typeof call>): Promise<string> => {
    const evaluated = await node.eval(context);
    return evaluated.render(context);
  };

  it('reduces a single-arg dimension calc to the bare dimension', async () => {
    expect(await render(calc(dimension([200, 'px'])))).toBe('200px');
  });

  it('folds a fully-numeric calc to its value (dropping the wrapper)', async () => {
    // calc(10px * 2) → 20px
    expect(await render(calc([dimension([10, 'px']), '*', num(2)]))).toBe('20px');
  });

  it('collapses matching units under add/subtract', async () => {
    // calc(30px - 10px) → 20px
    expect(await render(calc([dimension([30, 'px']), '-', dimension([10, 'px'])]))).toBe('20px');
  });

  it('folds a constant sub-expression but preserves incompatible outer units', async () => {
    // calc(100% - (10px + 30px)) → calc(100% - 40px)
    const inner = paren(op([dimension([10, 'px']), '+', dimension([30, 'px'])]));
    const outer = calc([dimension([100, '%']), '-', inner]);
    expect(await render(outer)).toBe('calc(100% - 40px)');
  });

  it('preserves mixed-unit arithmetic as calc()', async () => {
    // calc(100% - 30px) → calc(100% - 30px)
    expect(await render(calc([dimension([100, '%']), '-', dimension([30, 'px'])])))
      .toBe('calc(100% - 30px)');
  });

  it('composes and reduces nested calc that collapses to one unit', async () => {
    // calc(10vh + calc(5vh)) → 15vh
    const nested = call({ name: 'calc', args: list([dimension([5, 'vh'])]) });
    expect(await render(calc([dimension([10, 'vh']), '+', nested]))).toBe('15vh');
  });

  it('keeps a surviving inner paren wrapped inside the outer calc', async () => {
    // calc(50% + (25vh - 20px)) → calc(50% + (25vh - 20px))
    const inner = paren(op([dimension([25, 'vh']), '-', dimension([20, 'px'])]));
    expect(await render(calc([dimension([50, '%']), '+', inner])))
      .toBe('calc(50% + (25vh - 20px))');
  });
});
