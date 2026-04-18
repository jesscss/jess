import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, el, ref, rules, selcap, vardecl, type Rules as RulesClass } from '../index.js';

describe('SelectorCapture', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders selector capture syntax through render()', () => {
    expect(selcap(el('.foo')).render()).toBe('*[.foo]');
  });

  it('renders resolved selector values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = selcap(ref({ key: 'capture-selector' }, { type: 'variable' })).render(context);

    expect(rendered).toBe('.foo');
  });
});
