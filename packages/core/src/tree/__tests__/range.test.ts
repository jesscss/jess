import { describe, expect, it } from 'vitest';
import { any, range } from '../index.js';
import { Context } from '../../context.js';
import { patchField } from '../util/session-helpers.js';

describe('Range', () => {
  it('serializes inclusive and exclusive bounds', () => {
    const node = range(
      { start: any('1'), end: any('3'), step: any('2') },
      { includeStart: false, includeEnd: false }
    );

    expect(node.toTrimmedString()).toBe('1> to <3 step 2');
  });

  it('reads patched bounds from the active session without mutating the canonical node', () => {
    const context = new Context();
    context.createSession();
    const node = range(
      { start: any('1'), end: any('3'), step: any('2') },
      { includeEnd: false }
    );

    patchField(node, 'start', any('2'), context);
    patchField(node, 'end', any('4'), context);
    patchField(node, 'step', any('3'), context);

    expect(node.toTrimmedString({ context })).toBe('2 to <4 step 3');
    expect(node.toTrimmedString()).toBe('1 to <3 step 2');
    expect(node.start.toTrimmedString()).toBe('1');
    expect(node.end.toTrimmedString()).toBe('3');
    expect(node.step?.toTrimmedString()).toBe('2');
  });

  it('does not materialize session-patched bounds during eval', async () => {
    const context = new Context();
    context.createSession();
    const node = range(
      { start: any('1'), end: any('3') },
      { includeEnd: false }
    );

    patchField(node, 'start', any('9'), context);

    const evald = await node.eval(context);

    expect(evald.toTrimmedString()).toBe('1 to <3');
    expect(node.toTrimmedString({ context })).toBe('9 to <3');
    expect(node.toTrimmedString()).toBe('1 to <3');
    expect(node.start.toTrimmedString()).toBe('1');
  });
});
