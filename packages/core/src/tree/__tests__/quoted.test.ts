import { describe, expect, it } from 'vitest';
import { any, expr, interpolated, quoted } from '../index.js';
import { Context } from '../../context.js';
import { sessionPatchField } from '../util/session-helpers.js';

describe('Quoted', () => {
  it('serializes a quoted string', () => {
    const node = quoted('red');

    expect(node.toTrimmedString()).toBe('"red"');
  });

  it('evaluates to a materialized quoted node without mutating the canonical node in a session', async () => {
    const context = new Context();
    context.createSession();
    const node = quoted(interpolated({
      source: '%%',
      replacements: [expr(any('blue'))]
    }));

    const evald = await node.eval(context);

    expect(evald.toTrimmedString()).toBe('"blue"');
    expect(node.toTrimmedString()).toBe('"$(blue)"');
    expect(node.value).toBeTypeOf('object');
    expect(node.value).not.toBe('blue');
  });

  it('keeps valueOf() canonical across different session overlays', () => {
    const node = quoted('red');
    const firstSession = new Context();
    const secondSession = new Context();

    firstSession.createSession();
    secondSession.createSession();

    sessionPatchField(node, 'value', 'cyan', firstSession);
    sessionPatchField(node, 'value', 'magenta', secondSession);

    expect(node.toTrimmedString({ context: firstSession })).toBe('"cyan"');
    expect(node.toTrimmedString({ context: secondSession })).toBe('"magenta"');
    expect(node.valueOf()).toBe('red');
  });

  it('keeps compare() canonical across different session overlays', () => {
    const left = quoted('red');
    const right = quoted('red');
    const firstSession = new Context();
    const secondSession = new Context();

    firstSession.createSession();
    secondSession.createSession();

    sessionPatchField(left, 'value', 'cyan', firstSession);
    sessionPatchField(left, 'value', 'magenta', secondSession);

    expect(left.toTrimmedString({ context: firstSession })).toBe('"cyan"');
    expect(left.toTrimmedString({ context: secondSession })).toBe('"magenta"');
    expect(left.compare(right)).toBe(0);
  });
});
