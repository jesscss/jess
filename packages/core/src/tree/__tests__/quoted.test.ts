import { describe, expect, it } from 'vitest';
import { any, expr, interpolated, quoted } from '../index.js';
import { Context } from '../../context.js';

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
});
