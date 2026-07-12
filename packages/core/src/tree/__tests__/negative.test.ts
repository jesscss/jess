import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  negative,
  num,
  ref,
  rules,
  type Rules as RulesClass,
  vardecl
} from '../index.js';

describe('Negative', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders negative syntax through toTrimmedString()', () => {
    expect(negative(num(10)).toTrimmedString()).toBe('-10');
  });

  it('renders negative values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = negative(ref({ key: 'rhs' }, { type: 'variable' })).render(context);

    expect(rendered).toBe('-20');
  });

  it('resolves negative values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await negative(
      ref({ key: 'rhs' }, { type: 'variable' })
    ).resolve(context);

    expect(`${resolved}`).toBe('-20');
    expect(context.printState.writer).toBeUndefined();
  });
});
