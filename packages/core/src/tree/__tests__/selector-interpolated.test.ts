import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  interpolated,
  interpolatedSelector,
  INTERPOLATION_PLACEHOLDER,
  ref,
  rules,
  type Rules as RulesClass,
  vardecl
} from '../index.js';

describe('InterpolatedSelector', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders interpolated selector source syntax through toTrimmedString()', () => {
    const node = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));

    expect(node.toTrimmedString()).toBe('.$[name]');
  });

  it('renders resolved interpolated selectors through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selectorNode = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));
    const rendered = selectorNode.render(context);

    expect(rendered).toBe('.foo');
    expect(selectorNode.evaluated).toBe(false);
    expect(selectorNode.preEvaluated).toBe(false);
  });

  it('resolves interpolated selectors without touching render state', async () => {
    const root = rules([
      vardecl({
        name: any('name'),
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selectorNode = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'index' })]
    }));
    const resolved = await selectorNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo');
    expect(selectorNode.evaluated).toBe(false);
    expect(selectorNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
