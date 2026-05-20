import { beforeEach, describe, expect, it } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';
import type { IToken } from 'chevrotain';
import { any, co, compound, el, pseudo, ref, rules, sel, sellist, type Rules as RulesClass, vardecl } from '../index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
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
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

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
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;
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
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

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
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

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
});
