import { beforeEach, describe, expect, it } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';
import type { IToken } from 'chevrotain';
import { any, co, compound, el, pseudo, ref, rules, sel, sellist, type Rules as RulesClass, vardecl } from '../index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { PseudoSelector } from '../selector-pseudo.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error(`Expected Rules root, received ${evald.type}`);
  }
  context.root = evald;
  context.rulesContext = evald;
}

describe('PseudoSelector', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders pseudo selector syntax through toTrimmedString()', () => {
    expect(pseudo({ name: ':hover' }).toTrimmedString()).toBe(':hover');
  });

  it('renders compound selector arguments without sequence spacing', () => {
    expect(pseudo({
      name: ':host',
      arg: compound([el('.sel'), el('.a')])
    }).toTrimmedString()).toBe(':host(.sel.a)');
  });

  it('does not emit source trivia inside generated selector arguments', () => {
    const newline: IToken[] = [{
      image: '\n  ',
      tokenType: { name: 'WS' } as IToken['tokenType']
    }];
    const trivia = createTriviaMap({
      before: new Map([[10, newline]]),
      after: new Map()
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const inner = sel([
      el('.a', undefined, [10, 1, 11, 12, 1, 13], treeContext),
      co(' '),
      el('.b')
    ]);
    const node = pseudo({ name: ':is', arg: inner });
    node.generated = true;

    expect(node.toTrimmedString({ trivia })).toBe(':is(.a .b)');
  });

  it('omits generated :is() wrappers only for single-selector-list placement output', () => {
    const generatedSingle = pseudo({
      name: ':is',
      arg: sellist([sel([el('.a'), co(' '), el('.b')])])
    });
    generatedSingle.generated = true;
    const generatedMulti = pseudo({
      name: ':is',
      arg: sellist([el('.a'), el('.b')])
    });
    generatedMulti.generated = true;
    const authoredSingle = pseudo({
      name: ':is',
      arg: sellist([sel([el('.a'), co(' '), el('.b')])])
    });

    expect(generatedSingle.toTrimmedString()).toBe('.a .b');
    expect(generatedSingle.render(context)).toBe('.a .b');
    expect(generatedMulti.toTrimmedString()).toBe(':is(.a, .b)');
    expect(generatedMulti.render(context)).toBe(':is(.a, .b)');
    expect(authoredSingle.toTrimmedString()).toBe(':is(.a .b)');
    expect(authoredSingle.render(context)).toBe(':is(.a .b)');
  });

  it('keeps generated :is() placement output aligned between string and buffer render', () => {
    const buffer = createRenderBuffer('segmented');
    const node = pseudo({
      name: ':is',
      arg: sellist([sel([el('.a'), co(' '), el('.b')])])
    });
    node.generated = true;

    expect(node.render(context)).toBe('.a .b');
    expect(node.render(context, buffer)).toBe('.a .b');
    expect(buffer.segments).toEqual(['.a .b']);
  });

  it('streams generated selector arguments without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = pseudo({
      name: ':is',
      arg: sel([
        el('.a'),
        co(' '),
        el('.b')
      ])
    });
    node.generated = true;

    expect(node.toTrimmedString({ writer })).toBe(':is(.a .b)');
    expect(writer.toString()).toBe(':is(.a .b)');
    expect(writer.captures).toBe(0);
  });

  it('streams selector list arguments without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = pseudo({
      name: ':not',
      arg: sellist([el('.a'), el('.b')])
    });

    expect(node.toTrimmedString({ writer })).toBe(':not(.a, .b)');
    expect(writer.toString()).toBe(':not(.a, .b)');
    expect(writer.captures).toBe(0);
  });

  it('renders resolved pseudo selector values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    const rendered = pseudoNode.render(context);

    expect(rendered).toBe(':is(.foo, .bar)');
    expect(pseudoNode.evaluated).toBe(false);
    expect(pseudoNode.registrationPrepared).toBe(false);
  });

  it('writes resolved pseudo selector output into segmented buffers', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);
    const buffer = createRenderBuffer('segmented');

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    const originalResolve = pseudoNode.resolve;
    let resolveCalls = 0;
    pseudoNode.resolve = function countResolveCalls(
      this: typeof pseudoNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };
    const rendered = pseudoNode.render(context, buffer);

    expect(rendered).toBe(':is(.foo, .bar)');
    expect(buffer.segments).toEqual([':is(.foo, .bar)']);
    expect(resolveCalls).toBe(0);
    expect(pseudoNode.evaluated).toBe(false);
    expect(pseudoNode.registrationPrepared).toBe(false);
  });

  it('resolves pseudo selector values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    const resolved = await pseudoNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe(':is(.foo, .bar)');
    expect(pseudoNode.evaluated).toBe(false);
    expect(pseudoNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source pseudo selector values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([el('.foo'), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    const sourceArg = pseudoNode.value.arg;
    const resolved = await pseudoNode.resolve(context);

    expect(resolved.render(context)).toBe(':is(.foo, .bar)');
    expect(sourceArg?.parent).toBe(pseudoNode);
    expect(pseudoNode.toTrimmedString()).toBe(':is($capture-selector-list)');
  });

  it('keeps generated pseudo selector placement output owned when arg evaluation changes', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([sel([el('.foo'), co(' '), el('.bar')])])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    pseudoNode.generated = true;
    const sourceArg = pseudoNode.value.arg;
    const resolved = await pseudoNode.resolve(context);

    expect(resolved).toBeInstanceOf(PseudoSelector);
    expect(resolved).not.toBe(pseudoNode);
    expect(resolved.generated).toBe(true);
    expect(resolved.render(context)).toBe('.foo .bar');
    expect(sourceArg?.parent).toBe(pseudoNode);
    expect(pseudoNode.toTrimmedString()).toBe(':is($capture-selector-list)');
  });

  it('omits generated :is() wrappers for evaluated selector placement args', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: sel([el('.foo'), co(' '), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector' }, { type: 'variable' })
    });
    pseudoNode.generated = true;
    const sourceArg = pseudoNode.value.arg;
    const resolved = await pseudoNode.resolve(context);

    expect(resolved).toBeInstanceOf(PseudoSelector);
    expect(resolved).not.toBe(pseudoNode);
    expect(resolved.generated).toBe(true);
    expect(resolved.render(context)).toBe('.foo .bar');
    expect(resolved.keySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(resolved.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(sourceArg?.parent).toBe(pseudoNode);
    expect(pseudoNode.toTrimmedString()).toBe(':is($capture-selector)');
  });

  it('keeps generated pseudo placement state when cloned after selector evaluation', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector'),
        value: sel([el('.foo'), co(' '), el('.bar')])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector' }, { type: 'variable' })
    });
    pseudoNode.generated = true;
    const resolved = await pseudoNode.resolve(context);
    expect(resolved).toBeInstanceOf(PseudoSelector);
    if (!(resolved instanceof PseudoSelector)) {
      throw new Error('Expected PseudoSelector result');
    }

    const cloned = resolved.clone();

    expect(cloned.render(context)).toBe('.foo .bar');
  });

  it('keeps evaluated generated :is() keysets aligned with selector-list omission', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([sel([el('.foo'), co(' '), el('.bar')])])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    pseudoNode.generated = true;
    const resolved = await pseudoNode.resolve(context);

    expect(resolved).toBeInstanceOf(PseudoSelector);
    expect(resolved.render(context)).toBe('.foo .bar');
    expect(resolved.keySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(resolved.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(resolved.requiredKeySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
  });

  it('keeps nested generated pseudo placement text narrow without replacing selector metadata', async () => {
    const node = rules([
      vardecl({
        name: any('capture-selector-list'),
        value: sellist([sel([pseudo({
          name: ':unknown',
          arg: compound([el('.foo'), el('.bar')])
        })])])
      })
    ]);
    await setEvaluatedRoot(context, node);

    const pseudoNode = pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    });
    pseudoNode.generated = true;
    const sourceArg = pseudoNode.value.arg;
    const resolved = await pseudoNode.resolve(context);

    expect(resolved).toBeInstanceOf(PseudoSelector);
    expect(resolved.render(context)).toBe(':unknown(.foo.bar)');
    expect(sourceArg?.parent).toBe(pseudoNode);
    expect(resolved.keySet.equals(context.selectorBits.getBitset([':unknown', '.foo', '.bar']))).toBe(true);
  });
});
