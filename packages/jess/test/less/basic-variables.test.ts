import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Less variable references through the public AST route', () => {
  async function parseAndRender(source: string): Promise<string> {
    const compiler = new Compiler();
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

  it('should handle simple variable declaration and usage', async () => {
    const lessCode = `
      @myColor: red;
      
      .test {
        color: @myColor;
      }
    `;

    await expect(parseAndRender(lessCode)).resolves.toBe('.test {\n  color: red;\n}\n');
  });

  it('should handle multiple variables', async () => {
    const lessCode = `
      @myPrimary: blue;
      @mySecondary: green;
      
      .test {
        color: @myPrimary;
        background: @mySecondary;
      }
    `;

    await expect(parseAndRender(lessCode)).resolves.toBe('.test {\n  color: blue;\n  background: green;\n}\n');
  });

  /*
   * A variable name is a css ident, so its escapes decode (css-syntax-3
   * §4.3.11): an escaped and a plain spelling name one variable (P40).
   */
  it('treats an escaped variable name as its plain spelling', async () => {
    const lessCode = [
      '@\\63 olor: red;',
      '@var\\61: box;',
      '@name: color;',
      '@r: { d: e; };',
      '.@{var\\61} {',
      '  a: @color;',
      '  b: @\\63 olor;',
      '  c: @vara @@\\6e ame;',
      '  @\\72();',
      '}'
    ].join('\n');

    await expect(parseAndRender(lessCode)).resolves.toBe(
      '.box {\n  a: red;\n  b: red;\n  c: box red;\n  d: e;\n}\n'
    );
  });

  it('should resolve a Less variable, escape or call written as the var() name', async () => {
    const lessCode = [
      '@v: --x;',
      '.box {',
      '  a: var(@v);',
      '  b: var(~"--x");',
      '  c: var(e("--x"), 1px);',
      '}'
    ].join('\n');

    await expect(parseAndRender(lessCode)).resolves.toBe(
      '.box {\n  a: var(--x);\n  b: var(--x);\n  c: var(--x, 1px);\n}\n'
    );
  });

  /* An identifier or a plain string is no custom-property name; Less 4.x writes it as authored, and so does Less 5. */
  it('should write a var() named by an identifier or a string as authored', async () => {
    await expect(parseAndRender('.box {\n  a: var(foo);\n  b: var("--x");\n  c: var(foo, 1px);\n}')).resolves.toBe(
      '.box {\n  a: var(foo);\n  b: var("--x");\n  c: var(foo, 1px);\n}\n'
    );
  });

  it('should hold a comparison paren group as a condition, written as authored', async () => {
    const lessCode = [
      '@x: (1px > 2px);',
      '.box {',
      '  a: @x;',
      '  b: boolean(@x);',
      '  c: if(@x, yes, no);',
      '}'
    ].join('\n');

    await expect(parseAndRender(lessCode)).resolves.toBe(
      '.box {\n  a: (1px > 2px);\n  b: false;\n  c: no;\n}\n'
    );
  });

  /*
   * jess#236. `@foo: .a;` holds a mixin reference (owner 2026-10-29: "No,
   * it's a mixin reference."). Unused, it emits nothing and reports nothing.
   * Kept here because it is an absence-of-diagnostics case that no render
   * fixture can express.
   */
  it.each([
    '@foo: .a;\n.bar { color: red; }',
    '@foo: #ns.a;\n.bar { color: red; }',
    '@foo: #ns > .a;\n.bar { color: red; }'
  ])('keeps an unused mixin reference held in a variable silent: %j', async (source) => {
    const result = await new Compiler().renderToResult(
      { source, filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.css).toBe('.bar {\n  color: red;\n}\n');
  });
});
