import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { co } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  marks = 0;
  reads = 0;

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

describe('Combinator', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders combinator syntax through toTrimmedString()', () => {
    expect(co('>').toTrimmedString()).toBe('>');
    expect(co('+').toTrimmedString()).toBe('+');
  });

  it('returns scalar combinator syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(co('>').toTrimmedString({ writer })).toBe('>');
    expect(writer.toString()).toBe('>');
    expect(writer.reads).toBe(0);
  });

  it('renders combinators through render(context)', () => {
    const child = co('>');
    const adjacent = co('+');

    expect(child.render(context)).toBe('>');
    expect(adjacent.render(context)).toBe('+');
    expect(child.registrationPrepared).toBe(false);
    expect(adjacent.registrationPrepared).toBe(false);
  });

  it('writes combinator render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = co('>');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('>');
    expect(buffer.parts).toEqual(['>']);
    expect(resolveCalls).toBe(0);
  });

  it('renders combinators without writer mark/readback', () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');

    expect(co('>').render(context, { writer })).toBe('>');
    expect(writer.toString()).toBe('>');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(co('+').render(context, buffer, { writer })).toBe('+');
    expect(buffer.parts).toEqual(['+']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('resolves combinators without touching render state', async () => {
    const node = co('>');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('>');
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
