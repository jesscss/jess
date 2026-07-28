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

describe('Less reference semantic contracts through the public AST route', () => {
  it('evaluates a namespaced mixin call followed by a property accessor', async () => {
    await expect(parseAndRender(`
      #library { .add-one(@value) { @return: @value + 1px; } }
      .entry { height: #library.add-one(1px)[@return]; }
    `)).resolves.toBe('.entry {\n  height: 2px;\n}\n');
  });

  it('keeps comma-separated arguments separate before an empty return accessor', async () => {
    await expect(parseAndRender(`
      .add(@left, @right) { @return: @left + @right; }
      .entry { width: .add(10px, 10px)[]; }
    `)).resolves.toBe('.entry {\n  width: 20px;\n}\n');
  });

  it('resolves a bracket accessor whose property name comes from a variable', async () => {
    await expect(parseAndRender(`
      .foods() { @dessert: ice cream; }
      @key: dessert;
      .entry { treat: .foods[@@key]; }
    `)).resolves.toBe('.entry {\n  treat: ice cream;\n}\n');
  });

  it('calls a mixin value reached through a namespace accessor alias', async () => {
    await expect(parseAndRender(`
      .mix2(@n) { value: @n; }
      #lookup2 { @var: .mix2(lookup); }
      .entry {
        @dr: #lookup2[@var];
        @dr();
      }
    `)).resolves.toBe('.entry {\n  value: lookup;\n}\n');
  });

  it('reports missing imports as structured import diagnostics at the import statement', async () => {
    const source = '@import "missing-file.less";\n.entry { color: red; }';
    const result = await new Compiler({ output: { collapseNesting: true } }).renderToResult(
      { source, filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'import/not-found',
      phase: 'import',
      message: 'Import not found',
      reason: expect.stringContaining('missing-file.less'),
      fix: 'Check the import path, extension, and configured include paths.',
      line: 1,
      column: 1,
      filePath: expect.stringContaining('entry.less')
    });
  });

  it.each([
    ['a missing mixin', '.entry { .missing(); }'],
    ['a missing mixin within a namespace path', '#namespace {} .entry { #namespace.missing(); }'],
    ['a mixin whose literal pattern rejects the call', '@saxofon: trumpete; .mixin(saxofon) {} .entry { .mixin(@saxofon); }'],
    ['a mixin whose named args cannot bind', '@saxofon: trumpete; .mixin(@a, @b) {} .entry { .mixin(@a: @saxofon); }']
  ])('reports %s regardless of functionMode', async (_label, source) => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' }
    });
    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    })).rejects.toMatchObject({ code: 'resolve/name-not-found' });
  });

  it('treats a matching-name mixin whose guards reject the call as a no-op', async () => {
    const compiler = new Compiler({ output: { collapseNesting: true } });
    await expect(compiler.renderString('.m(@color) when (@color = blue) {} .entry { .m(red); }', {
      filePath: 'entry.less', extension: '.less'
    })).resolves.toBe('');
  });

  it.each([
    ['earlier same-scope variable', '@bodyColor: red; @bodyColor: @bodyColor; .entry { color: @bodyColor; }'],
    ['later same-scope variable', '@bodyColor: @bodyColor; @bodyColor: red; .entry { color: @bodyColor; }']
  ])('allows a self-looking variable reference when %s can make progress', async (_label, source) => {
    const compiler = new Compiler({ output: { collapseNesting: true } });
    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    })).resolves.toBe('.entry {\n  color: red;\n}\n');
  });

  it.each([
    ['a missing namespaced property accessor', '#namespace { existing: value; } .entry { value: #namespace[$missing]; }'],
    ['a missing namespaced variable accessor', '#namespace { @existing: value; } .entry { value: #namespace[@missing]; }'],
    ['a missing property reference', '.entry { value: $missing; }']
  ])('reports %s even when functionMode:error', async (_label, source) => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' }
    });
    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    })).rejects.toMatchObject({ code: 'resolve/name-not-found' });
  });

  it.each([
    ['recursive variable', '@bodyColor: darken(@bodyColor, 30%); .entry { color: @bodyColor; }', '@bodyColor'],
    ['recursive property', '.entry { color: darken($color, 10%); }', '$color']
  ])('reports %s as a structured eval error', async (_label, source, symbol) => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' }
    });
    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    })).rejects.toMatchObject({
      code: 'eval/recursive-reference',
      phase: 'eval',
      reason: expect.stringContaining(symbol)
    });
  });
});
