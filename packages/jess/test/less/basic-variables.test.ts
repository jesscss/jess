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
   * PINNED DEFECT (jess#236). A variable holding a bare mixin reference is only
   * a problem when it is CALLED: lessc 4.9.1 compiles `@foo: .a;` and only
   * raises on `@foo()`. Less 5 rejects the DECLARATION at parse time, and the
   * caret lands on the value's `.` with a selector/mixin-call/block message, so
   * the diagnostic does not name the real cause either.
   *
   * This asserts the current, wrong behaviour; fixing the defect fails the pin.
   * Kept here because it is an absence-of-diagnostics case that no render
   * fixture can express — the corpus only covers the lookup and with-parens
   * forms.
   */
  it('PINNED DEFECT — rejects an uncalled variable holding a mixin reference', async () => {
    const result = await new Compiler().renderToResult(
      { source: '@foo: .a;\n.bar { color: red; }', filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'parse/syntax-error', line: 1, column: 5 });
  });
});
