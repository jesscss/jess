import { describe, expect, it } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import { any, decl, el, extend, ExtendFlag, rules, ruleset, sel, sellist, Node } from '../index.js';
import { Extend } from '../extend.js';
import { ExtendList, extendList } from '../extend-list.js';
import { N } from '../node-type.js';
import { isNode } from '../util/is-node.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

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
    const child = extend({ target: el('.base') });
    child.render = () => {
      throw new Error('ExtendList.render should not call child render');
    };
    const node = extendList([child]);
    node.evalNode = () => {
      throw new Error('ExtendList.render should not materialize public eval output');
    };

    expect(node.render(context)).toBe('');
  });

  it('preserves parser tree context on extend lists', () => {
    const treeContext = new TreeContext();
    const child = extend({ target: el('.base') });
    const node = new ExtendList([child], undefined, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
    expect(node.nodes).toEqual([child]);
    expect(node.value).toEqual([child]);
    expect(ExtendList.childKeys).toEqual(['nodes']);
  });

  it('keeps extend behavior when rendered inside a ruleset', async () => {
    const context = new Context({ collapseNesting: true });
    const node = rules([
      ruleset({
        selector: el('.base'),
        rules: [decl({ name: any('color'), value: any('red') })]
      }),
      ruleset({
        selector: el('.child'),
        rules: [extend({ target: el('.base') })]
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

  it('writes empty extend lists without writer readback', () => {
    const writer = new CountingWriter();

    expect(extendList([]).toTrimmedString({ writer })).toBe(';');
    expect(writer.toString()).toBe(';');
    expect(writer.reads).toBe(0);
  });

  it('writes extend selectors without public toString transport', () => {
    const selector = el('.source');
    const target = el('.base');
    let stringCalls = 0;
    selector.toString = target.toString = () => {
      stringCalls++;
      return '';
    };

    expect(extend({
      selector,
      target,
      namespace: 'ns',
      flag: ExtendFlag.Exact
    }).toTrimmedString()).toBe('$extend .source -> ns|.base !exact;');
    expect(stringCalls).toBe(0);
  });

  it.each([
    ['all', ExtendFlag.All],
    ['exact', ExtendFlag.Exact]
  ] as const)('registers %s parent-list extends with owned generated selector wrappers', async (_label, flag) => {
    const context = new Context();
    const parentA = el('.parent-a');
    const parentB = el('.parent-b');
    const child = el('.child');
    const parentSelector = sellist([sel([parentA]), sel([parentB])]);
    const childSelector = sel([child]);
    const parentItems = [...parentSelector.value];
    const childParts = [...childSelector.value];
    const originalAClone = parentA.clone;
    const originalBClone = parentB.clone;
    const originalChildClone = child.clone;
    let sourceLeafClones = 0;
    parentA.clone = function cloneForCounting(
      ...args: Parameters<typeof originalAClone>
    ): ReturnType<typeof originalAClone> {
      sourceLeafClones++;
      return originalAClone.apply(this, args);
    };
    parentB.clone = function cloneForCounting(
      ...args: Parameters<typeof originalBClone>
    ): ReturnType<typeof originalBClone> {
      sourceLeafClones++;
      return originalBClone.apply(this, args);
    };
    child.clone = function cloneForCounting(
      ...args: Parameters<typeof originalChildClone>
    ): ReturnType<typeof originalChildClone> {
      sourceLeafClones++;
      return originalChildClone.apply(this, args);
    };

    try {
      const root = rules([
        ruleset({
          selector: el('.target'),
          rules: [decl({ name: any('color'), value: any('red') })]
        }),
        ruleset({
          selector: parentSelector,
          rules: [
            ruleset({
              selector: childSelector,
              rules: [
                extend({ target: el('.target'), flag })
              ]
            })
          ]
        })
      ]);

      await root.eval(context);

      expect(sourceLeafClones).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect(parentItems.map(item => (item as Node).parent)).toEqual(parentItems.map(() => parentSelector));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      expect(childParts.map(part => (part as Node).parent)).toEqual(childParts.map(() => childSelector));

      const registeredSelector = context.extends[0]?.[1];
      expect(registeredSelector).toBeDefined();
      expect(registeredSelector?.valueOf()).toBe(':is(.parent-a,.parent-b) .child');

      if (!registeredSelector || !isNode(registeredSelector, N.ComplexSelector)) {
        throw new Error(`Expected complex registered selector, got ${registeredSelector?.type ?? 'undefined'}`);
      }

      const [generatedParent, combinator, generatedChild] = registeredSelector.value;
      expect(combinator!.valueOf()).toBe(' ');
      expect(generatedChild).not.toBe(childSelector);

      if (!isNode(generatedParent, N.PseudoSelector) || !generatedParent.arg || !isNode(generatedParent.arg, N.SelectorList)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        throw new Error(`Expected generated :is(...) parent wrapper, got ${(generatedParent as unknown as Node | undefined)?.type}`);
      }

      expect(generatedParent.generated).toBe(true);
      expect(generatedParent.arg).not.toBe(parentSelector);
      expect(generatedParent.arg.value[0]).not.toBe(parentItems[0]);
      expect(generatedParent.arg.value[1]).not.toBe(parentItems[1]);
    } finally {
      parentA.clone = originalAClone;
      parentB.clone = originalBClone;
      child.clone = originalChildClone;
    }
  });
});
