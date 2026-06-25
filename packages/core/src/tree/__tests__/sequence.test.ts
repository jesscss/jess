import { Node, Sequence, any, list, nil, num, op, ref, rules, seq, F_MAY_ASYNC, F_STATIC, type Rules as RulesClass, vardecl } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createToken, type IToken } from 'chevrotain';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { getPrintOptions, OutputWriter, type PrintOptions } from '../util/print.js';
import { createRenderBuffer, type FlatRenderBuffer } from '../util/render-buffer.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const v = Reflect.get(this, 'value') as string;
    w.add(v);
    return v;
  }
}

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error('Expected Rules root');
  }
  context.root = evald;
  context.rulesContext = evald;
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

  it('stores child nodes on canonical value', () => {
    const first = num(10);
    const second = num(20);
    const rule = seq([first, second]);

    expect(Sequence.childKeys).toEqual(['value']);
    expect(rule.value).toEqual([first, second]);
  });

  it('serializes empty sequence syntax without writer readback scaffolding', () => {
    const writer = new CountingWriter();

    expect(seq([]).toTrimmedString({ writer })).toBe('');
    expect(writer.toString()).toBe('');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('compares against Any without public string transport for the Any operand', () => {
    const other = any('10 20 30');
    let stringCalls = 0;
    other.toString = () => {
      stringCalls++;
      return 'not-10-20-30';
    };

    expect(seq([num(10), num(20), num(30)]).compare(other)).toBe(0);
    expect(stringCalls).toBe(0);
  });

  it('compares against Any without public string transport for the Sequence operand', () => {
    const node = seq([num(10), num(20), num(30)]);
    node.toString = () => {
      throw new Error('Sequence compare should use direct syntax instead of public toString transport');
    };

    expect(node.compare(any('10 20 30'))).toBe(0);
  });

  it('does not allocate options when resolving a default single-item sequence', async () => {
    const rule = seq([num(10)]);

    const resolved = await rule.resolve(context);

    expect(resolved.toTrimmedString()).toBe('10');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('resolves dynamic unchanged sequences without a replacement surface', async () => {
    const sequenceNode = seq([any('one'), any('two')]);
    sequenceNode.removeFlag(F_STATIC);
    const descriptor = Object.getOwnPropertyDescriptor(Sequence.prototype, 'withValue');
    if (!descriptor) {
      throw new Error('Expected Sequence.withValue for resolve materialization proof');
    }

    Object.defineProperty(Sequence.prototype, 'withValue', {
      ...descriptor,
      value: () => {
        throw new Error('unchanged dynamic sequence resolve should return the source sequence');
      }
    });
    try {
      const resolved = await sequenceNode.resolve(context);

      expect(resolved).toBe(sequenceNode);
      expect(resolved.toTrimmedString()).toBe('one two');
    } finally {
      Object.defineProperty(Sequence.prototype, 'withValue', descriptor);
    }
  });

  it('renders resolved sequence values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const sequenceNode = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]);
    const originalResolve = sequenceNode.resolve;
    let resolveCalls = 0;
    sequenceNode.resolve = function countResolveCalls(
      this: typeof sequenceNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };
    const rendered = sequenceNode.render(context);

    expect(rendered).toBe('10 20 30');
    expect(resolveCalls).toBe(0);
    expect(sequenceNode.evaluated).toBe(false);
    expect(sequenceNode.registrationPrepared).toBe(false);
  });

  it('renders dynamic sync sequence values without per-call serial iteration scaffolding', () => {
    const sequenceNode = seq([
      op([num(1), '+', num(2)]),
      any('solid')
    ]);
    const originalMap = sequenceNode.value.map;
    Object.defineProperty(sequenceNode.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('sync sequence render should not allocate mapped serial iteration entries');
      }
    });

    try {
      expect(sequenceNode.render(context)).toBe('3 solid');
    } finally {
      Object.defineProperty(sequenceNode.value, 'map', {
        configurable: true,
        writable: true,
        value: originalMap
      });
    }
  });

  it('renders async sequence values without tuple-array serial iteration scaffolding', async () => {
    const asyncItem = any('one');
    asyncItem.resolve = async () => any('resolved');
    asyncItem.render = async () => {
      throw new Error('async sequence render should render the resolved item, not the source item');
    };
    asyncItem.addFlag(F_MAY_ASYNC);
    asyncItem.removeFlag(F_STATIC);
    const sequenceNode = seq([
      asyncItem,
      any('solid')
    ]);
    sequenceNode.addFlag(F_MAY_ASYNC);
    sequenceNode.removeFlag(F_STATIC);
    const originalMap = sequenceNode.value.map;
    Object.defineProperty(sequenceNode.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('async sequence render should not allocate mapped tuple entries');
      }
    });

    try {
      await expect(Promise.resolve(sequenceNode.render(context))).resolves.toBe('resolved solid');
    } finally {
      Object.defineProperty(sequenceNode.value, 'map', {
        configurable: true,
        writable: true,
        value: originalMap
      });
    }
  });

  it('renders dynamic sync sequence items directly without resolving them first', () => {
    const dynamicItem = op([num(1), '+', num(2)]);
    const originalResolve = dynamicItem.resolve;
    dynamicItem.resolve = function throwOnResolve(): never {
      throw new Error('sync sequence render should not resolve items before rendering');
    };
    const sequenceNode = seq([
      dynamicItem,
      any('solid')
    ]);

    try {
      expect(sequenceNode.render(context)).toBe('3 solid');
    } finally {
      dynamicItem.resolve = originalResolve;
    }
  });

  it('writes dynamic sync direct sequence render output into flat buffers once', () => {
    const buffer = createRenderBuffer('flat');
    const sequenceNode = seq([
      op([num(1), '+', num(2)]),
      any('solid')
    ]);

    expect(sequenceNode.render(context, buffer)).toBe('3 solid');
    expect(buffer.parts).toEqual(['3 solid']);
  });

  it('writes dynamic sync direct sequence render output into shared flat buffers with one mark', () => {
    const buffer = createRenderBuffer('flat');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (buffer as FlatRenderBuffer & { shareWriter: boolean }).shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const sequenceNode = seq([
      op([num(1), '+', num(2)]),
      any('solid')
    ]);

    expect(sequenceNode.render(context, buffer)).toBe('3 solid');
    expect(buffer.parts.join('')).toBe('3 solid');
    expect(writer.marks).toBe(1);
    expect(writer.reads).toBe(1);
  });

  it('renders empty sequences without writer readback scaffolding', () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');
    const sequenceNode = seq([]);

    expect(sequenceNode.render(context, { writer })).toBe('');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(sequenceNode.render(context, buffer, { writer })).toBe('');
    expect(buffer.parts).toEqual([]);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('writes resolved sequence render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const buffer = createRenderBuffer('flat');
    const sequenceNode = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]);
    const originalResolve = sequenceNode.resolve;
    let resolveCalls = 0;
    sequenceNode.resolve = function countResolveCalls(
      this: typeof sequenceNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await sequenceNode.render(context, buffer)).toBe('10 20 30');
    expect(buffer.parts).toEqual(['10 20 30']);
    expect(resolveCalls).toBe(0);
    expect(sequenceNode.evaluated).toBe(false);
    expect(sequenceNode.registrationPrepared).toBe(false);
  });

  it('writes async single-item sequence output into flat buffers directly', async () => {
    const asyncItem = any('source');
    asyncItem.resolve = async () => any('resolved');
    asyncItem.render = async () => {
      throw new Error('async sequence buffer render should render the resolved item, not the source item');
    };
    asyncItem.addFlag(F_MAY_ASYNC);
    asyncItem.removeFlag(F_STATIC);
    const sequenceNode = seq([asyncItem]);
    sequenceNode.addFlag(F_MAY_ASYNC);
    sequenceNode.removeFlag(F_STATIC);
    const buffer = createRenderBuffer('flat');

    await expect(Promise.resolve(sequenceNode.render(context, buffer))).resolves.toBe('resolved');
    expect(buffer.parts).toEqual(['resolved']);
  });

  it('resolves sequence values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('mid'),
        value: num(20)
      })
    ]);
    await setEvaluatedRoot(context, node);

    const sequenceNode = seq([
      num(10),
      ref({ key: 'mid' }, { type: 'variable' }),
      num(30)
    ]);
    const resolved = await sequenceNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('10 20 30');
    expect(sequenceNode.evaluated).toBe(false);
    expect(sequenceNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('resolves sequence values without filter-array finalization scaffolding', async () => {
    const sequenceNode = seq([
      op([num(1), '+', num(2)]),
      any('solid')
    ]);
    const originalFilter = Array.prototype.filter;
    let resolved: Node | undefined;
    Array.prototype.filter = function filterForSequenceFinalizationProof(): never {
      throw new Error('sequence resolve should not filter evaluated values');
    };
    try {
      resolved = await Promise.resolve(sequenceNode.resolve(context));
    } finally {
      Array.prototype.filter = originalFilter;
    }

    expect(resolved?.toTrimmedString()).toBe('3 solid');
  });

  it('renders static sequence values without filter-array render scaffolding', () => {
    const sequenceNode = seq([
      any('left'),
      any('right')
    ]);
    const originalFilter = sequenceNode.value.filter;
    let rendered = '';
    Object.defineProperty(sequenceNode.value, 'filter', {
      configurable: true,
      value: () => {
        throw new Error('sequence render should not filter rendered values');
      }
    });

    try {
      rendered = sequenceNode.render(context);
    } finally {
      Object.defineProperty(sequenceNode.value, 'filter', {
        configurable: true,
        writable: true,
        value: originalFilter
      });
    }

    expect(rendered).toBe('left right');
  });

  it('renders static sequence values with nil children without replacement arrays', () => {
    const sequenceNode = seq([
      nil(),
      any('left'),
      nil(),
      any('right')
    ]);
    const originalFilter = sequenceNode.value.filter;
    let rendered = '';
    Object.defineProperty(sequenceNode.value, 'filter', {
      configurable: true,
      value: () => {
        throw new Error('sequence render should not filter nil children into a replacement array');
      }
    });

    try {
      rendered = sequenceNode.render(context);
    } finally {
      Object.defineProperty(sequenceNode.value, 'filter', {
        configurable: true,
        writable: true,
        value: originalFilter
      });
    }

    expect(rendered).toBe('left right');
    expect(sequenceNode.toTrimmedString()).toBe('left right');
  });

  it('writes static sequence values with nil children into flat buffers directly', () => {
    const buffer = createRenderBuffer('flat');
    const sequenceNode = seq([
      nil(),
      any('left'),
      nil(),
      any('right')
    ]);

    expect(sequenceNode.render(context, buffer)).toBe('left right');
    expect(buffer.parts).toEqual(['left right']);
  });

  it('writes static sequence render output into shared flat buffers with one mark', () => {
    const buffer = createRenderBuffer('flat');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (buffer as FlatRenderBuffer & { shareWriter: boolean }).shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const sequenceNode = seq([
      any('left'),
      any('right')
    ]);

    expect(sequenceNode.render(context, buffer)).toBe('left right');
    expect(buffer.parts).toEqual(['left', ' ', 'right']);
    expect(writer.marks).toBe(1);
  });

  it('keeps single-item sequence buffer output out of explicit writers', () => {
    const buffer = createRenderBuffer('flat');
    const writer = new CountingWriter();
    const sequenceNode = seq([any('left')]);

    expect(sequenceNode.render(context, buffer, { writer })).toBe('left');
    expect(buffer.parts).toEqual(['left']);
    expect(writer.toString()).toBe('');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('keeps resolved single-item sequence buffer output out of explicit writers', async () => {
    const root = rules([
      vardecl({
        name: any('item'),
        value: any('resolved')
      })
    ]);
    await setEvaluatedRoot(context, root);
    const buffer = createRenderBuffer('flat');
    const writer = new CountingWriter();
    const sequenceNode = seq([ref({ key: 'item' }, { type: 'variable' })]);

    expect(await Promise.resolve(sequenceNode.render(context, buffer, { writer }))).toBe('resolved');
    expect(buffer.parts).toEqual(['resolved']);
    expect(writer.toString()).toBe('');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('keeps source sequence child containers canonical after resolve(context)', async () => {
    const root = rules([
      vardecl({
        name: any('item'),
        value: any('foo')
      })
    ]);
    await setEvaluatedRoot(context, root);

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

    expect(resolved.render(context)).toBe('0 one, foo 2');
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

    expect(result.toTrimmedString()).toBe('left right');
    expect(leftChild.parent).toBe(left);
    expect(rightChild.parent).toBe(right);
  });

  it('assembles sequence addition output without result-array push staging', () => {
    const originalPush = Array.prototype.push;
    let pushCalls = 0;
    Array.prototype.push = function countPush<T>(this: T[], ...items: T[]): number {
      pushCalls++;
      return originalPush.apply(this, items);
    };

    try {
      const result = seq([any('left')]).operate(seq([any('right')]), '+', context);

      expect(pushCalls).toBe(0);
      expect(result.toTrimmedString()).toBe('left right');
    } finally {
      Array.prototype.push = originalPush;
    }
  });

  it('adds sequence values without mapped copy-array scaffolding', () => {
    const left = seq([any('left')]);
    const right = seq([any('right')]);
    const originalLeftMap = left.value.map;
    const originalRightMap = right.value.map;
    Object.defineProperty(left.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('sequence addition should not map left child copies');
      }
    });
    Object.defineProperty(right.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('sequence addition should not map right child copies');
      }
    });

    try {
      const result = left.operate(right, '+', context);

      expect(result.toTrimmedString()).toBe('left right');
    } finally {
      Object.defineProperty(left.value, 'map', {
        configurable: true,
        writable: true,
        value: originalLeftMap
      });
      Object.defineProperty(right.value, 'map', {
        configurable: true,
        writable: true,
        value: originalRightMap
      });
    }
  });

  it('keeps source list children canonical after sequence plus list', () => {
    const leftChild = any('left');
    const rightChild = any('right');
    const left = seq([leftChild]);
    const right = list([rightChild]);

    const result = left.operate(right, '+', context);

    expect(result.toTrimmedString()).toBe('left, right');
    expect(leftChild.parent).toBe(left);
    expect(rightChild.parent).toBe(right);
  });

  it('adds list values to sequences without mapped copy-array scaffolding', () => {
    const left = seq([any('left')]);
    const right = list([any('right')]);
    const originalLeftMap = left.value.map;
    const originalRightMap = right.value.map;
    Object.defineProperty(left.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('sequence plus list should not map left child copies');
      }
    });
    Object.defineProperty(right.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('sequence plus list should not map right child copies');
      }
    });

    try {
      const result = left.operate(right, '+', context);

      expect(result.toTrimmedString()).toBe('left, right');
    } finally {
      Object.defineProperty(left.value, 'map', {
        configurable: true,
        writable: true,
        value: originalLeftMap
      });
      Object.defineProperty(right.value, 'map', {
        configurable: true,
        writable: true,
        value: originalRightMap
      });
    }
  });

  it('derives sequence addition output without reconstructing the source sequence', () => {
    class CountingSequence extends Sequence {
      static countConstructions = false;
      static constructedCopies = 0;

      constructor(...args: ConstructorParameters<typeof Sequence>) {
        super(...args);
        if (CountingSequence.countConstructions) {
          CountingSequence.constructedCopies++;
        }
      }
    }

    const leftChild = any('left');
    const rightChild = any('right');
    const left = new CountingSequence([leftChild]);
    const right = seq([rightChild]);

    CountingSequence.countConstructions = true;
    try {
      const result = left.operate(right, '+', context);

      expect(result.toTrimmedString()).toBe('left right');
      expect(CountingSequence.constructedCopies).toBe(0);
      expect(leftChild.parent).toBe(left);
      expect(rightChild.parent).toBe(right);
    } finally {
      CountingSequence.countConstructions = false;
    }
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

      expect(result.toTrimmedString()).toBe('left right');
      expect(scalarClones).toBe(0);
    } finally {
      Node.prototype.clone = originalClone;
    }
  });

  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)]);
    expect(rule.toTrimmedString()).toBe('10 20 30');
  });

  it('streams sequence items without capture scaffolding', () => {
    const writer = new CountingWriter();
    const rule = seq([num(10), num(20), num(30)]);

    expect(rule.toTrimmedString({ writer })).toBe('10 20 30');
    expect(writer.captures).toBe(0);
  });

  it('writes sequence items without public toString transport when trivia is inactive', () => {
    const first = any('10');
    const second = any('20');
    const third = any('30');
    let stringCalls = 0;
    first.toString = second.toString = third.toString = () => {
      stringCalls++;
      return '';
    };

    expect(seq([first, second, third]).toTrimmedString()).toBe('10 20 30');
    expect(stringCalls).toBe(0);
  });

  it('writes sequence items without public toString transport when trivia is active', () => {
    const WS = createToken({ name: 'WS', pattern: / +/ });
    const whitespace = [{
      image: '  ',
      startOffset: 2,
      endOffset: 2,
      tokenTypeIdx: WS.tokenTypeIdx!,
      tokenType: WS
    }] satisfies IToken[];
    const trivia = createTriviaMap({
      before: new Map([[3, whitespace]]),
      after: new Map([[1, whitespace]])
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const first = num(10, undefined, [0, 1, 1, 1, 1, 2], treeContext);
    const second = num(20, undefined, [3, 1, 4, 4, 1, 5], treeContext);
    let stringCalls = 0;
    first.toString = second.toString = () => {
      stringCalls++;
      return '';
    };

    expect(seq([first, second]).toTrimmedString({ trivia })).toBe('10  20');
    expect(stringCalls).toBe(0);
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
    const rNode = rules([rule]);
    rNode._treeContext = treeContext;

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
    const rNode = rules([rule]);
    rNode._treeContext = treeContext;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (context.opts as Record<string, unknown>).trivia = trivia;

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
    const rNode = rules([rule]);
    rNode._treeContext = treeContext;
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
      tokenTypeIdx: WS.tokenTypeIdx!,
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
    const rNode = rules([rule]);
    rNode._treeContext = treeContext;
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
      tokenTypeIdx: WS.tokenTypeIdx!,
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
    const rNode = rules([rule]);
    rNode._treeContext = treeContext;

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
      tokenTypeIdx: WS.tokenTypeIdx!,
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
    const rNode = rules([rule]);
    rNode._treeContext = treeContext;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (context.opts as Record<string, unknown>).trivia = trivia;

    expect(rule.render(context, { trivia })).toBe('10  20');
  });
});
