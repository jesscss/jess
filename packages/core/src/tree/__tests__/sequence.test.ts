import { Node, any, list, num, ref, rules, seq, type Rules as RulesClass, vardecl } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createToken, type IToken } from 'chevrotain';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { getPrintOptions, OutputWriter, type PrintOptions } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

class DirectText extends Node<string> {
  override toString(options?: PrintOptions): string {
    return this.toTrimmedString(options);
  }

  override toTrimmedString(options?: PrintOptions): string {
    const w = getPrintOptions(options).writer!;
    w.add(this.value);
    return this.value;
  }
}

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

    const sequenceNode = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]);
    const rendered = sequenceNode.render(context);

    expect(rendered).toBe('10 20 30');
    expect(sequenceNode.evaluated).toBe(false);
    expect(sequenceNode.preEvaluated).toBe(false);
  });

  it('writes resolved sequence render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const buffer = createRenderBuffer('flat');
    const sequenceNode = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]);

    expect(await sequenceNode.render(context, buffer)).toBe('10 20 30');
    expect(buffer.parts).toEqual(['10 20 30']);
    expect(sequenceNode.evaluated).toBe(false);
    expect(sequenceNode.preEvaluated).toBe(false);
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

    const sequenceNode = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]);
    const resolved = await sequenceNode.resolve(context);

    expect(`${resolved}`).toBe('10 20 30');
    expect(sequenceNode.evaluated).toBe(false);
    expect(sequenceNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source sequence child containers canonical after resolve(context)', async () => {
    const root = rules([
      vardecl({
        name: any('item'),
        value: any('foo')
      })
    ]);
    const evald = await root.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const child = list([
      any('one'),
      ref({ key: 'item' }, { type: 'variable' })
    ]);
    const node = seq([
      num(0),
      child,
      num(2)
    ]);
    const resolved = await node.resolve(context);

    expect(`${resolved}`).toBe('0 one, foo 2');
    expect(child.parent).toBe(node);
    expect(child.toTrimmedString()).toBe('one, $item');
    expect(node.toTrimmedString()).toBe('0 one, $item 2');
  });

  it('keeps source sequence children canonical after sequence addition', () => {
    const leftChild = any('left');
    const rightChild = any('right');
    const left = seq([leftChild]);
    const right = seq([rightChild]);

    const result = left.operate(right, '+', context);

    expect(`${result}`).toBe('left right');
    expect(leftChild.parent).toBe(left);
    expect(rightChild.parent).toBe(right);
  });

  it('keeps source list children canonical after sequence plus list', () => {
    const leftChild = any('left');
    const rightChild = any('right');
    const left = seq([leftChild]);
    const right = list([rightChild]);

    const result = left.operate(right, '+', context);

    expect(`${result}`).toBe('left, right');
    expect(leftChild.parent).toBe(left);
    expect(rightChild.parent).toBe(right);
  });

  it('reuses childless source-free scalar leaves during sequence addition copies', () => {
    const originalClone = Node.prototype.clone;
    let scalarClones = 0;
    Node.prototype.clone = function cloneForCounting(
      this: Node,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.type === 'Any' && this.valueOf() === 'right') {
        scalarClones++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const result = seq([any('left')]).operate(seq([any('right')]), '+', context);

      expect(`${result}`).toBe('left right');
      expect(scalarClones).toBe(0);
    } finally {
      Node.prototype.clone = originalClone;
    }
  });

  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)]);
    expect(`${rule}`).toBe('10 20 30');
  });

  it('streams sequence items without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = seq([num(10), num(20), num(30)]);

    expect(rule.toTrimmedString({ writer })).toBe('10 20 30');
    expect(writer.captures).toBe(0);
  });

  it('does not inspect the emitted sequence text for each child boundary', () => {
    const writer = new CountingWriter();
    const rule = seq([
      new DirectText('10'),
      new DirectText('20'),
      new DirectText('30')
    ]);

    expect(rule.toTrimmedString({ writer })).toBe('10 20 30');
    expect(writer.reads).toBe(1);
  });

  it('uses trivia map source boundaries instead of inserting implicit sequence spacing', () => {
    const trivia = createTriviaMap({
      before: new Map(),
      after: new Map()
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = num(10, undefined, [0, 1, 1, 2, 1, 3], treeContext);
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
    const first = num(10, undefined, [0, 1, 1, 2, 1, 3], treeContext);
    const second = num(20, undefined, [2, 1, 3, 3, 1, 4], treeContext);
    const rule = seq([first, second]);
    context.opts.trivia = trivia;

    expect(rule.render(context, { trivia })).toBe('1020');
  });

  it('does not let source adjacency merge evaluated identifier-like values', () => {
    const trivia = createTriviaMap({
      before: new Map(),
      after: new Map()
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = any('is', undefined, [0, 1, 1, 2, 1, 3], treeContext);
    const second = any('equal', undefined, [2, 1, 3, 7, 1, 8], treeContext);
    const rule = seq([first, second]);
    rule.evaluated = true;

    expect(rule.toTrimmedString({
      trivia
    })).toBe('is equal');
  });

  it('falls back to sequence spacing when source whitespace was already consumed', () => {
    const WS = createToken({ name: 'WS', pattern: / +/ });
    const whitespace = [{
      image: ' ',
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
    const first = any('is', undefined, [0, 1, 1, 1, 1, 2], treeContext);
    const second = any('equal', undefined, [3, 1, 4, 7, 1, 8], treeContext);
    const rule = seq([first, second]);
    rule.evaluated = true;

    expect(rule.toTrimmedString({
      emittedTrivia: new Set([whitespace]),
      trivia
    })).toBe('is equal');
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
