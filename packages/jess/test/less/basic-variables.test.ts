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

  /*
   * PINNED (jess#236). lessc 4.9.1 keeps `@foo: .a;` as permissive text and
   * only raises on `@foo()`. Less 5 rejects the declaration at parse time, and
   * whether it should is OPEN: ledger P33 settles the leading `/` but leaves
   * `.a` open. Until that is ruled this pins today's rejection; what is fixed
   * is the diagnostic, which names the uncalled mixin reference on its own
   * token, with the called and escaped spellings as the fix. Kept here because
   * it is an absence-of-diagnostics case that no render fixture can express.
   */
  it('PINNED (P33 `.a` OPEN) — rejects an uncalled mixin reference held in a variable, naming it', async () => {
    const result = await new Compiler().renderToResult(
      { source: '@foo: .a;\n.bar { color: red; }', filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/uncalled-mixin-reference',
      message: 'A mixin reference is not a value.',
      fix: 'Call it as .a() to use its result, or write ~".a" to keep it as text.',
      line: 1,
      column: 7,
      endLine: 1,
      endColumn: 9
    });
  });
});
