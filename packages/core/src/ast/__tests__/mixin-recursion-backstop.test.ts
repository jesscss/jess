import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { serialize } from '../serialize.js';
import { defineFunction } from '../value-dispatch.js';

/**
 * [recursion-backstop] A mixin that keeps calling itself is stopped with
 * `eval/mixin-recursion-limit` at the call. The async cases pass each level's
 * argument through an async function, so the expansion suspends between levels
 * and the JS stack never limits the depth: they pin the 500-expansion limit
 * (`MAX_MIXIN_DEPTH`). A synchronous runaway overflows the native stack before
 * that limit, and the overflow is reported as the same error.
 */
const registry = makeLessRegistry();
registry.register(defineFunction('apass', { params: [{ type: 'any' }], body: async (value: unknown) => value }));
const evaluator = buildEvaluator(registry);
const render = async (src: string): Promise<string | undefined> =>
  (await serialize(parseLess(src), { evaluator, collapseNesting: true })).css;
const countTo = (last: number): string =>
  `.m(@i) when (@i <= ${last}) { .m(apass((@i + 1))); }\n.m(@i) when (@i = ${last}) { deepest: @i; }\n.a { .m(1); }\n`;
const backstop = expect.objectContaining({ code: 'eval/mixin-recursion-limit' });
const renderSync = (src: string): unknown => serialize(parseLess(src), { evaluator, collapseNesting: true });

describe('mixin recursion backstop', () => {
  it('renders guarded recursion exactly 500 expansions deep', async () => {
    await expect(render(countTo(500))).resolves.toBe('.a {\n  deepest: 500;\n}\n');
  });

  it('stops the 501st nested expansion', async () => {
    await expect(render(countTo(501))).rejects.toThrow(backstop);
  });

  it('stops a runaway whose guard never fails', async () => {
    await expect(render('.loop(@n) { .loop(apass((@n + 1))); }\n.a { .loop(1); }\n')).rejects.toThrow(backstop);
  });

  it('reports a synchronous runaway at the call, not as a native stack overflow (jess#380)', () => {
    expect(() => renderSync('.loop(@n) { .loop((@n + 1)); }\n.a { .loop(1); }\n'))
      .toThrow(expect.objectContaining({ code: 'eval/mixin-recursion-limit', node: expect.objectContaining({ type: 'MixinCall', name: '.loop' }) }));
  });

  it('reports a synchronous runaway through an at-rule body the same way', () => {
    expect(() => renderSync('.loop(@n) { @font-face { .loop((@n + 1)); } }\n.a { .loop(1); }\n')).toThrow(backstop);
  });

  it('counts only open expansions: sibling calls after a deep one start from zero again', async () => {
    await expect(render(`${countTo(400)}.b { .m(1); }\n`)).resolves.toBe('.a {\n  deepest: 400;\n}\n.b {\n  deepest: 400;\n}\n');
  });
});
