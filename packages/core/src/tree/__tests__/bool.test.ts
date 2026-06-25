import { describe, it, expect, beforeEach } from 'vitest';
import { Bool, bool } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { cast } from '../util/cast.js';
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

describe('Bool', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('preserves parser tree context on construction', () => {
    const treeContext = new TreeContext();
    const node = new Bool(true, undefined, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
  });

  it('renders bool syntax through toTrimmedString()', () => {
    expect(bool(true).toTrimmedString()).toBe('true');
    expect(bool(false).toTrimmedString()).toBe('false');
  });

  it('returns scalar bool syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(bool(true).toTrimmedString({ writer })).toBe('true');
    expect(writer.toString()).toBe('true');
    expect(writer.reads).toBe(0);
  });

  it('renders bool values through render(context)', () => {
    const truthy = bool(true);
    const falsy = bool(false);

    expect(truthy.render(context)).toBe('true');
    expect(falsy.render(context)).toBe('false');
    expect(truthy.evaluated).toBe(false);
    expect(truthy.registrationPrepared).toBe(false);
    expect(falsy.evaluated).toBe(false);
    expect(falsy.registrationPrepared).toBe(false);
  });

  it('writes bool render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const node = bool(true);
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('true');
    expect(buffer.parts).toEqual(['true']);
    expect(resolveCalls).toBe(0);
  });

  it('renders bool values without writer mark/readback', () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');

    expect(bool(true).render(context, { writer })).toBe('true');
    expect(writer.toString()).toBe('true');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(bool(false).render(context, buffer, { writer })).toBe('false');
    expect(buffer.parts).toEqual(['false']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('resolves bool values without touching render state', async () => {
    const node = bool(true);

    const resolved = await node.resolve(context);

    expect(resolved).toBeInstanceOf((bool(true)).constructor);
    expect(resolved.value).toBe(true);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('casts boolean primitives to Bool nodes', () => {
    const first = cast(true);
    const second = cast(true);

    expect(first).toBeInstanceOf(Bool);
    expect(second).toBeInstanceOf(Bool);
    if (!(first instanceof Bool) || !(second instanceof Bool)) {
      throw new Error('Expected Bool cast results');
    }
    expect(first.value).toBe(true);
    expect(second.value).toBe(true);
  });
});
