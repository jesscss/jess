/**
 * IO built-ins (`data-uri` / `image-size` / `image-width` / `image-height`) over
 * the injected {@link FnCtx.io} file-read capability. Each fn body is exercised
 * directly with a hermetic stub `io` (no dependency on the external corpus): a
 * path→bytes map stands in for the filesystem, and `stringify` mirrors the host
 * hook (a Quoted's inner text). Byte expectations are cross-checked against the
 * Less 4.x algorithm (base64 for binary, percent-encode for text, `url("…")`).
 */
import { describe, it, expect } from 'vitest';
import { emitValue, isValueGroupArray, makeQuoted, makeList } from '@jesscss/core/value';
import type { Fn, FnCtx, FnIo, List, ValueGroup } from '@jesscss/core/value';
import dataUri from '../../less/data-uri.js';
import { imageSize } from '../../less/image-size.js';
import { imageWidth } from '../../less/image-width.js';
import { imageHeight } from '../../less/image-height.js';

/** Invoke the universal typed callable with its variadic argument list. */
function call(fn: Fn, list: List, c: FnCtx): ValueGroup {
  // These unit stubs are deliberately synchronous; async capability coverage lives
  // at the Compiler/Context boundary below the function package.
  const result = fn(list, c);
  if (result instanceof Promise) {
    throw new Error('Expected synchronous IO function result in this unit test.');
  }
  return result;
}

/** A 24-byte PNG header advertising `width × height` (parsed from bytes 16/20). */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0); // PNG signature
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** A stub `FnIo` that resolves a fixed path→bytes map, else `null` (unreadable). */
function stubIo(files: Record<string, Uint8Array>): FnIo {
  return { readFile: spec => files[spec] ?? null };
}

function file(name: string, bytes: Uint8Array): Record<string, Uint8Array> {
  return { [name]: bytes };
}

/** The minimal `FnCtx` a value/IO fn body sees: the serialize hook + optional io. */
function ctx(io?: FnIo): FnCtx {
  return {
    modes: { unitMode: 'preserve' },
    stringify: v => (!isValueGroupArray(v) && v.type === 'Quoted' ? v.value : emitValue(v)),
    io
  };
}

/** A comma-arg `List` of single-quoted string literals (the fn call shape). */
function args(...values: string[]): List {
  return makeList(values.map(v => makeQuoted(v, '\'', false)), ',');
}

describe('data-uri', () => {
  it('inlines binary as base64 with a guessed mimetype', () => {
    const io = stubIo(file('a.png', Buffer.from('AB')));
    const out = call(dataUri, args('a.png'), ctx(io));
    expect(emitValue(out)).toBe(`url("data:image/png;base64,${Buffer.from('AB').toString('base64')}")`);
  });

  it('percent-encodes text with an explicit mimetype', () => {
    const io = stubIo(file('p.txt', Buffer.from('a b&c')));
    const out = call(dataUri, args('text/plain', 'p.txt'), ctx(io));
    expect(emitValue(out)).toBe('url("data:text/plain,a%20b%26c")');
  });

  it('honors an explicit ;base64 mimetype flag', () => {
    const io = stubIo(file('f.dat', Buffer.from('hi')));
    const out = call(dataUri, args('application/x-thing;base64', 'f.dat'), ctx(io));
    expect(emitValue(out)).toBe(`url("data:application/x-thing;base64,${Buffer.from('hi').toString('base64')}")`);
  });

  it('preserves a #fragment at the end of the emitted URI', () => {
    const io = stubIo(file('a.png', Buffer.from('AB')));
    const out = call(dataUri, args('image/png;base64', 'a.png#frag'), ctx(io));
    expect(emitValue(out)).toBe(`url("data:image/png;base64,${Buffer.from('AB').toString('base64')}#frag")`);
  });

  it('falls back to a plain url() when the file is unreadable', () => {
    const out = call(dataUri, args('missing.png'), ctx(stubIo({})));
    expect(emitValue(out)).toBe('url("missing.png")');
  });

  it('falls back to a plain url() when no IO capability is wired', () => {
    const out = call(dataUri, args('missing.png'), ctx(undefined));
    expect(emitValue(out)).toBe('url("missing.png")');
  });
});

describe('image-size / image-width / image-height', () => {
  const io = stubIo(file('img.png', pngHeader(640, 430)));

  it('keeps the public callable Fn metadata and raw typed List contract', () => {
    for (const fn of [imageSize, imageWidth, imageHeight]) {
      expect(typeof fn).toBe('function');
      expect(fn.variadic).toBe(true);
      expect(fn.params).toEqual([{ kinds: 'any' }]);
    }
  });

  it('image-size → space list of px dimensions', () => {
    const result = call(imageSize, args('img.png'), ctx(io));
    expect(isValueGroupArray(result)).toBe(true);
    expect(emitValue(result)).toBe('640px 430px');
  });

  it('image-width → px width', () => {
    expect(emitValue(call(imageWidth, args('img.png'), ctx(io)))).toBe('640px');
  });

  it('image-height → px height', () => {
    expect(emitValue(call(imageHeight, args('img.png'), ctx(io)))).toBe('430px');
  });

  it('throws when the image file is unreadable (evaluator emits the call verbatim)', () => {
    expect(() => call(imageSize, args('gone.png'), ctx(io))).toThrow();
  });
});
