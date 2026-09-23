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
   * jess#236. A variable holding a bare mixin reference is only a problem when
   * it is CALLED: lessc 4.9.1 compiles `@foo: .a;` and only raises on
   * `@foo()`. The declaration alone now parses, and its value is the authored
   * bytes — which is also what lessc emits for `.x { u: @foo; }`.
   *
   * Kept here because it is an absence-of-diagnostics case that no render
   * fixture can express — the corpus only covers the lookup and with-parens
   * forms.
   */
  it('accepts an uncalled variable holding a mixin reference', async () => {
    const result = await new Compiler().renderToResult(
      { source: '@foo: .a;\n.bar { color: red; }', filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.css).toBe('.bar {\n  color: red;\n}\n');
  });

  /*
   * jess#235 and the third case neither issue lists. These are the RENDERED
   * halves of the parser fixtures in
   * `packages/syntax/less/less-parser/test/discovered-constructs.test.ts`: the
   * value survives evaluation as its authored bytes, including through
   * interpolation, which is the only reason holding a path in a variable is
   * useful at all.
   *
   * Whether the same text should also parse in PROPERTY position is open and
   * deliberately unpinned — our own CSS parser accepts `a { p: /img }`.
   * DESIGN-DECISIONS P32.
   */
  it.each([
    ['slash-led path', '@p: /img/icon.svg;\n.x { u: @p; }', '.x {\n  u: /img/icon.svg;\n}\n'],
    ['bare slash-led name', '@p: /img;\n.x { u: @p; }', '.x {\n  u: /img;\n}\n'],
    ['class-shaped name', '@p: .a;\n.x { u: @p; }', '.x {\n  u: .a;\n}\n'],
    ['id-shaped name', '@p: #id;\n.x { a: @p; }', '.x {\n  a: #id;\n}\n'],
    ['nested declaration', '.y { @p: /img; u: @p; }', '.y {\n  u: /img;\n}\n'],
    ['through interpolation', '@p: /img/icon.svg;\n.x { u: url("@{p}"); }', '.x {\n  u: url("/img/icon.svg");\n}\n']
  ])('renders a verbatim variable value as lessc 4.9.1 does (%s)', async (_label, source, css) => {
    await expect(parseAndRender(source)).resolves.toBe(css);
  });

  /*
   * The declaration is legal, the LOOKUP is not — which is the whole shape of
   * `tests-error/eval/namespacing-3.less`: lessc 4.9.1 compiles `@alias: .theme`
   * and raises "Could not evaluate variable call @alias" only at `@alias[foo]`.
   * Accepting the declaration moves this from a parse error to the eval error
   * it always should have been; before, a resolve failure on a BOUND base fell
   * through to rendering the reference's own bytes, which is the permanent-eval-
   * fallback shape and hid the failure entirely once the parse error was gone.
   */
  it('raises on a lookup into a variable that holds no members', async () => {
    const result = await new Compiler().renderToResult(
      {
        source: '.theme() {\n  foo: bar;\n}\n\n.val {\n  @alias: .theme;\n  foo: @alias[foo];\n}',
        filePath: 'namespacing.less',
        extension: '.less'
      },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'resolve/name-not-found',
      reason: '"@alias[foo]" looks up a member of a value that has none.',
      line: 7
    });
  });

  it('leaves a lookup on an UNBOUND base verbatim', async () => {
    /*
     * The control for the rule above and the reason it is keyed on the base
     * binding: `@compose … as *` deliberately leaves the namespace unbound, and
     * `@foo.colors.primary` must survive as bytes rather than raise.
     */
    const result = await new Compiler().renderToResult(
      { source: '.val { foo: @nope[foo]; }', filePath: 'entry.less', extension: '.less' },
      { breakOnError: false }
    );

    expect(result.errors).toHaveLength(0);
    expect(result.css).toBe('.val {\n  foo: @nope[foo];\n}\n');
  });
});
