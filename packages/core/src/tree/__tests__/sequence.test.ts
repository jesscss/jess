import { any, nil, num, ref, rules, seq, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { setField } from '../util/field-helpers.js';
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

  it('renders a state-patched value without mutating the canonical array', () => {
    const context = new Context();
    const rule = seq([num(10), num(20)]);

    setField(rule, 'value', [num(30), num(40)], context);

    expect(rule.toTrimmedString({ context })).toBe('30 40');
    expect(rule.toTrimmedString()).toBe('10 20');
    expect(rule.get('value').map(node => node.toTrimmedString())).toEqual(['10', '20']);
  });

  it('preserves a state-patched value across the pre-eval clone boundary', async () => {
    const context = new Context();
    const rule = seq([num(10), num(20)]);

    setField(rule, 'value', [num(30), num(40)], context);

    const evald = await rule.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('30 40');
    expect(rule.toTrimmedString()).toBe('10 20');
    expect(rule.get('value').map(node => node.toTrimmedString())).toEqual(['10', '20']);
  });

  it('keeps eval-time value writes state-local in patching', async () => {
    const context = new Context();
    const rule = seq([num(10), nil(), num(20)]);

    const evald = await rule.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('10 20');
    expect(rule.get('value')).toHaveLength(3);
    expect(rule.get('value')[1]?.type).toBe('Nil');
    expect(rule.get('value').map(node => node.type)).toEqual(['Num', 'Nil', 'Num']);
  });

  it('eval respects a state-patched preserveWhitespace option without mutating canonical collapse behavior', async () => {
    const context = new Context();
    const node = seq([ref({ key: 'value' }, { type: 'variable' })]);
    const root = rules([
      vardecl({ name: 'value', value: any('10') })
    ]);
    context.root = root;
    context.rulesContext = root;

    setField(node, 'options', { preserveWhitespace: true }, context);

    const evald = await node.eval(context);

    expect(evald).toBe(node);
    expect(evald.toTrimmedString({ context })).toBe('10');
    expect(node.options?.preserveWhitespace).toBeUndefined();
    const canonicalContext = new Context();
    canonicalContext.root = root;
    canonicalContext.rulesContext = root;
    const canonicalEvald = await node.eval(canonicalContext);
    expect(canonicalEvald.type).toBe('Any');
  });

  it('compares against state-patched values when called with context', () => {
    const context = new Context();
    const left = seq([num(10), num(20)]);
    const right = seq([num(30), num(40)]);

    setField(left, 'value', [num(30), num(40)], context);

    expect(left.compare(right, context)).toBe(0);
  });

  it('keeps contextless compare canonical when state patches exist', () => {
    const context = new Context();
    const left = seq([num(10), num(20)]);
    const right = seq([num(30), num(40)]);

    setField(left, 'value', [num(30), num(40)], context);

    expect(left.compare(right)).toBe(-1);
    expect(left.compare(right, context)).toBe(0);
  });

  it('passes context through nested sequence comparisons', () => {
    const context = new Context();
    const innerLeft = seq([num(10), num(20)]);
    const innerRight = seq([num(30), num(40)]);
    const left = seq([innerLeft]);
    const right = seq([innerRight]);

    setField(innerLeft, 'value', [num(30), num(40)], context);

    expect(left.compare(right)).toBe(-1);
    expect(left.compare(right, context)).toBe(0);
  });

  it('keeps length canonical when state patches exist', () => {
    const context = new Context();
    const node = seq([num(10), num(20)]);

    setField(node, 'value', [num(30)], context);

    expect(node.length).toBe(2);
    expect(node.toTrimmedString({ context })).toBe('30');
  });

  it('keeps length canonical across competing eval states on the same node', () => {
    const node = seq([num(10), num(20)]);
    const leftContext = new Context();
    const rightContext = new Context();
    setField(node, 'value', [num(30)], leftContext);
    setField(node, 'value', [num(40), num(50), num(60)], rightContext);

    expect(node.length).toBe(2);
    expect(node.toTrimmedString({ context: leftContext })).toBe('30');
    expect(node.toTrimmedString({ context: rightContext })).toBe('40 50 60');
  });

  it('keeps inherited contextless valueOf canonical when state patches exist', () => {
    const context = new Context();
    const node = seq([num(10), num(20)]);

    setField(node, 'value', [num(30)], context);

    expect(node.valueOf()).toBe('1020');
    expect(node.toTrimmedString({ context })).toBe('30');
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
