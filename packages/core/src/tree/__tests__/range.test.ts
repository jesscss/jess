import { describe, expect, it } from 'vitest';
import { Context, TreeContext } from '../../context.js';
import { any, num, range } from '../index.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

describe('Range', () => {
  it('preserves parser tree context on construction', () => {
    const treeContext = new TreeContext();
    const node = range({
      start: num(1),
      end: num(3)
    }, undefined, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
  });

  it('renders range syntax through toTrimmedString()', () => {
    expect(range({
      start: num(1),
      end: num(3),
      step: num(2)
    }, {
      includeEnd: false
    }).toTrimmedString()).toBe('1 to <3 step 2');
  });

  it('does not allocate options when rendering an inclusive range', () => {
    const node = range({
      start: num(1),
      end: num(3)
    });

    expect(node.toTrimmedString()).toBe('1 to 3');
    expect(Object.getOwnPropertyDescriptor(node, '_options')?.value).toBeUndefined();
  });

  it('serializes inclusive/exclusive range boundaries canonically', () => {
    expect(`${range({
      start: num(1),
      end: num(3)
    }, {
      includeStart: false,
      includeEnd: false
    })}`).toBe('1> to <3');
  });

  it('streams range bounds without capture scaffolding', () => {
    const writer = new CountingWriter();

    expect(range({
      start: num(1),
      end: num(3),
      step: num(2)
    }).toTrimmedString({ writer })).toBe('1 to 3 step 2');
    expect(writer.captures).toBe(0);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('writes range bounds without public toString transport', () => {
    const start = any('1');
    const end = any('3');
    const step = any('2');
    let stringCalls = 0;
    start.toString = end.toString = step.toString = () => {
      stringCalls++;
      return '';
    };

    expect(range({ start, end, step }).toTrimmedString()).toBe('1 to 3 step 2');
    expect(stringCalls).toBe(0);
  });

  it('renders range values through render(context) without public resolve', () => {
    const context = new Context();
    const writer = new CountingWriter();
    const node = range({
      start: num(1),
      end: num(3),
      step: num(2)
    });
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(node.render(context, { writer })).toBe('1 to 3 step 2');
    expect(writer.toString()).toBe('1 to 3 step 2');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('resolves ranges without touching render state', async () => {
    const context = new Context();
    const node = range({
      start: num(1),
      end: num(3),
      step: num(2)
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('1 to 3 step 2');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes range render output into flat buffers', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = range({
      start: num(1),
      end: num(3),
      step: num(2)
    });
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('1 to 3 step 2');
    expect(buffer.parts).toEqual(['1 to 3 step 2']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });
});
