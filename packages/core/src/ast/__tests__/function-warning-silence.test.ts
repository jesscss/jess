import { describe, expect, it, vi } from 'vitest';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { decl, funcCall, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';
import { createFnRegistry, defineFunction } from '../value-dispatch.js';

function failingEvaluator() {
  const registry = createFnRegistry();
  registry.register(defineFunction('fails', {
    params: [],
    body: () => {
      throw new RangeError('registered failure');
    }
  }));
  return buildEvaluator(registry);
}

function document() {
  return stylesheet([
    rule('.example', [decl('value', funcCall('fails', []))])
  ]);
}

describe('registered function preserve warnings', () => {
  it('does not construct or route a silenced fallback warning', () => {
    const context = new Context({ suppressWarnings: true });
    context.registerValueEvaluator(failingEvaluator());
    const warn = vi.spyOn(context, 'warn');

    expect(serialize(document(), { context }).css).toBe('.example {\n  value: fails();\n}\n');
    expect(warn).not.toHaveBeenCalled();
    expect(context.warnings).toEqual([]);
  });

  it('keeps the fallback warning when it is enabled', () => {
    const context = new Context();
    context.registerValueEvaluator(failingEvaluator());

    expect(serialize(document(), { context }).css).toBe('.example {\n  value: fails();\n}\n');
    expect(context.warnings.map(warning => warning.code)).toEqual(['function/unresolved']);
  });
});
