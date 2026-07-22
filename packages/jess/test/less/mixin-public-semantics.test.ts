import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

async function parseAndRender(source: string): Promise<string> {
  const compiler = new Compiler({ output: { collapseNesting: true } });
  const context = compiler.createContext('entry.less');
  const parsed = await context.parseString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });

  expect(parsed.node.type).toBe('Stylesheet');
  expect(context.document).toBe(parsed.node);
  return compiler.renderString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });
}

describe('Less mixin semantic contracts through the public AST route', () => {
  it('expands recursive guarded mixins in source order', async () => {
    await expect(parseAndRender(`
      .countdown(@n) when (@n > 0) {
        .item-@{n} { order: @n; }
        .countdown(@n - 1);
      }
      .countdown(3);
    `)).resolves.toBe(
      '.item-3 {\n  order: 3;\n}\n.item-2 {\n  order: 2;\n}\n.item-1 {\n  order: 1;\n}\n'
    );
  });

  it('retains caller arguments through a detached-ruleset invocation', async () => {
    await expect(parseAndRender(`
      #hover(@content) { &:hover { @content(); } }
      #button(@color) {
        color: @color;
        #hover({ background-color: @color; });
      }
      .button { #button(red); }
    `)).resolves.toBe(
      '.button {\n  color: red;\n}\n.button:hover {\n  background-color: red;\n}\n'
    );
  });

  it('propagates a call-site !important marker to declarations emitted by a mixin', async () => {
    await expect(parseAndRender(`
      .paint() { color: red; background: blue; }
      .entry { .paint() !important; }
    `)).resolves.toBe(
      '.entry {\n  color: red !important;\n  background: blue !important;\n}\n'
    );
  });

  it('resolves a nested mixin body against its lexical scope', async () => {
    await expect(parseAndRender(`
      @tone: outer;
      .scope {
        @tone: inner;
        .paint() { color: @tone; }
        .entry { .paint(); }
      }
    `)).resolves.toBe('.scope .entry {\n  color: inner;\n}\n');
  });
});
