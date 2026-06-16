import { describe, it, expect, beforeEach } from 'vitest';
import type { IToken } from 'chevrotain';
import { url, quoted, ref, rules, vardecl, any, Rules as RulesClass, Url } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  reads = 0;
  replacements = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }

  override replaceSince(mark: number, replacer: (text: string) => string, origin?: unknown): void {
    this.replacements++;
    return super.replaceSince(mark, replacer, origin);
  }
}

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  expect(evald).toBeInstanceOf(RulesClass);
  if (!(evald instanceof RulesClass)) {
    throw new Error('Expected Rules root');
  }
  context.root = evald;
  context.rulesContext = evald;
}

const token = (image: string): IToken => ({
  image,
  tokenType: { name: 'WS' } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

describe('url', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders url syntax through toTrimmedString()', () => {
    expect(url(quoted('image.png')).toTrimmedString()).toBe('url("image.png")');
  });

  it('writes raw url syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(url(any('image.png')).toTrimmedString({ writer })).toBe('url(image.png)');
    expect(writer.toString()).toBe('url(image.png)');
    expect(writer.reads).toBe(0);
    expect(writer.captures).toBe(0);
  });

  it('renders a resolved url value through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    const resolveUrl = urlNode.resolve.bind(urlNode);
    let urlResolveCalls = 0;
    urlNode.resolve = (renderContext: Context) => {
      urlResolveCalls++;
      return resolveUrl(renderContext);
    };
    const rendered = urlNode.render(context);

    expect(rendered).toBe('url("image.png")');
    expect(urlResolveCalls).toBe(0);
    expect(urlNode.evaluated).toBe(false);
    expect(urlNode.registrationPrepared).toBe(false);
  });

  it('writes resolved url render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const buffer = createRenderBuffer('flat');
    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    const resolveUrl = urlNode.resolve.bind(urlNode);
    let urlResolveCalls = 0;
    urlNode.resolve = (renderContext: Context) => {
      urlResolveCalls++;
      return resolveUrl(renderContext);
    };

    expect(await urlNode.render(context, buffer)).toBe('url("image.png")');
    expect(buffer.parts).toEqual(['url("image.png")']);
    expect(urlResolveCalls).toBe(0);
    expect(urlNode.evaluated).toBe(false);
    expect(urlNode.registrationPrepared).toBe(false);
  });

  it('writes resolved url buffers without cold string helper transport', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    await setEvaluatedRoot(context, node);
    const buffer = createRenderBuffer('flat');
    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    Reflect.set(urlNode, 'renderUrlSyntax', () => {
      throw new Error('Buffer url render should write syntax directly');
    });

    expect(await urlNode.render(context, buffer)).toBe('url("image.png")');
    expect(buffer.parts).toEqual(['url("image.png")']);
  });

  it('renders resolved url values without materializing a replacement url', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    await setEvaluatedRoot(context, node);
    const descriptor = Object.getOwnPropertyDescriptor(Url.prototype, 'withValue');
    if (!descriptor) {
      throw new Error('Expected Url.withValue for render materialization proof');
    }

    Object.defineProperty(Url.prototype, 'withValue', {
      ...descriptor,
      value: () => {
        throw new Error('Url render should not materialize a replacement url');
      }
    });
    try {
      const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));

      expect(await urlNode.render(context)).toBe('url("image.png")');
    } finally {
      Object.defineProperty(Url.prototype, 'withValue', descriptor);
    }
  });

  it('does not render pure source whitespace inside url syntax', () => {
    const trivia = createTriviaMap({
      before: new Map([[4, [token(' ')]]]),
      after: new Map<number, IToken[]>()
    });
    const treeContext = new TreeContext({ trivia });
    const value = quoted('image.png', undefined, [4, 1, 5, 14, 1, 15], treeContext);
    const node = url(value, undefined, [0, 1, 1, 15, 1, 16], treeContext);

    expect(node.render(context)).toBe('url("image.png")');
  });

  it('writes context url values with trivia without public toString transport', () => {
    const trivia = createTriviaMap({
      before: new Map([[4, [token(' ')]]]),
      after: new Map<number, IToken[]>()
    });
    const treeContext = new TreeContext({ trivia });
    const value = quoted('image.png', undefined, [4, 1, 5, 14, 1, 15], treeContext);
    const node = url(value, undefined, [0, 1, 1, 15, 1, 16], treeContext);
    let toStringCalls = 0;
    value.toString = () => {
      toStringCalls++;
      return '';
    };

    expect(node.toTrimmedString({ context, trivia })).toBe('url("image.png")');
    expect(toStringCalls).toBe(0);
  });

  it('normalizes multiline url value indentation when rendering evaluated output', () => {
    const node = url(any('data:image/png;base64,\n    aaa\n    bbb'));

    expect(node.render(context)).toBe('url(data:image/png;base64,\n  aaa\n  bbb)');
  });

  it('streams rendered url values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = url(any('data:image/png;base64,\n    aaa\n    bbb'));

    expect(node.render(context, { writer })).toBe('url(data:image/png;base64,\n  aaa\n  bbb)');
    expect(writer.toString()).toBe('url(data:image/png;base64,\n  aaa\n  bbb)');
    expect(writer.reads).toBe(0);
    expect(writer.replacements).toBe(0);
    expect(writer.captures).toBe(0);
  });

  it('writes raw url render values to flat buffers without print-state setup', () => {
    const buffer = createRenderBuffer('flat');
    const node = url(any('image.png'));

    expect(node.render(context, buffer)).toBe('url(image.png)');
    expect(buffer.parts).toEqual(['url(image.png)']);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes quoted scalar url render values to flat buffers without print-state setup', () => {
    const buffer = createRenderBuffer('flat');
    const node = url(quoted('image.png'));

    expect(node.render(context, buffer)).toBe('url("image.png")');
    expect(buffer.parts).toEqual(['url("image.png")']);
    expect(context.printState.writer).toBeUndefined();
  });

  it('writes source url values without public toString transport when no render context is active', () => {
    const value = quoted('image.png');
    let toStringCalls = 0;
    value.toString = () => {
      toStringCalls++;
      return '';
    };
    const node = url(value);

    expect(node.toTrimmedString()).toBe('url("image.png")');
    expect(toStringCalls).toBe(0);
  });

  it('writes context url values without public toString transport when trivia is inactive', () => {
    const value = quoted('image.png');
    let toStringCalls = 0;
    value.toString = () => {
      toStringCalls++;
      return '';
    };
    const node = url(value);

    expect(node.toTrimmedString({ context })).toBe('url("image.png")');
    expect(toStringCalls).toBe(0);
  });

  it('keeps source url syntax when print options are passed to toTrimmedString()', () => {
    const node = url(quoted('image.png'));

    expect(node.toTrimmedString({ context })).toBe('url("image.png")');
  });

  it('resolves url values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    const resolved = await urlNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('url("image.png")');
    expect(urlNode.evaluated).toBe(false);
    expect(urlNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('returns static urls without resolving child values', async () => {
    const value = quoted('image.png');
    const urlNode = url(value);
    value.resolve = () => {
      throw new Error('static url child should not resolve');
    };

    const resolved = await urlNode.resolve(context);

    expect(resolved).toBe(urlNode);
    expect(resolved.toTrimmedString()).toBe('url("image.png")');
  });

  it('keeps source url values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    await setEvaluatedRoot(context, node);

    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    const resolved = await urlNode.resolve(context);

    expect(resolved.render(context)).toBe('url("image.png")');
    expect(urlNode.toTrimmedString()).toBe('url("$asset")');
  });
});
