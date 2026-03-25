import { TreeContext, list, spaced, num, any, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { patchField } from '../util/session-helpers.js';

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

  it('renders session-patched items without mutating the canonical list', () => {
    context.createSession();
    const node = list([any('red'), any('blue')]);

    patchField(node, 'value', [any('cyan'), any('magenta')], context);

    expect(node.toTrimmedString({ context })).toBe('cyan, magenta');
    expect(node.toTrimmedString()).toBe('red, blue');
  });

  it('operate() uses session-patched left-hand items when cloning in a session', () => {
    context.createSession();
    const left = list([any('red')]);

    patchField(left, 'value', [any('cyan'), any('magenta')], context);

    const result = left.operate(any('black'), '+', context);

    expect(result.toTrimmedString({ context })).toBe('cyan, magenta, black');
    expect(left.toTrimmedString()).toBe('red');
  });

  it('operate() uses session-patched right-hand list items when appending in a session', () => {
    context.createSession();
    const left = list([any('red')]);
    const right = list([any('blue')]);

    patchField(right, 'value', [any('cyan'), any('magenta')], context);

    const result = left.operate(right, '+', context);

    expect(result.toTrimmedString({ context })).toBe('red, cyan, magenta');
    expect(left.toTrimmedString()).toBe('red');
    expect(right.toTrimmedString()).toBe('blue');
  });

  it('operate() does not overwrite the canonical left-hand list on the non-reset session path', () => {
    context.session = new EvalSession();
    const left = list([any('red')]);
    const right = list([any('blue'), any('black')]);

    const result = left.operate(right, '+', context);

    expect(result).toBe(left);
    expect(left.toTrimmedString({ context })).toBe('red, blue, black');
    expect(left.toTrimmedString()).toBe('red');
    expect(left.value.map(child => child.toTrimmedString())).toEqual(['red']);
  });

  it('eval() does not overwrite the canonical list array on the non-reset session path', async () => {
    context.session = new EvalSession();
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
    context.createSession();
    const node = list([any('red'), any('blue')]);

    patchField(node, 'value', [any('cyan'), any('magenta'), any('black')], context);

    expect(node.toTrimmedString({ context })).toBe('cyan, magenta, black');
    expect(node.length).toBe(2);
    expect([...node].map(([, child]) => child.toTrimmedString())).toEqual(['red', 'blue']);
  });

  it('valueOf() remains canonical and cache-stable across different session overlays', () => {
    const node = list([any('red'), any('blue')]);
    const firstSession = new Context();
    const secondSession = new Context();

    firstSession.createSession();
    secondSession.createSession();

    expect(node.valueOf()).toBe('red;blue');

    patchField(node, 'value', [any('cyan'), any('magenta')], firstSession);
    patchField(node, 'value', [any('black'), any('white')], secondSession);

    expect(node.toTrimmedString({ context: firstSession })).toBe('cyan, magenta');
    expect(node.toTrimmedString({ context: secondSession })).toBe('black, white');
    expect(node.valueOf()).toBe('red;blue');
  });

  it('compare() remains canonical without a Context channel', () => {
    context.createSession();
    const left = list([any('red'), any('blue')]);
    const right = list([any('red'), any('blue')]);

    patchField(left, 'value', [any('cyan'), any('magenta')], context);

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
