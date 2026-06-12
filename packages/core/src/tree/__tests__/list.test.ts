import type { IToken } from 'chevrotain';
import { TreeContext, List, list, spaced, num, any, op, ref, rules, vardecl, F_MAY_ASYNC, F_STATIC, type Rules as RulesClass } from '../index.js';
import { Any } from '../any.js';
import { Context } from '../../context.js';
import { Node } from '../node.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  if (!isNode(evald, N.Rules)) {
    throw new Error(`Expected Rules root, received ${evald.type}`);
  }
  context.root = evald;
  context.rulesContext = evald;
}

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('List compare', () => {
  it('treats separator differences as equal in strict mode', () => {
    const strictContext = new TreeContext({ equalityMode: 'strict' });
    const commaList = list([num(1), num(2), num(3)], { sep: ',' }, undefined, strictContext);
    const semicolonList = list([num(1), num(2), num(3)], { sep: ';' }, undefined, strictContext);
    expect(commaList.compare(semicolonList)).toBe(0);
  });

  it('treats separator differences as equal in coerce mode', () => {
    const coerceContext = new TreeContext({ equalityMode: 'coerce' });
    const commaList = list([num(1), num(2), num(3)], { sep: ',' }, undefined, coerceContext);
    const semicolonList = list([num(1), num(2), num(3)], { sep: ';' }, undefined, coerceContext);
    expect(commaList.compare(semicolonList)).toBe(0);
  });
});

let context: Context;

