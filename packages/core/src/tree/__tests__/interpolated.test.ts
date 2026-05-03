import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  interpolated,
  quoted,
  ref,
  rules,
  type Rules as RulesClass,
  vardecl
} from '../index.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';

describe('Interpolated', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders interpolated source syntax through toTrimmedString()', () => {
    const node = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });

    expect(node.toTrimmedString()).toBe('hello-$name');
  });

  it('renders resolved interpolated values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const rendered = interpolatedNode.render(context);

    expect(rendered).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.preEvaluated).toBe(false);
  });

  it('resolves interpolated values without touching render state', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('world')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const interpolatedNode = interpolated({
      source: `hello-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    });
    const resolved = await interpolatedNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('hello-world');
    expect(interpolatedNode.evaluated).toBe(false);
    expect(interpolatedNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('preserves quoted replacement syntax when requested', () => {
    const node = interpolated({
      source: `progid:test(value=${INTERPOLATION_PLACEHOLDER})`,
      replacements: [quoted('#000000', { quote: '"' })]
    }, { preserveQuotedSyntax: true });

    expect(node.toTrimmedString()).toBe('progid:test(value="#000000")');
  });
});
