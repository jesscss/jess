import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, paren, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';

describe('Paren', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders paren syntax through toTrimmedString()', () => {
    expect(paren(any('foo')).toTrimmedString()).toBe('(foo)');
  });

  it('does not allocate options when rendering paren syntax with defaults', () => {
    const rule = paren(any('foo'));

    expect(rule.toTrimmedString()).toBe('(foo)');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved paren values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = paren(ref({ key: 'value' }, { type: 'variable' })).render(context);

    expect(rendered).toBe('(foo)');
  });

  it('resolves paren values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await paren(ref({ key: 'value' }, { type: 'variable' })).resolve(context);

    expect(`${resolved}`).toBe('(foo)');
    expect(context.printState.writer).toBeUndefined();
  });
});
