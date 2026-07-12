import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, attr, compound, el, ref, rules, selcap, vardecl, type Rules as RulesClass } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error(`Expected Rules root, received ${evald.type}`);
  }
  context.root = evald;
  context.rulesContext = evald;
}

describe('SelectorCapture', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders selector capture syntax through toTrimmedString()', () => {
    expect(selcap(el('.foo')).toTrimmedString()).toBe('*[.foo]');
  });

  it('renders resolved selector values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const captureNode = selcap(ref({ key: 'capture-selector' }, { type: 'variable' }));
    const rendered = captureNode.render(context);

    expect(rendered).toBe('.foo');
    expect(captureNode.evaluated).toBe(false);
    expect(captureNode.registrationPrepared).toBe(false);
  });

  it('writes resolved selector capture output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const buffer = createRenderBuffer('flat');
    const captureNode = selcap(ref({ key: 'capture-selector' }, { type: 'variable' }));
    const originalResolve = captureNode.resolve;
    let resolveCalls = 0;
    captureNode.resolve = function countResolveCalls(
      this: typeof captureNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await captureNode.render(context, buffer)).toBe('.foo');
    expect(buffer.parts).toEqual(['.foo']);
    expect(resolveCalls).toBe(0);
    expect(captureNode.evaluated).toBe(false);
    expect(captureNode.registrationPrepared).toBe(false);
  });

  it('resolves selector capture values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: el('.foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const captureNode = selcap(ref({ key: 'capture-selector' }, { type: 'variable' }));
    const resolved = await captureNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('.foo');
    expect(captureNode.evaluated).toBe(false);
    expect(captureNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('returns static selector capture payloads without resolving child values', async () => {
    const value = el('.foo');
    const captureNode = selcap(value);
    value.resolve = () => {
      throw new Error('static selector capture child should not resolve');
    };

    const resolved = await captureNode.resolve(context);

    expect(resolved).toBe(value);
    expect(resolved.toTrimmedString()).toBe('.foo');
  });

  it('keeps source selector capture child containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-attr'),
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const captureNode = selcap(compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
    ]));
    const resolved = await captureNode.resolve(context);

    expect(resolved.render(context)).toBe('a[data=foo]');
    expect(captureNode.toTrimmedString()).toBe('*[a[data=$capture-attr]]');
  });
});
