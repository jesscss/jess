import { describe, expect, it } from 'vitest';
import { any, range } from '../index.js';
import { Context } from '../../context.js';

describe('Range', () => {
  it('serializes inclusive and exclusive bounds', () => {
    const node = range(
      { start: any('1'), end: any('3'), step: any('2') },
      { includeStart: false, includeEnd: false }
    );

    expect(node.toTrimmedString()).toBe('1> to <3 step 2');
  });

  it('reads cloned bounds without mutating the canonical node', () => {
    const context = new Context();
    const node = range(
      { start: any('1'), end: any('3'), step: any('2') },
      { includeEnd: false }
    );
    const clonedNode = node.clone();
    const start = any('2');
    const end = any('4');
    const step = any('3');

    clonedNode.adopt(start, context);
    clonedNode.adopt(end, context);
    clonedNode.adopt(step, context);
    (clonedNode as unknown as { start: ReturnType<typeof any> }).start = start;
    (clonedNode as unknown as { end: ReturnType<typeof any> }).end = end;
    (clonedNode as unknown as { step: ReturnType<typeof any> }).step = step;

    expect(clonedNode.toTrimmedString({ context })).toBe('2 to <4 step 3');
    expect(node.toTrimmedString()).toBe('1 to <3 step 2');
    expect(node.get('start').toTrimmedString()).toBe('1');
    expect(node.get('end').toTrimmedString()).toBe('3');
    expect(node.get('step')?.toTrimmedString()).toBe('2');
  });

  it('does not materialize cloned bounds during eval', async () => {
    const context = new Context();
    const node = range(
      { start: any('1'), end: any('3') },
      { includeEnd: false }
    );
    const clonedNode = node.clone();
    const start = any('9');

    clonedNode.adopt(start, context);
    (clonedNode as unknown as { start: ReturnType<typeof any> }).start = start;

    const evald = await clonedNode.eval(context);

    expect(evald.toTrimmedString()).toBe('9 to <3');
    expect(clonedNode.toTrimmedString({ context })).toBe('9 to <3');
    expect(node.toTrimmedString()).toBe('1 to <3');
    expect(node.get('start').toTrimmedString()).toBe('1');
  });
});
