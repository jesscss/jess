import { any, num, ref, rules, seq, type Rules as RulesClass, vardecl } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createToken, type IToken } from 'chevrotain';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';

/**
 * @todo - sequences need to make sure that the result could be re-parsed
 *         as distinct tokens. We should get rid of `spaced` and properly
 *         check that the result is spaced correctly.
 */
describe('Sequence', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders sequence syntax through toTrimmedString()', () => {
    const rule = seq([num(10), num(20), num(30)]);

    expect(rule.toTrimmedString()).toBe('10 20 30');
  });

  it('does not allocate options when resolving a default single-item sequence', async () => {
    const rule = seq([num(10)]);

    const resolved = await rule.resolve(context);

    expect(`${resolved}`).toBe('10');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved sequence values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]).render(context);

    expect(rendered).toBe('10 20 30');
  });

  it('resolves sequence values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]).resolve(context);

    expect(`${resolved}`).toBe('10 20 30');
    expect(context.printState.writer).toBeUndefined();
  });

  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)]);
    expect(`${rule}`).toBe('10 20 30');
  });

  it('uses trivia map source boundaries instead of inserting implicit sequence spacing', () => {
    const trivia = createTriviaMap({
      before: new Map(),
      after: new Map()
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = num(10, undefined, [0, 1, 1, 1, 1, 2], treeContext);
    const second = num(20, undefined, [2, 1, 3, 3, 1, 4], treeContext);
    const rule = seq([first, second]);

    expect(rule.toTrimmedString({
      trivia
    })).toBe('1020');
  });

  it('uses trivia map source boundaries while rendering through context', () => {
    const trivia = createTriviaMap({
      before: new Map(),
      after: new Map()
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = num(10, undefined, [0, 1, 1, 1, 1, 2], treeContext);
    const second = num(20, undefined, [2, 1, 3, 3, 1, 4], treeContext);
    const rule = seq([first, second]);
    context.opts.trivia = trivia;

    expect(rule.render(context, { trivia })).toBe('1020');
  });

  it('emits consumed trivia map whitespace between source-backed sequence nodes', () => {
    const WS = createToken({ name: 'WS', pattern: / +/ });
    const whitespace = [{
      image: '  ',
      startOffset: 2,
      endOffset: 2,
      tokenTypeIdx: WS.tokenTypeIdx,
      tokenType: WS
    }] satisfies IToken[];
    const trivia = createTriviaMap({
      before: new Map([[3, whitespace]]),
      after: new Map([[1, whitespace]])
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = num(10, undefined, [0, 1, 1, 1, 1, 2], treeContext);
    const second = num(20, undefined, [3, 1, 4, 4, 1, 5], treeContext);
    const rule = seq([first, second]);

    expect(rule.toTrimmedString({
      trivia
    })).toBe('10  20');
  });

  it('emits source trivia between sequence nodes while rendering through context', () => {
    const WS = createToken({ name: 'WS', pattern: / +/ });
    const whitespace = [{
      image: '  ',
      startOffset: 2,
      endOffset: 2,
      tokenTypeIdx: WS.tokenTypeIdx,
      tokenType: WS
    }] satisfies IToken[];
    const trivia = createTriviaMap({
      before: new Map([[3, whitespace]]),
      after: new Map([[1, whitespace]])
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = num(10, undefined, [0, 1, 1, 1, 1, 2], treeContext);
    const second = num(20, undefined, [3, 1, 4, 4, 1, 5], treeContext);
    const rule = seq([first, second]);
    context.opts.trivia = trivia;

    expect(rule.render(context, { trivia })).toBe('10  20');
  });
});
