import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, dimension, list, num, op, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';

describe('Operation', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders operation syntax through toTrimmedString()', () => {
    const rule = op([num(10), '+', num(20)]);

    expect(rule.toTrimmedString()).toBe('10 + 20');
  });

  it('renders resolved operation values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]).render(context);

    expect(rendered).toBe('30');
  });

  it('resolves operation values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await op([
      num(10),
      '+',
      ref({ key: 'rhs' }, { type: 'variable' })
    ]).resolve(context);

    expect(`${resolved}`).toBe('30');
    expect(context.printState.writer).toBeUndefined();
  });

  it('preserves slash-list operands instead of forcing math on outer operations', async () => {
    const node = rules([
      vardecl({
        name: any('div-op'),
        value: list([dimension([10, 'px']), num(2)], { sep: '/' })
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const renderedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    expect(renderedOperation.render(context)).toBe('10px / 2 * 2');

    const resolveContext = new Context();
    resolveContext.root = evald as RulesClass;
    resolveContext.rulesContext = evald as RulesClass;
    const resolvedOperation = op([
      ref({ key: 'div-op' }, { type: 'variable' }),
      '*',
      num(2)
    ]);

    const resolved = await resolvedOperation.resolve(resolveContext);
    expect(resolveContext.printState.writer).toBeUndefined();
    expect(resolved.type).toBe('Operation');
    expect(resolved.toTrimmedString()).toBe('10px / 2 * 2');
  });
});
