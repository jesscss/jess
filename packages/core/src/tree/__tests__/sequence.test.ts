import { any, nil, num, ref, rules, seq, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { addEdgeAt, addParentEdge, getEdgeAt, getParentEdge } from '../util/cursor.js';
import { CANONICAL, EVAL, type RenderKey } from '../node.js';

/**
 * @todo - sequences need to make sure that the result could be re-parsed
 *         as distinct tokens. We should get rid of `spaced` and properly
 *         check that the result is spaced correctly.
 */
describe('Sequence', () => {
  it('should serialize to a single value', () => {
    let rule = seq([num(10), num(20), num(30)]);
    expect(`${rule}`).toBe('10 20 30');
  });

  it('should respect explicit zero-space boundary markers', () => {
    const first = num(10);
    const second = num(20);
    const third = num(30);
    second.pre = 0;
    const rule = seq([first, second, third]);
    expect(`${rule}`).toBe('1020 30');
  });

  it('renders an EVAL-path value without mutating the canonical array', () => {
    const rule = seq([num(10), num(20)]);
    const first = num(30);
    const second = num(40);

    addEdgeAt(rule, 'value', 0, EVAL, first);
    addEdgeAt(rule, 'value', 1, EVAL, second);
    addParentEdge(first, EVAL, rule);
    addParentEdge(second, EVAL, rule);

    expect(rule.toTrimmedString({ context: { renderKey: EVAL } as Context })).toBe('30 40');
    expect(rule.toTrimmedString()).toBe('10 20');
    expect(rule.get('value').map(node => node.toTrimmedString())).toEqual(['10', '20']);
  });

  it('keeps the canonical sequence while eval writes resolved children to the EVAL path', async () => {
    const context = new Context();
    const rule = seq([ref({ key: 'foo' }, { type: 'variable' }), num(20)]);
    const scope = rules([
      vardecl({
        name: any('foo'),
        value: any('red')
      })
    ]);
    context.root = scope;
    context.rulesContext = scope;
    context.renderKey = EVAL;

    const evald = await rule.eval(context);

    expect(evald).toBe(rule);
    expect(rule.toTrimmedString({ context })).toBe('red 20');
    expect(rule.toTrimmedString()).toBe('$foo 20');
    expect(rule.get('value')[0]?.type).toBe('Reference');
    expect(getEdgeAt({ node: rule, renderKey: EVAL }, 'value', 0)?.node.toTrimmedString()).toBe('red');
  });

  it('clones only when the sequence shape changes during eval', async () => {
    const context = new Context();
    const rule = seq([ref({ key: 'foo' }, { type: 'variable' }), num(20)]);
    const scope = rules([
      vardecl({
        name: any('foo'),
        value: nil()
      })
    ]);
    context.root = scope;
    context.rulesContext = scope;

    const evald = await rule.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('20');
    expect(evald).not.toBe(rule);
    expect(rule.get('value')).toHaveLength(2);
    expect(rule.get('value')[0]?.type).toBe('Reference');
    expect(rule.get('value').map(node => node.type)).toEqual(['Reference', 'Num']);
  });

  it('compares against EVAL-path values when called with context', () => {
    const context = new Context();
    const left = seq([num(10), num(20)]);
    const right = seq([num(30), num(40)]);
    const first = num(30);
    const second = num(40);
    context.renderKey = EVAL;

    addEdgeAt(left, 'value', 0, EVAL, first);
    addEdgeAt(left, 'value', 1, EVAL, second);
    addParentEdge(first, EVAL, left);
    addParentEdge(second, EVAL, left);

    expect(left.compare(right, context)).toBe(0);
  });

  it('keeps contextless compare canonical when EVAL edges exist', () => {
    const left = seq([num(10), num(20)]);
    const right = seq([num(30), num(40)]);
    const first = num(30);
    const second = num(40);

    addEdgeAt(left, 'value', 0, EVAL, first);
    addEdgeAt(left, 'value', 1, EVAL, second);

    expect(left.compare(right)).toBe(-1);
    expect(left.compare(right, { renderKey: EVAL } as Context)).toBe(0);
  });

  it('passes render-key-selected values through nested sequence comparisons', () => {
    const context = new Context();
    const innerLeft = seq([num(10), num(20)]);
    const innerRight = seq([num(30), num(40)]);
    const left = seq([innerLeft]);
    const right = seq([innerRight]);
    const first = num(30);
    const second = num(40);
    context.renderKey = EVAL;

    addEdgeAt(innerLeft, 'value', 0, EVAL, first);
    addEdgeAt(innerLeft, 'value', 1, EVAL, second);
    addParentEdge(first, EVAL, innerLeft);
    addParentEdge(second, EVAL, innerLeft);

    expect(left.compare(right)).toBe(-1);
    expect(left.compare(right, context)).toBe(0);
  });

  it('keeps length canonical when EVAL edges exist', () => {
    const node = seq([num(10), num(20)]);
    const alternate = num(30);

    addEdgeAt(node, 'value', 0, EVAL, alternate);
    addParentEdge(alternate, EVAL, node);

    expect(node.length).toBe(2);
    expect(node.toTrimmedString({ context: { renderKey: EVAL } as Context })).toBe('30 20');
  });

  it('keeps length canonical across competing render paths on the same node', () => {
    const node = seq([num(10), num(20)]);
    const leftKey = {} as RenderKey;
    const rightKey = {} as RenderKey;
    addEdgeAt(node, 'value', 0, leftKey, num(30));
    addEdgeAt(node, 'value', 0, rightKey, num(40));
    addEdgeAt(node, 'value', 1, rightKey, num(50));

    expect(node.length).toBe(2);
    expect(node.toTrimmedString({ context: { renderKey: leftKey } as Context })).toBe('30 20');
    expect(node.toTrimmedString({ context: { renderKey: rightKey } as Context })).toBe('40 50');
  });

  it('keeps inherited contextless valueOf canonical when EVAL edges exist', () => {
    const node = seq([num(10), num(20)]);
    const alternate = num(30);

    addEdgeAt(node, 'value', 0, EVAL, alternate);
    addParentEdge(alternate, EVAL, node);

    expect(node.valueOf()).toBe('1020');
    expect(node.toTrimmedString({ context: { renderKey: EVAL } as Context })).toBe('30 20');
  });

  it('reads indexed children through the cursor model without mutating the canonical array', () => {
    const first = num(10);
    const second = num(20);
    const alternate = num(30);
    const node = seq([first, second]);
    const key = {} as RenderKey;
    const cursor = { node, renderKey: key };

    expect(getEdgeAt(cursor, 'value', 0)?.node).toBe(first);
    expect(getEdgeAt(cursor, 'value', 1)?.node).toBe(second);

    addEdgeAt(node, 'value', 1, key, alternate);

    expect(getEdgeAt(cursor, 'value', 0)?.node).toBe(first);
    expect(getEdgeAt(cursor, 'value', 1)?.node).toBe(alternate);
    expect(node.value).toEqual([first, second]);
  });

  it('keeps canonical and eval paths independent when one indexed child is replaced', () => {
    const first = num(10);
    const second = num(20);
    const third = num(30);
    const replacement = num(200);
    const node = seq([first, second, third]);

    addEdgeAt(node, 'value', 1, EVAL, replacement);
    addParentEdge(replacement, EVAL, node);

    const evalCursor = { node, renderKey: EVAL };
    const canonicalCursor = { node, renderKey: CANONICAL };

    expect(node.value).toEqual([first, second, third]);

    expect(getEdgeAt(evalCursor, 'value', 0)?.node).toBe(first);
    expect(getEdgeAt(evalCursor, 'value', 1)?.node).toBe(replacement);
    expect(getEdgeAt(evalCursor, 'value', 2)?.node).toBe(third);

    expect(getEdgeAt(canonicalCursor, 'value', 0)?.node).toBe(first);
    expect(getEdgeAt(canonicalCursor, 'value', 1)?.node).toBe(second);
    expect(getEdgeAt(canonicalCursor, 'value', 2)?.node).toBe(third);

    expect(getParentEdge({ node: replacement, renderKey: EVAL })?.node).toBe(node);
    expect(getParentEdge({ node: second, renderKey: CANONICAL })?.node).toBe(node);
    expect(second.parent).toBe(node);
  });

  it('throws if a second canonical child or parent edge is added', () => {
    const first = num(10);
    const second = num(20);
    const replacement = num(200);
    const node = seq([first, second]);

    expect(() => addEdgeAt(node, 'value', 1, CANONICAL, replacement)).toThrow(
      'Cannot add a second CANONICAL edge for Sequence.value[1]'
    );
    expect(() => addParentEdge(replacement, CANONICAL, node)).toThrow(
      'Cannot add a second CANONICAL parent edge for Num'
    );
  });
});
