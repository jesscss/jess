import { TreeContext, list, spaced, num, any, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';

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

  it('should serialize to a list', () => {
    let rule = list([spaced([num(1), any('2'), any('3')]), any('four')]);
    expect(`${rule}`).toBe('1 2 3, four');
  });

  it('renders state-patched items without mutating the canonical list', () => {
    const node = list([any('red'), any('blue')]);

    setField(node, 'value', [any('cyan'), any('magenta')], context);

    expect(node.toTrimmedString({ context })).toBe('cyan, magenta');
    expect(node.toTrimmedString()).toBe('red, blue');
  });

  it('operate() uses state-patched left-hand items when cloning', () => {
    const left = list([any('red')]);

    setField(left, 'value', [any('cyan'), any('magenta')], context);

    const result = left.operate(any('black'), '+', context);

    expect(result.toTrimmedString({ context })).toBe('cyan, magenta, black');
    expect(left.toTrimmedString()).toBe('red');
  });

  it('operate() uses state-patched right-hand list items when appending', () => {
    const left = list([any('red')]);
    const right = list([any('blue')]);

    setField(right, 'value', [any('cyan'), any('magenta')], context);

    const result = left.operate(right, '+', context);

    expect(result.toTrimmedString({ context })).toBe('red, cyan, magenta');
    expect(left.toTrimmedString()).toBe('red');
    expect(right.toTrimmedString()).toBe('blue');
  });

  it('operate() does not overwrite the canonical left-hand list', () => {
    const left = list([any('red')]);
    const right = list([any('blue'), any('black')]);

    const result = left.operate(right, '+', context);

    expect(result).toBe(left);
    expect(left.toTrimmedString({ context })).toBe('red, blue, black');
    expect(left.toTrimmedString()).toBe('red');
    expect(left.value.map(child => child.toTrimmedString())).toEqual(['red']);
  });

  it('eval() does not overwrite the canonical list array', async () => {
    const node = list([ref({ key: 'foo' }, { type: 'variable' })]);
    const scope = rules([
      vardecl({
        name: any('foo'),
        value: any('red')
      })
    ]);
    context.root = scope;
    context.rulesContext = scope;

    const result = await node.eval(context);

    expect(result).toBe(node);
    expect(node.toTrimmedString({ context })).toBe('red');
    expect(node.toTrimmedString()).toBe('$foo');
    expect(node.value[0]?.type).toBe('Reference');
  });

  it('length and iteration remain canonical without a Context channel', () => {
    const node = list([any('red'), any('blue')]);

    setField(node, 'value', [any('cyan'), any('magenta'), any('black')], context);

    expect(node.toTrimmedString({ context })).toBe('cyan, magenta, black');
    expect(node.length).toBe(2);
    expect([...node].map(([, child]) => child.toTrimmedString())).toEqual(['red', 'blue']);
  });

  it('valueOf() remains canonical and cache-stable across different eval states', () => {
    const node = list([any('red'), any('blue')]);
    const ctx1 = new Context();
    const ctx2 = new Context();

    expect(node.valueOf()).toBe('red;blue');

    setField(node, 'value', [any('cyan'), any('magenta')], ctx1);
    setField(node, 'value', [any('black'), any('white')], ctx2);

    expect(node.toTrimmedString({ context: ctx1 })).toBe('cyan, magenta');
    expect(node.toTrimmedString({ context: ctx2 })).toBe('black, white');
    expect(node.valueOf()).toBe('red;blue');
  });

  it('compare() remains canonical without a Context channel', () => {
    const left = list([any('red'), any('blue')]);
    const right = list([any('red'), any('blue')]);

    setField(left, 'value', [any('cyan'), any('magenta')], context);

    expect(left.toTrimmedString({ context })).toBe('cyan, magenta');
    expect(left.compare(right)).toBe(0);
  });
  // it('should serialize to a module', () => {
  //   let rule = list([spaced([any('1'), any('2'), any('3')]), any('four')])
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.list([\n  $J.spaced([$J.any("1"), $J.any("2"), $J.any("3")]),\n  "four"\n])'
  //   )
  // })
});
