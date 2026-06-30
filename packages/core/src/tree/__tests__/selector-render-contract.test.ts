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
  type Selector,
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

  it('keeps selector capture source serializers canonical while render(context) resolves its payload', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const selector = selcap(ref({ key: 'capture-selector' }, { type: 'variable' }) as unknown as Selector);

    expect(selector.toString()).toBe('*[$capture-selector]');
    expect(selector.toTrimmedString()).toBe('*[$capture-selector]');
    expect(selector.render(context)).toBe('.foo');
  });

  it('renders selector captures directly without public resolve', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const selector = selcap(ref({ key: 'capture-selector' }, { type: 'variable' }) as unknown as Selector);
    selector.resolve = () => {
      throw new Error('SelectorCapture direct render should resolve its payload natively');
    };

    expect(selector.render(context)).toBe('.foo');
    expect(selector.registrationPrepared).toBe(false);
  });

  it('keeps pseudo-selector source serializers canonical while render(context) resolves selector-list arguments', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
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
        name: any('capture-selector-list'),
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
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

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
    expect(selector.toTrimmedString()).toBe('a[data=$attr-name] > .foo');
    expect(selector.render(context)).toBe('a[data=foo] > .foo');
  });
});
