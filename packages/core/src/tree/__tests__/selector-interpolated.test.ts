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
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    }));

    expect(node.toTrimmedString()).toBe('.$name');
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

    const rendered = interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    })).render(context);

    expect(rendered).toBe('.foo');
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

    const resolved = await interpolatedSelector(interpolated({
      source: `.${INTERPOLATION_PLACEHOLDER}`,
      replacements: [ref({ key: 'name' }, { type: 'variable' })]
    })).resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo');
    expect(context.printState.writer).toBeUndefined();
  });
});
