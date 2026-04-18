import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, el, pseudo, ref, rules, sellist, type Rules as RulesClass, vardecl } from '../index.js';

describe('PseudoSelector', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders pseudo selector syntax through render()', () => {
    expect(pseudo({ name: ':hover' }).render()).toBe(':hover');
  });

  it('renders resolved pseudo selector values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    }).render(context);

    expect(rendered).toBe(':is(.foo, .bar)');
  });
});
