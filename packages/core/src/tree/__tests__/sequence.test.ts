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
});
