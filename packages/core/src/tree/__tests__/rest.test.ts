import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, Rest, rest } from '../index.js';
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

describe('Rest', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders rest syntax through toTrimmedString()', () => {
    expect(rest('items').toTrimmedString()).toBe('...$$items');
    expect(rest(any('items')).toTrimmedString()).toBe('...$items');
  });

  it('stores the rest child on a constructor-owned direct field', () => {
    const value = any('items');
    const node = rest(value);

    expect(node.value).toBe(value);
    expect(Rest.childKeys).toEqual(['value']);
  });

  it('returns scalar rest syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(rest('items').toTrimmedString({ writer })).toBe('...$$items');
    expect(rest(undefined).toTrimmedString({ writer })).toBe('...$');
    expect(rest(any('items')).toTrimmedString({ writer })).toBe('...$items');
    expect(writer.toString()).toBe('...$$items...$...$items');
    expect(writer.reads).toBe(0);
  });

  it('reads Any rest names from the owned scalar value', () => {
    const value = any('items');
    let toStringCalls = 0;
    let valueOfCalls = 0;
    value.toString = () => {
      toStringCalls++;
      return '';
    };
    value.valueOf = () => {
      valueOfCalls++;
      return '';
    };

    expect(rest(value).name).toBe('items');
    expect(toStringCalls).toBe(0);
    expect(valueOfCalls).toBe(0);
  });

  it('renders rest values through render(context)', () => {
    const named = rest('items');
    const nodeNamed = rest(any('items'));

    expect(named.render(context)).toBe('...$$items');
    expect(nodeNamed.render(context)).toBe('...$items');
    expect(named.evaluated).toBe(false);
    expect(named.registrationPrepared).toBe(false);
    expect(nodeNamed.evaluated).toBe(false);
    expect(nodeNamed.registrationPrepared).toBe(false);
  });

  it('renders scalar rest values without writer readback', () => {
    const writer = new CountingWriter();

    expect(rest('items').render(context, { writer })).toBe('...$$items');
    expect(rest(any('items')).render(context, { writer })).toBe('...$items');
    expect(writer.toString()).toBe('...$$items...$items');
    expect(writer.reads).toBe(0);
  });

  it('writes rest render output into flat buffers', async () => {
    const buffer = createRenderBuffer('flat');
    const writer = new CountingWriter();
    context.printState.writer = writer;
    const node = rest('items');
    let resolveCalls = 0;
    node.resolve = () => {
      resolveCalls++;
      return node;
    };

    expect(await node.render(context, buffer)).toBe('...$$items');
    expect(buffer.parts).toEqual(['...$$items']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(resolveCalls).toBe(0);
  });

  it('resolves rest values without touching render state', async () => {
    const node = rest('items');

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBe('...$$items');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
