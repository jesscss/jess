import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, query, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';

describe('QueryCondition', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders query-condition syntax through toTrimmedString()', () => {
    const node = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]);

    expect(node.toTrimmedString()).toBe('screen and $mode');
  });

  it('renders resolved query-condition values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('print')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]).render(context);

    expect(rendered).toBe('screen and print');
  });

  it('resolves query-condition values without touching render state', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('print')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]).resolve(context);

    expect(resolved.toTrimmedString()).toBe('screen and print');
    expect(context.printState.writer).toBeUndefined();
  });
});
