import { describe, expect, it, vi } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';
import { makeDimension, makeKeyword, makeList } from '../value-factory.js';

const args = makeList([makeKeyword('one'), makeKeyword('two')], ',');

/*
 * These fixtures probe the functionMode boundary and scoped dispatch, NOT arity.
 * They are dispatched with the two-item `args` above, so they must declare two
 * slots: a zero-param declaration is a `too many arguments` rejection inside
 * `bindDirect` and would never reach the body the assertions are about.
 */
const twoSlots = [{ type: 'any' }, { type: 'any' }] as const;

describe('ValueEvaluator function-call boundary', () => {
  it('preserves an unresolved optional FunctionCall without callable dispatch', () => {
    const evaluator = buildEvaluator(createFnRegistry());

    expect(evaluator.call('css-fn', args, { unitMode: 'preserve' }))
      .toMatchObject({ bytes: 'css-fn(one, two)' });
  });

  /*
   * Ledger P36: `ambient: false` (a Less modern-mode document) takes the
   * registry-miss branch without consulting the registry at all; the ordinary
   * ambient call still costs exactly one registry lookup.
   */
  it('treats a registered name as an unresolved optional call when built-ins are not ambient', () => {
    const registry = createFnRegistry();
    const body = vi.fn(() => makeKeyword('computed'));
    registry.register(defineFunction('builtin', { params: twoSlots, body }));
    const get = vi.spyOn(registry, 'get');
    const evaluator = buildEvaluator(registry);

    expect(evaluator.call('builtin', args, { unitMode: 'preserve' }))
      .toMatchObject({ bytes: 'computed' });
    expect(get).toHaveBeenCalledTimes(1);

    get.mockClear();
    body.mockClear();
    expect(evaluator.call('builtin', args, { unitMode: 'preserve' }, null, undefined, undefined, false))
      .toMatchObject({ bytes: 'builtin(one, two)' });
    expect(get).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });

  it('applies functionMode only after a registered callable rejects synchronously', () => {
    const registry = createFnRegistry();
    registry.register(defineFunction('fails', {
      params: twoSlots,
      body: () => {
        throw new RangeError('registered failure');
      }
    }));
    const evaluator = buildEvaluator(registry);
    expect(evaluator.call('fails', args, { unitMode: 'preserve' }))
      .toMatchObject({ bytes: 'fails(one, two)' });
    expect(() => evaluator.call('fails', args, { unitMode: 'preserve', functionMode: 'error' }))
      .toThrow('registered failure');
  });

  it('uses the same policy for an async registered callable rejection', async () => {
    const registry = createFnRegistry();
    registry.register(defineFunction('async-fails', {
      params: twoSlots,
      body: async () => {
        throw new TypeError('async registered failure');
      }
    }));
    const evaluator = buildEvaluator(registry);

    await expect(Promise.resolve(evaluator.call('async-fails', args, { unitMode: 'preserve' })))
      .resolves.toMatchObject({ bytes: 'async-fails(one, two)' });
    await expect(Promise.resolve(evaluator.call('async-fails', args, { unitMode: 'preserve', functionMode: 'error' })))
      .rejects.toThrow('async registered failure');
  });

  it('dispatches a caller-resolved scoped function without consulting the legacy scope view', () => {
    const evaluator = buildEvaluator(createFnRegistry());
    const scoped = defineFunction('scoped', {
      params: twoSlots,
      body: () => makeKeyword('selected')
    });
    const scope = { lookup: vi.fn(() => {
      throw new Error('the direct function should bypass scope.lookup');
    }) };

    expect(evaluator.call('scoped', args, { unitMode: 'preserve' }, scope, undefined, scoped))
      .toMatchObject({ bytes: 'selected' });
    expect(scope.lookup).not.toHaveBeenCalled();
  });

  it('hands a parameter typed as a number the quotient of a slash list of numbers (ledger P35)', () => {
    const registry = createFnRegistry();
    const seen: string[] = [];
    registry.register(defineFunction('pair', {
      params: [{ type: 'Dimension' }, { type: 'any' }],
      body: (number, value) => {
        seen.push(number.type, value.type);
        return makeKeyword('ok');
      }
    }));
    const evaluator = buildEvaluator(registry);
    const slash = makeList([makeDimension(10, 'px'), makeDimension(2)], '/');

    expect(evaluator.call('pair', makeList([slash, slash], ','), { unitMode: 'preserve' })).toMatchObject({ bytes: 'ok' });
    expect(seen).toEqual(['Dimension', 'List']);

    /* A slash list that is not all numbers is not a number: the call is written out. */
    const words = makeList([makeDimension(12, 'px'), makeKeyword('normal')], '/');
    expect(evaluator.call('pair', makeList([words, words], ','), { unitMode: 'preserve' }))
      .toMatchObject({ bytes: 'pair(12px / normal, 12px / normal)' });
  });
});
