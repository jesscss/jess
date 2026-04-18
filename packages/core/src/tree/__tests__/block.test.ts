import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, block, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';

describe('Block', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders block syntax through toTrimmedString()', () => {
    expect(block(any('foo')).toTrimmedString()).toBe('{foo}');
  });

  it('does not allocate options when rendering block syntax with defaults', () => {
    const rule = block(any('foo'));

    expect(rule.toTrimmedString()).toBe('{foo}');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved block values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = block(ref({ key: 'value' }, { type: 'variable' })).render(context);

    expect(rendered).toBe('{foo}');
  });

  it('resolves block values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await block(ref({ key: 'value' }, { type: 'variable' })).resolve(context);

    expect(`${resolved}`).toBe('{foo}');
    expect(context.printState.writer).toBeUndefined();
  });
});
