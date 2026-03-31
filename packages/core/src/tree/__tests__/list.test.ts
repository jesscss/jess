import { TreeContext, list, spaced, num, any, ref, rules, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { addEdgeAt, addParentEdge, getEdgeAt, getParentEdge } from '../util/cursor.js';
import { EVAL, type RenderKey } from '../node.js';

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

  it('renders EVAL-path items without mutating the canonical list', () => {
    const node = list([any('red'), any('blue')]);
    const first = any('cyan');
    const second = any('magenta');

    addEdgeAt(node, 'value', 0, EVAL, first);
    addEdgeAt(node, 'value', 1, EVAL, second);
    addParentEdge(first, EVAL, node);
    addParentEdge(second, EVAL, node);

    expect(node.toTrimmedString(undefined, EVAL)).toBe('cyan, magenta');
    expect(node.toTrimmedString()).toBe('red, blue');
  });

  it('operate() uses EVAL-path left-hand items when cloning', () => {
    const left = list([any('red')]);
    const alternate = any('cyan');
    context.renderKey = EVAL;
    addEdgeAt(left, 'value', 0, EVAL, alternate);
    addParentEdge(alternate, EVAL, left);

    const result = left.operate(any('black'), '+', context);

    expect(result.toTrimmedString()).toBe('cyan, black');
    expect(left.toTrimmedString()).toBe('red');
  });

  it('operate() uses EVAL-path right-hand list items when appending', () => {
    const left = list([any('red')]);
    const right = list([any('blue')]);
    const alternate = any('cyan');
    context.renderKey = EVAL;

    addEdgeAt(right, 'value', 0, EVAL, alternate);
    addParentEdge(alternate, EVAL, right);

    const result = left.operate(right, '+', context);

    expect(result.toTrimmedString()).toBe('red, cyan');
    expect(left.toTrimmedString()).toBe('red');
    expect(right.toTrimmedString()).toBe('blue');
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
    context.renderKey = EVAL;

    const result = await node.eval(context);

    expect(result).toBe(node);
    expect(node.toTrimmedString(undefined, EVAL)).toBe('red');
    expect(node.toTrimmedString()).toBe('$foo');
    expect(node.get('value')[0]?.type).toBe('Reference');
    expect(getEdgeAt({ node, renderKey: EVAL }, 'value', 0)?.node.toTrimmedString()).toBe('red');
  });

  it('length and iteration remain canonical without a renderKey-aware channel', () => {
    const node = list([any('red'), any('blue')]);
    const first = any('cyan');
    const second = any('magenta');

    addEdgeAt(node, 'value', 0, EVAL, first);
    addEdgeAt(node, 'value', 1, EVAL, second);
    addParentEdge(first, EVAL, node);
    addParentEdge(second, EVAL, node);

    expect(node.toTrimmedString(undefined, EVAL)).toBe('cyan, magenta');
    expect(node.length).toBe(2);
    expect([...node].map(([, child]) => child.toTrimmedString())).toEqual(['red', 'blue']);
  });

  it('valueOf() remains canonical and cache-stable across different render paths', () => {
    const node = list([any('red'), any('blue')]);
    const left = any('cyan');
    const right = any('magenta');

    expect(node.valueOf()).toBe('red;blue');

    addEdgeAt(node, 'value', 0, EVAL, left);
    addEdgeAt(node, 'value', 1, EVAL, right);
    addParentEdge(left, EVAL, node);
    addParentEdge(right, EVAL, node);

    expect(node.toTrimmedString(undefined, EVAL)).toBe('cyan, magenta');
    expect(node.valueOf()).toBe('red;blue');
  });

  it('compare() remains canonical without a renderKey-aware channel', () => {
    const left = list([any('red'), any('blue')]);
    const right = list([any('red'), any('blue')]);

    addEdgeAt(left, 'value', 0, EVAL, any('cyan'));
    addEdgeAt(left, 'value', 1, EVAL, any('magenta'));

    expect(left.toTrimmedString(undefined, EVAL)).toBe('cyan, magenta');
    expect(left.compare(right)).toBe(0);
  });

  it('reads indexed children through the cursor model without mutating the canonical array', () => {
    const first = any('red');
    const second = any('blue');
    const alternate = any('cyan');
    const node = list([first, second]);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(getEdgeAt(cursor, 'value', 0)?.node).toBe(first);
    expect(getEdgeAt(cursor, 'value', 1)?.node).toBe(second);

    addEdgeAt(node, 'value', 1, key, alternate);

    expect(getEdgeAt(cursor, 'value', 0)?.node).toBe(first);
    expect(getEdgeAt(cursor, 'value', 1)?.node).toBe(alternate);
    expect(node.value).toEqual([first, second]);
  });

  it('walks back up from an EVAL-path replacement without disturbing canonical parentage', () => {
    const first = any('red');
    const second = any('blue');
    const alternate = any('cyan');
    const node = list([first, second]);

    addEdgeAt(node, 'value', 1, EVAL, alternate);
    addParentEdge(alternate, EVAL, node);

    expect(getParentEdge({ node: alternate, renderKey: EVAL })?.node).toBe(node);
    expect(second.parent).toBe(node);
  });
  // it('should serialize to a module', () => {
  //   let rule = list([spaced([any('1'), any('2'), any('3')]), any('four')])
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     '$J.list([\n  $J.spaced([$J.any("1"), $J.any("2"), $J.any("3")]),\n  "four"\n])'
  //   )
  // })
});
