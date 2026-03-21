import { nil, num, seq } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import { sessionPatchField } from '../util/session-helpers.js';

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

  it('renders a session-patched value without mutating the canonical array', () => {
    const context = new Context();
    context.session = new EvalSession();
    const rule = seq([num(10), num(20)]);

    sessionPatchField(rule, 'value', [num(30), num(40)], context);

    expect(rule.toTrimmedString({ context })).toBe('30 40');
    expect(rule.toTrimmedString()).toBe('10 20');
    expect(rule.value.map(node => node.toTrimmedString())).toEqual(['10', '20']);
  });

  it('preserves a session-patched value across the pre-eval clone boundary', async () => {
    const context = new Context();
    context.createSession();
    const rule = seq([num(10), num(20)]);

    sessionPatchField(rule, 'value', [num(30), num(40)], context);

    const evald = await rule.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('30 40');
    expect(rule.toTrimmedString()).toBe('10 20');
    expect(rule.value.map(node => node.toTrimmedString())).toEqual(['10', '20']);
  });

  it('keeps eval-time value writes session-local in patch-only sessions', async () => {
    const context = new Context();
    context.session = new EvalSession();
    const rule = seq([num(10), nil(), num(20)]);

    const evald = await rule.eval(context);

    expect(evald.toTrimmedString({ context })).toBe('10 20');
    expect(rule.value).toHaveLength(3);
    expect(rule.value[1]?.type).toBe('Nil');
    expect(rule.value.map(node => node.type)).toEqual(['Num', 'Nil', 'Num']);
  });

  it('compares against session-patched values when called with context', () => {
    const context = new Context();
    context.session = new EvalSession();
    const left = seq([num(10), num(20)]);
    const right = seq([num(30), num(40)]);

    sessionPatchField(left, 'value', [num(30), num(40)], context);

    expect(left.compare(right, context)).toBe(0);
  });

  it('keeps contextless compare canonical when session patches exist', () => {
    const context = new Context();
    context.session = new EvalSession();
    const left = seq([num(10), num(20)]);
    const right = seq([num(30), num(40)]);

    sessionPatchField(left, 'value', [num(30), num(40)], context);

    expect(left.compare(right)).toBe(-1);
    expect(left.compare(right, context)).toBe(0);
  });

  it('keeps length canonical when session patches exist', () => {
    const context = new Context();
    context.session = new EvalSession();
    const node = seq([num(10), num(20)]);

    sessionPatchField(node, 'value', [num(30)], context);

    expect(node.length).toBe(2);
    expect(node.toTrimmedString({ context })).toBe('30');
  });

  it('keeps length canonical across competing session overlays on the same node', () => {
    const node = seq([num(10), num(20)]);
    const leftContext = new Context();
    const rightContext = new Context();
    leftContext.session = new EvalSession();
    rightContext.session = new EvalSession();

    sessionPatchField(node, 'value', [num(30)], leftContext);
    sessionPatchField(node, 'value', [num(40), num(50), num(60)], rightContext);

    expect(node.length).toBe(2);
    expect(node.toTrimmedString({ context: leftContext })).toBe('30');
    expect(node.toTrimmedString({ context: rightContext })).toBe('40 50 60');
  });

  it('keeps inherited contextless valueOf canonical when session patches exist', () => {
    const context = new Context();
    context.session = new EvalSession();
    const node = seq([num(10), num(20)]);

    sessionPatchField(node, 'value', [num(30)], context);

    expect(node.valueOf()).toBe('1020');
    expect(node.toTrimmedString({ context })).toBe('30');
  });
});
