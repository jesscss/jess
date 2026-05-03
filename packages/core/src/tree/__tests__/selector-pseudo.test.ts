import { beforeEach, describe, expect, it } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';
import type { IToken } from 'chevrotain';
import { any, co, compound, el, pseudo, ref, rules, sel, sellist, type Rules as RulesClass, vardecl } from '../index.js';
import { createTriviaMap } from '../util/trivia.js';

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

    const resolved = await pseudo({
      name: ':is',
      arg: ref({ key: 'capture-selector-list' }, { type: 'variable' })
    }).resolve(context);

    expect(`${resolved}`).toBe(':is(.foo, .bar)');
    expect(context.printState.writer).toBeUndefined();
  });
});
