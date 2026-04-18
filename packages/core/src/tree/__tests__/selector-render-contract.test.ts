import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  attr,
  co,
  compound,
  el,
  pseudo,
  ref,
  rules,
  sel,
  selcap,
  sellist,
  type Rules as RulesClass,
  vardecl
} from '../index.js';

describe('Selector render contract', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('keeps selector capture toString canonical while render(context) resolves its payload', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selector = selcap(ref({ key: 'capture-selector' }, { type: 'variable' }));

    expect(selector.toString()).toBe('*[$capture-selector]');
    expect(selector.render(context)).toBe('.foo');
  });

  it('keeps pseudo-selector toString canonical while render(context) resolves selector-list arguments', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selector = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });

    expect(selector.toString()).toBe(':is($capture-selector-list)');
    expect(selector.render(context)).toBe(':is(.foo, .bar)');
  });

  it('keeps complex selector toString canonical while render(context) resolves nested selector values', async () => {
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selector = sel([
      compound([
        el('a'),
        attr({
          name: 'data',
          op: '=',
          value: ref({ key: 'attr-name' }, { type: 'variable' })
        })
      ]),
      co('>'),
      el('.foo')
    ]);

    expect(selector.toString()).toBe('a[data=$attr-name] > .foo');
    expect(selector.render(context)).toBe('a[data=foo] > .foo');
  });
});
