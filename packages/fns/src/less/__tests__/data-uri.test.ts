import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeList, makeQuoted, type FnCtx, type Value } from '@jesscss/core';
import dataUri from '../data-uri.js';

const DATA_DIR = path.resolve(__dirname, 'assets');

const contextForDataDir = (): FnCtx => ({
  modes: { unitMode: 'preserve' },
  stringify: value => value.type === 'Quoted' ? value.value : value.bytes,
  io: {
    readFile: specifier => readFile(path.join(DATA_DIR, specifier)).catch(() => null)
  }
});

const callDataUri = async (...args: string[]): Promise<Value> => {
  const result = dataUri(
    makeList(args.map(value => makeQuoted(value, '\'', false)), ','),
    contextForDataDir()
  );
  return Promise.resolve(result);
};

describe('data-uri()', () => {
  it('inlines a text (svg) file as a URL-encoded utf8 data URI', async () => {
    const result = await callDataUri('image/svg+xml', 'sample.svg');
    expect(result.bytes).toBe('url("data:image/svg+xml,%3Csvg%2F%3E")');
  });

  it('base64-encodes when the mimetype requests base64', async () => {
    const result = await callDataUri('image/svg+xml;base64', 'sample.svg');
    const b64 = Buffer.from('<svg/>', 'utf8').toString('base64');
    expect(result.bytes).toBe(`url("data:image/svg+xml;base64,${b64}")`);
  });

  it('guesses mimetype and base64 from extension when omitted (single arg)', async () => {
    const result = await callDataUri('sample.svg');
    expect(result.bytes).toBe('url("data:image/svg+xml,%3Csvg%2F%3E")');
  });

  it('preserves a #fragment on the file path', async () => {
    const result = await callDataUri('image/svg+xml', 'sample.svg#frag');
    expect(result.bytes).toBe('url("data:image/svg+xml,%3Csvg%2F%3E#frag")');
  });

  it('falls back to a plain url() when the file cannot be found', async () => {
    const result = await callDataUri('image/png;base64', 'does-not-exist.png');
    expect(result.bytes).toBe('url("does-not-exist.png")');
  });

  it('surfaces rejected file reads instead of treating them as missing files', async () => {
    const result = dataUri(
      makeList([makeQuoted('asset.png', '\'', false)], ','),
      {
        modes: { unitMode: 'preserve' },
        stringify: value => value.type === 'Quoted' ? value.value : value.bytes,
        io: {
          readFile: () => Promise.reject(new Error('file loader timed out'))
        }
      }
    );

    await expect(Promise.resolve(result)).rejects.toThrow('file loader timed out');
  });
});