describe('List', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('renders list syntax through toTrimmedString()', () => {
    const rule = list([spaced([num(1), any('2'), any('3')]), any('four')]);

    expect(rule.toTrimmedString()).toBe('1 2 3, four');
  });

  it('does not allocate options when rendering list syntax with defaults', () => {
    const rule = list([num(1), num(2), num(3)]);

    expect(rule.toTrimmedString()).toBe('1, 2, 3');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('emits trivia before parser-owned list separators', () => {
    const first = new Any('screen', undefined, [0, 1, 1, 5, 1, 6]);
    const second = new Any('print', undefined, [23, 1, 24, 27, 1, 28]);
    const tokens = [token(' '), token('/* comment */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[21, tokens]]),
      after: new Map([[first.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(list([first, second]).toString({ trivia })).toBe('screen /* comment */, print');
  });

  it('streams list items without capture scaffolding', () => {
    const writer = new CountingWriter();
    const first = new Any('screen', undefined, [0, 1, 1, 5, 1, 6]);
    const second = new Any('print', undefined, [23, 1, 24, 27, 1, 28]);
    const tokens = [token(' '), token('/* comment */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map([[21, tokens]]),
      after: new Map([[first.location[3], tokens]])
    }) satisfies TriviaMap;

    expect(list([first, second]).toString({ trivia, writer })).toBe('screen /* comment */, print');
    expect(writer.captures).toBe(0);
  });

  it('leaves plain separator whitespace to list syntax', () => {
    const first = new Any('10px', undefined, [0, 1, 1, 3, 1, 4]);
    const second = new Any('2', undefined, [7, 1, 8, 7, 1, 8]);
    const trivia = createTriviaMap({
      before: new Map([[5, [token(' ')]]]),
      after: new Map<number, IToken[]>()
    }) satisfies TriviaMap;

    expect(list([first, second], { sep: '/' }).toString({ trivia })).toBe('10px / 2');
  });

  it('preserves multiline separator whitespace without capture scaffolding', () => {
    const writer = new CountingWriter();
    const first = new Any('the', undefined, [0, 1, 1, 2, 1, 3]);
    const second = new Any('great', undefined, [14, 2, 14, 18, 2, 19]);
    const third = new Any('wall', undefined, [30, 3, 14, 33, 3, 18]);
    const trivia = createTriviaMap({
      before: new Map([
        [second.location[0], [token('\n            ')]],
        [third.location[0], [token('\n            ')]]
      ]),
      after: new Map<number, IToken[]>()
    }) satisfies TriviaMap;

    expect(list([first, second, third]).toString({ trivia, writer })).toBe(
      'the,\n            great,\n            wall'
    );
    expect(writer.captures).toBe(0);
  });

  it('renders resolved list values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const listNode = list([
      spaced([num(1), any('2'), any('3')]),
      ref({ key: 'item' }, { type: 'variable' })
    ]);
    const originalResolve = listNode.resolve;
    let resolveCalls = 0;
    listNode.resolve = function countResolveCalls(
      this: typeof listNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };
    const rendered = listNode.render(context);

    expect(rendered).toBe('1 2 3, four');
    expect(resolveCalls).toBe(0);
    expect(listNode.evaluated).toBe(false);
    expect(listNode.registrationPrepared).toBe(false);
  });

  it('writes resolved list render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const buffer = createRenderBuffer('flat');
    const listNode = list([
      spaced([num(1), any('2'), any('3')]),
      ref({ key: 'item' }, { type: 'variable' })
    ]);
    const originalResolve = listNode.resolve;
    let resolveCalls = 0;
    listNode.resolve = function countResolveCalls(
      this: typeof listNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    expect(await listNode.render(context, buffer)).toBe('1 2 3, four');
    expect(buffer.parts).toEqual(['1 2 3, four']);
    expect(resolveCalls).toBe(0);
    expect(listNode.evaluated).toBe(false);
    expect(listNode.registrationPrepared).toBe(false);
  });

  it('renders dynamic list values without materializing a replacement list', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    await setEvaluatedRoot(context, node);
    const descriptor = Object.getOwnPropertyDescriptor(List.prototype, 'withResolvedValue');
    if (!descriptor) {
      throw new Error('Expected List.withResolvedValue for render materialization proof');
    }
    const listNode = list([
      any('one'),
      ref({ key: 'item' }, { type: 'variable' })
    ]);

    Object.defineProperty(List.prototype, 'withResolvedValue', {
      ...descriptor,
      value: () => {
        throw new Error('List render should stream resolved values without a replacement list');
      }
    });
    try {
      expect(listNode.render(context)).toBe('one, four');
    } finally {
      Object.defineProperty(List.prototype, 'withResolvedValue', descriptor);
    }
  });

  it('renders dynamic sync list values without per-call serial iteration scaffolding', () => {
    const listNode = list([
      op([num(1), '+', num(2)]),
      any('solid')
    ]);
    const originalMap = listNode.value.map;
    Object.defineProperty(listNode.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('sync list render should not allocate mapped serial iteration entries');
      }
    });

    try {
      expect(listNode.render(context)).toBe('3, solid');
    } finally {
      Object.defineProperty(listNode.value, 'map', {
        configurable: true,
        writable: true,
        value: originalMap
      });
    }
  });

  it('renders async list values without tuple-array serial iteration scaffolding', async () => {
    const asyncItem = any('one');
    asyncItem.resolve = async () => any('resolved');
    asyncItem.render = async () => {
      throw new Error('async list render should render the resolved item, not the source item');
    };
    asyncItem.addFlag(F_MAY_ASYNC);
    asyncItem.removeFlag(F_STATIC);
    const listNode = list([
      asyncItem,
      any('solid')
    ]);
    listNode.addFlag(F_MAY_ASYNC);
    listNode.removeFlag(F_STATIC);
    const originalMap = listNode.value.map;
    Object.defineProperty(listNode.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('async list render should not allocate mapped tuple entries');
      }
    });

    try {
      await expect(Promise.resolve(listNode.render(context))).resolves.toBe('resolved, solid');
    } finally {
      Object.defineProperty(listNode.value, 'map', {
        configurable: true,
        writable: true,
        value: originalMap
      });
    }
  });

  it('renders dynamic sync list items directly without resolving the list items first', () => {
    const dynamicItem = op([num(1), '+', num(2)]);
    dynamicItem.resolve = () => {
      throw new Error('List render should render dynamic sync items directly');
    };
    const listNode = list([
      dynamicItem,
      any('solid')
    ]);

    expect(listNode.render(context)).toBe('3, solid');
  });

  it('writes dynamic sync direct list render output into flat buffers once', () => {
    const buffer = createRenderBuffer('flat');
    const listNode = list([
      op([num(1), '+', num(2)]),
      any('solid')
    ]);

    expect(listNode.render(context, buffer)).toBe('3, solid');
    expect(buffer.parts).toEqual(['3, solid']);
  });

  it('resolves list values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const listNode = list([
      spaced([num(1), any('2'), any('3')]),
      ref({ key: 'item' }, { type: 'variable' })
    ]);
    const resolved = await listNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('1 2 3, four');
    expect(listNode.evaluated).toBe(false);
    expect(listNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('returns static lists without resolving child values', async () => {
    const first = any('one');
    const second = any('two');
    const listNode = list([first, second]);
    first.resolve = () => {
      throw new Error('static list children should not resolve');
    };
    second.resolve = () => {
      throw new Error('static list children should not resolve');
    };

    const resolved = await listNode.resolve(context);

    expect(resolved).toBe(listNode);
    expect(resolved.toTrimmedString()).toBe('one, two');
  });

  it('resolves dynamic unchanged lists without a replacement surface', async () => {
    const listNode = list([any('one'), any('two')]);
    listNode.removeFlag(F_STATIC);
    const descriptor = Object.getOwnPropertyDescriptor(List.prototype, 'withResolvedValue');
    if (!descriptor) {
      throw new Error('Expected List.withResolvedValue for resolve materialization proof');
    }

    Object.defineProperty(List.prototype, 'withResolvedValue', {
      ...descriptor,
      value: () => {
        throw new Error('unchanged dynamic list resolve should return the source list');
      }
    });
    try {
      const resolved = await listNode.resolve(context);

      expect(resolved).toBe(listNode);
      expect(resolved.toTrimmedString()).toBe('one, two');
    } finally {
      Object.defineProperty(List.prototype, 'withResolvedValue', descriptor);
    }
  });

  it('keeps source list values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const listNode = list([
      any('one'),
      ref({ key: 'item' }, { type: 'variable' })
    ]);
    const resolved = await listNode.resolve(context);

    expect(resolved.render(context)).toBe('one, four');
    expect(listNode.toTrimmedString()).toBe('one, $item');
  });

  it('keeps source list children canonical after list addition', () => {
    const leftChild = any('left');
    const rightChild = any('right');
    const left = list([leftChild]);
    const right = list([rightChild]);

    const result = left.operate(right, '+', context);

    expect(result.toTrimmedString()).toBe('left, right');
    expect(leftChild.parent).toBe(left);
    expect(rightChild.parent).toBe(right);
  });

  it('adds list values without mapped copy-array scaffolding', () => {
    const left = list([any('left')]);
    const right = list([any('right')]);
    const originalLeftMap = left.value.map;
    const originalRightMap = right.value.map;
    Object.defineProperty(left.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('list addition should not map left child copies');
      }
    });
    Object.defineProperty(right.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('list addition should not map right child copies');
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

  it('keeps source scalar children canonical after list plus scalar', () => {
    const leftChild = any('left');
    const right = any('right');
    const left = list([leftChild]);

    const result = left.operate(right, '+', context);

    expect(result.toTrimmedString()).toBe('left, right');
    expect(leftChild.parent).toBe(left);
    expect(right.parent).toBeUndefined();
  });

  it('derives list addition output without reconstructing the source list', () => {
    class CountingList extends List {
      static countConstructions = false;
      static constructedCopies = 0;

      constructor(...args: ConstructorParameters<typeof List>) {
        super(...args);
        if (CountingList.countConstructions) {
          CountingList.constructedCopies++;
        }
      }
    }

    const leftChild = any('left');
    const rightChild = any('right');
    const left = new CountingList([leftChild]);
    const right = list([rightChild]);

    CountingList.countConstructions = true;
    try {
      const result = left.operate(right, '+', context);

      expect(result.toTrimmedString()).toBe('left, right');
      expect(CountingList.constructedCopies).toBe(0);
      expect(leftChild.parent).toBe(left);
      expect(rightChild.parent).toBe(right);
    } finally {
      CountingList.countConstructions = false;
    }
  });

  it('reuses childless source-free scalar leaves during list addition copies', () => {
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
      const result = list([any('left')]).operate(list([any('right')]), '+', context);

      expect(result.toTrimmedString()).toBe('left, right');
      expect(scalarClones).toBe(0);
    } finally {
      Node.prototype.clone = originalClone;
    }
  });

  it('should serialize to a list', () => {
    let rule = list([spaced([num(1), any('2'), any('3')]), any('four')]);
    expect(rule.toTrimmedString()).toBe('1 2 3, four');
  });
  // it('should serialize to a module', () => {
  //   let rule = list([spaced([any('1'), any('2'), any('3')]), any('four')])
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.list([\n  $J.spaced([$J.any("1"), $J.any("2"), $J.any("3")]),\n  "four"\n])'
  //   )
  // })
});
