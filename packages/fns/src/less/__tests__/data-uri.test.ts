import { describe, it, expect } from 'vitest';
import { Context, Quoted, TreeContext, Url, callWithContext } from '@jesscss/core';
import path from 'node:path';
import dataUri from '../data-uri.js';

const DATA_DIR = path.resolve(__dirname, 'assets');

function renderUrl(result: unknown, context: Context): string {
  if (!(result instanceof Url)) {
    throw new TypeError('Expected data-uri() to return a URL.');
  }
  return result.render(context);
}

function contextForDir(dir: string): Context {
  const context = new Context();
  context.treeContext = new TreeContext({
    file: { name: 'entry.less', path: dir, fullPath: path.join(dir, 'entry.less'), source: '' }
  });
  return context;
}

describe('data-uri()', () => {
  it('inlines a text (svg) file as a URL-encoded utf8 data URI', async () => {
    const context = contextForDir(DATA_DIR);
    const result = await callWithContext(
      context,
      dataUri,
      new Quoted('image/svg+xml', { quote: '\'' }),
      new Quoted('sample.svg', { quote: '\'' })
    );
    expect(result).toBeInstanceOf(Url);
    const rendered = renderUrl(result, context);
    expect(rendered).toBe('url("data:image/svg+xml,%3Csvg%2F%3E")');
  });

  it('base64-encodes when the mimetype requests base64', async () => {
    const context = contextForDir(DATA_DIR);
    const result = await callWithContext(
      context,
      dataUri,
      new Quoted('image/svg+xml;base64', { quote: '\'' }),
      new Quoted('sample.svg', { quote: '\'' })
    );
    const rendered = renderUrl(result, context);
    const b64 = Buffer.from('<svg/>', 'utf8').toString('base64');
    expect(rendered).toBe(`url("data:image/svg+xml;base64,${b64}")`);
  });

  it('guesses mimetype and base64 from extension when omitted (single arg)', async () => {
    const context = contextForDir(DATA_DIR);
    const result = await callWithContext(
      context,
      dataUri,
      new Quoted('sample.svg', { quote: '\'' })
    );
    // svg is text → url-encoded, not base64
    const rendered = renderUrl(result, context);
    expect(rendered).toBe('url("data:image/svg+xml,%3Csvg%2F%3E")');
  });

  it('preserves a #fragment on the file path', async () => {
    const context = contextForDir(DATA_DIR);
    const result = await callWithContext(
      context,
      dataUri,
      new Quoted('image/svg+xml', { quote: '\'' }),
      new Quoted('sample.svg#frag', { quote: '\'' })
    );
    const rendered = renderUrl(result, context);
    expect(rendered).toBe('url("data:image/svg+xml,%3Csvg%2F%3E#frag")');
  });

  it('falls back to a plain url() when the file cannot be found', async () => {
    const context = contextForDir(DATA_DIR);
    const result = await callWithContext(
      context,
      dataUri,
      new Quoted('image/png;base64', { quote: '\'' }),
      new Quoted('does-not-exist.png', { quote: '\'' })
    );
    expect(result).toBeInstanceOf(Url);
    const rendered = renderUrl(result, context);
    expect(rendered).toBe('url("does-not-exist.png")');
  });
});
