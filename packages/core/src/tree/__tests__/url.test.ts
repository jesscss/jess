import { describe, it, expect, beforeEach } from 'vitest';
import type { IToken } from 'chevrotain';
import { url, quoted, ref, rules, vardecl, any, Rules as RulesClass } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
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

  it('renders a resolved url value through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

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
    expect(urlNode.preEvaluated).toBe(false);
  });

  it('writes resolved url render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

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
    expect(urlNode.preEvaluated).toBe(false);
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

  it('normalizes multiline url value indentation when rendering evaluated output', () => {
    const node = url(any('data:image/png;base64,\n    aaa\n    bbb'));

    expect(node.render(context)).toBe('url(data:image/png;base64,\n  aaa\n  bbb)');
  });

  it('streams rendered url values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = url(any('data:image/png;base64,\n    aaa\n    bbb'));

    expect(node.render(context, { writer })).toBe('url(data:image/png;base64,\n  aaa\n  bbb)');
    expect(writer.toString()).toBe('url(data:image/png;base64,\n  aaa\n  bbb)');
    expect(writer.captures).toBe(0);
  });

  it('resolves url values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('asset'),
        value: any('image.png')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    const resolved = await urlNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('url("image.png")');
    expect(urlNode.evaluated).toBe(false);
    expect(urlNode.preEvaluated).toBe(false);
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
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const urlNode = url(quoted(ref({ key: 'asset' }, { type: 'variable' })));
    const resolved = await urlNode.resolve(context);

    expect(resolved.render(context)).toBe('url("image.png")');
    expect(urlNode.toTrimmedString()).toBe('url("$asset")');
  });
});
