import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, decl, el, extend, rules, ruleset } from '../index.js';
import { Extend } from '../extend.js';
import { ExtendList, extendList } from '../extend-list.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';

describe('Extend render', () => {
  it('renders extend side effects without calling public evalNode()', () => {
    const context = new Context();
    const node = extend({ target: el('.base') });
    node.evalNode = () => {
      throw new Error('Extend.render should not materialize public eval output');
    };

    expect(node.render(context)).toBe('');
  });

  it('writes invisible extend side effects into buffers without public evalNode()', () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = extend({ target: el('.base') });
    node.evalNode = () => {
      throw new Error('Extend.render should not materialize public eval output');
    };

    expect(node.render(context, buffer)).toBe('');
    expect(buffer.parts).toEqual([]);
  });

  it('renders extend lists by running child side effects directly', () => {
    const context = new Context();
    const node = extendList([extend({ target: el('.base') })]);
    node.evalNode = () => {
      throw new Error('ExtendList.render should not materialize public eval output');
    };

    expect(node.render(context)).toBe('');
  });

  it('keeps extend behavior when rendered inside a ruleset', async () => {
    const context = new Context({ collapseNesting: true });
    const node = rules([
      ruleset({
        selector: el('.base'),
        rules: rules([decl({ name: any('color'), value: any('red') })])
      }),
      ruleset({
        selector: el('.child'),
        rules: rules([extend({ target: el('.base') })])
      })
    ]);

    await expect(Promise.resolve(renderNodeToString(node, context, { context }))).resolves.toContain('.base,\n.child');
  });

  it('keeps public evalNode output for Extend and ExtendList', async () => {
    const context = new Context();

    await expect(Promise.resolve(extend({ target: el('.base') }).evalNode(context)))
      .resolves.toHaveProperty('type', 'Nil');
    expect(extendList([]).evalNode(context)).toBeInstanceOf(ExtendList);
    expect(extend({ target: el('.base') })).toBeInstanceOf(Extend);
  });
});
