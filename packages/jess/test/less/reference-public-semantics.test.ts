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

  it.each([
    ['a missing mixin', '.entry { .missing(); }'],
    ['a missing mixin within a namespace path', '#namespace {} .entry { #namespace.missing(); }']
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
    ['a missing namespaced property accessor', '#namespace { existing: value; } .entry { value: #namespace[$missing]; }', '#namespace {\n  existing: value;\n}\n.entry {\n  value: #namespace[$missing];\n}\n'],
    ['a missing namespaced variable accessor', '#namespace { @existing: value; } .entry { value: #namespace[@missing]; }', '.entry {\n  value: #namespace[@missing];\n}\n'],
    ['a missing property reference', '.entry { value: $missing; }', '.entry {\n  value: $missing;\n}\n']
  ])('preserves %s even when functionMode:error', async (_label, source, expected) => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' }
    });
    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    })).resolves.toBe(expected);
  });
});
