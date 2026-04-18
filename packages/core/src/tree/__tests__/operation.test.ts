import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, num, op, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';

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
});
