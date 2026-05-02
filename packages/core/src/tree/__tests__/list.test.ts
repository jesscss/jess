import type { IToken } from 'chevrotain';
import { TreeContext, list, spaced, num, any, ref, rules, vardecl, type Rules as RulesClass } from '../index.js';
import { Any } from '../any.js';
import { Context } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';

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
    const trivia = {
      before: new Map([[21, [token(' '), token('/* comment */', 'BlockComment')]]]),
      after: new Map<number, IToken[]>()
    } satisfies TriviaMap;

    expect(list([first, second]).toString({ trivia })).toBe('screen /* comment */, print');
  });

  it('leaves plain separator whitespace to list syntax', () => {
    const first = new Any('10px', undefined, [0, 1, 1, 3, 1, 4]);
    const second = new Any('2', undefined, [7, 1, 8, 7, 1, 8]);
    const trivia = {
      before: new Map([[5, [token(' ')]]]),
      after: new Map<number, IToken[]>()
    } satisfies TriviaMap;

    expect(list([first, second], { sep: '/' }).toString({ trivia })).toBe('10px / 2');
  });

  it('renders resolved list values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = list([
      spaced([num(1), any('2'), any('3')]),
      ref({ key: 'item' }, { type: 'variable' })
    ]).render(context);

    expect(rendered).toBe('1 2 3, four');
  });

  it('resolves list values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('item'),
        value: any('four')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const resolved = await list([
      spaced([num(1), any('2'), any('3')]),
      ref({ key: 'item' }, { type: 'variable' })
    ]).resolve(context);

    expect(`${resolved}`).toBe('1 2 3, four');
    expect(context.printState.writer).toBeUndefined();
  });

  it('should serialize to a list', () => {
    let rule = list([spaced([num(1), any('2'), any('3')]), any('four')]);
    expect(`${rule}`).toBe('1 2 3, four');
  });
  // it('should serialize to a module', () => {
  //   let rule = list([spaced([any('1'), any('2'), any('3')]), any('four')])
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.list([\n  $J.spaced([$J.any("1"), $J.any("2"), $J.any("3")]),\n  "four"\n])'
  //   )
  // })
});
