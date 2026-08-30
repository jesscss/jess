import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  co,
  compound,
  el,
  pseudo,
  ref,
  rules,
  sel,
  sellist,
  type Rules as RulesClass,
  vardecl
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error(`Expected Rules root`);
  }
  context.root = evald;
  context.rulesContext = evald;
}

describe('Selector render contract', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('keeps pseudo-selector source serializers canonical while render(context) resolves selector-list arguments', async () => {
    const node = rules([
      vardecl({
        name: 'capture-selector-list',
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const selector = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });

    expect(selector.toString()).toBe(':is($capture-selector-list)');
    expect(selector.toTrimmedString()).toBe(':is($capture-selector-list)');
    expect(selector.render(context)).toBe(':is(.foo, .bar)');
  });

  it('renders selector nodes directly without public resolve', async () => {
    const node = rules([
      vardecl({
        name: 'capture-selector-list',
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const selector = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    selector.resolve = () => {
      throw new Error('Selector direct render should use resolveForRender');
    };

    expect(selector.render(context)).toBe(':is(.foo, .bar)');
    expect(selector.registrationPrepared).toBe(false);
  });

  it('keeps complex selector source serializers canonical while render(context) resolves nested selector values', async () => {
    const node = rules([]);
    await setEvaluatedRoot(context, node);

    const selector = sel([
      compound([
        el('a'),
        el('[data=foo]')
      ]),
      co('>'),
      el('.foo')
    ]);

    expect(selector.toString()).toBe('a[data=foo] > .foo');
    expect(selector.toTrimmedString()).toBe('a[data=foo] > .foo');
    expect(selector.render(context)).toBe('a[data=foo] > .foo');
  });
});
