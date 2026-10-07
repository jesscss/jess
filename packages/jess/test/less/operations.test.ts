import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/*
 * ENABLED (not `.todo`): the standing guard for named-color division under
 * `math: always`. This catches the NamedColor→Keyword regression where a
 * named-color operand was rejected by the bare-slash operand gate
 * (`appendBareSlashTokens`) and stopped folding, while a hex color still folded.
 * lessc 4.x `--math=always`: `red / 2` → `#800000` AND `#ff0000 / 2` → `#800000`
 * (symmetric). The font-shorthand slash-SPACING row from the surrounding
 * `describe('Operations')` block is deliberately NOT un-todoed here: it
 * asserts the spaced separator form (`small / 20px`), which is the OPEN V12
 * question (authored-slash spacing), unimplemented and unrelated to this change.
 */
describe('Operations — named-color division in math: always', () => {
  it('folds named-color keyword division like a hex color in math: always mode', async () => {
    const alwaysCompiler = new Compiler({
      compile: {
        mathMode: 'always',
        plugins: [lessPlugin()]
      }
    });

    /* A named color folds under `/` exactly like a hex color (lessc 4.x parity):
     * `red / 2` → `#800000`, `#ff0000 / 2` → `#800000`. */
    const named = await alwaysCompiler.renderString('.test { color: red / 2; }', { language: 'less' });
    expect(named).toContain('color: #800000');
    const hex = await alwaysCompiler.renderString('.test { color: #ff0000 / 2; }', { language: 'less' });
    expect(hex).toContain('color: #800000');

    // A non-color keyword stays an authored slash list (no fold).
    const plain = await alwaysCompiler.renderString('.test { color: foo / 2; }', { language: 'less' });
    expect(plain).toContain('color: foo / 2');
  });
});

describe('Operations', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Basic Arithmetic Operations', () => {
    it('should handle addition', async () => {
      const lessCode = `
        .test {
          width: 10px + 5px;
          height: 20px + 10;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 15px;');

      // A unitless addend is kept as written under the default unitMode (owner 2026-10-06).
      expect(css).toContain('height: 20px + 10;');
    });

    it('should handle subtraction', async () => {
      const lessCode = `
        .test {
          width: 20px - 5px;
          height: 30px - 10;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 15px;');
      expect(css).toContain('height: 30px - 10;');
    });

    it('should handle multiplication', async () => {
      const lessCode = `
        .test {
          width: 5px * 3;
          height: 10 * 2px;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 15px');
      expect(css).toContain('height: 20px');
    });

    it('should handle division', async () => {
      const lessCode = `
        .test {
          width: 20px / 2;
          height: 30px / 3;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 20px / 2');
      expect(css).toContain('height: 30px / 3');
    });
  });

  describe('Operations with Variables', () => {
    it('should handle operations with variables', async () => {
      const lessCode = `
        @base: 10px;
        @multiplier: 2;
        @adder: 5px;

        .test {
          width: @base * @multiplier;
          height: @base + @adder;
          margin: @base - 2px;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 20px');
      expect(css).toContain('height: 15px');
      expect(css).toContain('margin: 8px');
    });

    it('should handle complex operations with variables', async () => {
      const lessCode = `
        @width: 100px;
        @height: 50px;
        @padding: 10px;

        .test {
          width: @width - (@padding * 2);
          height: @height + @padding;
          area: @width * @height;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 80px');
      expect(css).toContain('height: 60px');

      /*
       * px * px composes a unit CSS cannot express: v5 warns and defers to calc()
       * (Less 4.x naively produced `5000px`). Loose unitMode would multiply instead.
       */
      expect(css).toContain('area: calc(100px * 50px)');
    });

    it('preserves slash-list variable values inside later operations in parens-division mode', async () => {
      const lessCode = `
        @div-op: 10px / 2;

        .test {
          result: @div-op * 2;
        }
      `;

      /*
       * `@div-op` is a slash list (the slash does not divide under
       * parens-division), so the `*` has nothing it can multiply and the
       * operation is preserved as `calc(…)` — owner-approved fixture change
       * (DESIGN-DECISIONS P35).
       */
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('result: calc(10px / 2 * 2)');
    });

    it('should preserve spacing', async () => {
      const lessCode = `
        .test {
          foo: 1 + 2 calc(3 + 4) 5 + 6;
        }
      `;

      /* Math inside calc() is kept as written (owner 2026-09-24, P35). */
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('foo: 3 calc(3 + 4) 11');
    });

    it('should reduce calc operations and expressions', async () => {
      const lessCode = `
        @val: 10px;
        .no-math {
          @c: 10px + 20px;
          @calc: (@val + 30px);
          root: calc(100% - @c);
          root2: calc(100% - @calc);
          @var: 50vh/2;
          width: calc(50% + (@var - 20px));
          height: calc(50% + ((@var - 20px)));
          min-height: calc(((10vh)) + calc((5vh)));
          foo: 1 + 2 calc(3 + 4) 5 + 6;
          @floor: floor(1 + .1);
          bar: calc(@floor + 20%);
        }

        .b {
          @a: 10px;
          @b: 10px;

          one: calc(100% - ((min(@a + @b))));
          two: calc(100% - (((@a + @b))));
          three: calc(e('100%') - (3 * 1));
          four: calc(~'100%' - (3 * 1));
          nested: calc(calc(2.25rem + 2px) - 1px * 2);
        }

        .c {
          @v: 10px;
          height: calc(100% - ((@v * 3) + (@v * 2)));
        }
      `;

      /*
       * Math inside calc() is kept as written with variables substituted (owner
       * 2026-09-24, DESIGN-DECISIONS P35): a math function's result is clamped
       * to what the property allows, so folding it changes the value. Every paren
       * authored inside calc() survives, redundant or not (owner 2026-10-06). A
       * variable's own math (`@c`, `@calc`) still computes, and `min()` is a Less
       * built-in.
       */
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContainString(`
        .no-math {
          root: calc(100% - 30px);
          root2: calc(100% - 40px);
          width: calc(50% + (50vh / 2 - 20px));
          height: calc(50% + ((50vh / 2 - 20px)));
          min-height: calc(((10vh)) + calc((5vh)));
          foo: 3 calc(3 + 4) 11;
          bar: calc(1 + 20%);
        }
        .b {
          one: calc(100% - ((20px)));
          two: calc(100% - (((10px + 10px))));
          three: calc(100% - (3 * 1));
          four: calc(100% - (3 * 1));
          nested: calc(calc(2.25rem + 2px) - 1px * 2);
        }
        .c {
          height: calc(100% - ((10px * 3) + (10px * 2)));
        }
      `);
    });
  });

  describe('Color Operations', () => {
    it('should handle color arithmetic', async () => {
      const lessCode = `
        .test {
          color: #000000 + #ffffff;
          background: #ff0000 + #00ff00;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: #ffffff');
      expect(css).toContain('background: #ffff00');
    });

    it('should handle color operations with variables', async () => {
      const lessCode = `
        @primary: #ff0000;
        @secondary: #00ff00;

        .test {
          color: @primary + @secondary;
          background: @primary - #0000ff;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: #ffff00');
    });
  });

  describe('Unit Operations', () => {
    it('should handle operations with different units', async () => {
      const lessCode = `
        .test {
          width: 50% + 25%;
          height: 100vh - 20vh;
          font-size: 1em * 1.5;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 75%');
      expect(css).toContain('height: 80vh');
      expect(css).toContain('font-size: 1.5em');
    });

    it('should handle operations with mixed units', async () => {
      const lessCode = `
        .test {
          width: 100px + 50%;
          height: 200px - 10%;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      // Note: Less handles mixed units differently, this is just to test parsing
      expect(css).toContain('width:');
      expect(css).toContain('height:');
    });
  });

  describe('Parentheses and Precedence', () => {
    it('should handle parentheses for precedence', async () => {
      const lessCode = `
        .test {
          width: (10px + 5px) * 2;
          height: 10px + (5px * 2);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 30px');
      expect(css).toContain('height: 20px');
    });

    it('should handle nested parentheses', async () => {
      const lessCode = `
        .test {
          width: ((10px + 5px) * 2) + 10px;
          height: (20px - (5px * 2)) / 2;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 40px');
      expect(css).toContain('height: 10px / 2');
    });
  });

  describe('calc() Function', () => {
    it('should handle calc() function', async () => {
      const lessCode = `
        .test {
          width: calc(100% - 20px);
          height: calc(50vh + 10px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: calc(100% - 20px)');
      expect(css).toContain('height: calc(50vh + 10px)');
    });

    it('should handle calc() with variables', async () => {
      const lessCode = `
        @margin: 20px;
        @padding: 10px;

        .test {
          width: calc(100% - @margin);
          height: calc(50vh + @padding);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: calc(100% - 20px)');
      expect(css).toContain('height: calc(50vh + 10px)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations with zero', async () => {
      const lessCode = `
        .test {
          width: 10px + 0;
          height: 20px * 0;
          margin: 0 + 5px;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });

      // Zero is a unitless number like any other: `+ 0` is kept as written.
      expect(css).toContain('width: 10px + 0;');
      expect(css).toContain('height: 0px;');
      expect(css).toContain('margin: 0 + 5px;');
    });

    it('should handle operations with negative values', async () => {
      const lessCode = `
        .test {
          width: 10px + (-5px);
          height: 20px - (-10px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('width: 5px');
      expect(css).toContain('height: 30px');
    });
  });
});

/*
 * Owner 2026-10-06 (ledger P35): a unitless number added to or subtracted from a
 * dimension with a unit computes ONLY under `unitMode: 'loose'`. The default
 * `preserve` keeps it as written — never as `calc(…)`, which rejects
 * `<number> + <length>` too — and warns; `strict` raises. `*` and `/` by a
 * unitless number are unaffected.
 */
describe('Operations — a unitless number ± a dimension with a unit', () => {
  const renderSheet = async (unitMode: 'loose' | 'preserve' | 'strict', source: string, mathMode?: 'always' | 'parens-division') => {
    const options = { unitMode, ...(mathMode ? { mathMode } : {}) };
    const result = await new Compiler({ compile: { ...options, plugins: [lessPlugin(options)] }, quiet: true })
      .renderToResult({ source, filePath: 'entry.less', extension: '.less' }, { quiet: true });
    return {
      css: result.css.replace(/\s+/g, ' ').trim(),
      warnings: result.warnings.map(w => w.code),
      errors: result.errors.map(w => w.code)
    };
  };
  const render = (unitMode: 'loose' | 'preserve' | 'strict', body: string, mathMode?: 'always' | 'parens-division') =>
    renderSheet(unitMode, `.a { ${body} }`, mathMode);

  it('preserve keeps it as written, without calc(), and warns', async () => {
    const { css, warnings } = await render('preserve', 'a: 4 + 3px; b: 3px - 1;');
    expect(css).toBe('.a { a: 4 + 3px; b: 3px - 1; }');
    expect(warnings).toEqual(['eval/unexpressible-unit', 'eval/unexpressible-unit']);
  });

  it('loose computes it, the Less 4.x coercion', async () => {
    const { css, warnings } = await render('loose', 'a: 4 + 3px; b: 3px - 1;');
    expect(css).toBe('.a { a: 7px; b: 2px; }');
    expect(warnings).toEqual([]);
  });

  it('strict raises the structured unit error', async () => {
    expect((await render('strict', 'a: 4 + 3px;')).errors).toEqual(['eval/invalid-unit-arithmetic']);
    expect((await render('strict', 'a: 3px - 1;')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('multiplication and division by a unitless number compute in every mode', async () => {
    for (const unitMode of ['loose', 'preserve', 'strict'] as const) {
      const { css, warnings } = await render(unitMode, 'a: 2px * 3; b: (6px / 2);');
      expect(css, unitMode).toBe('.a { a: 6px; b: 3px; }');
      expect(warnings, unitMode).toEqual([]);
    }
  });

  it('an authored paren group around the kept math keeps its parens, so precedence survives', async () => {
    const { css, warnings } = await render('preserve', '@w: 4; a: (@w + 3px); b: (@w + 3px) * 2; c: 1px (@w + 3px) 2; d: (10px / 2px + 6px - 1px * 2);');

    // The parts that do compute still compute: `10px / 2px` is 5 and `1px * 2` is 2px.
    expect(css).toBe('.a { a: (4 + 3px); b: (4 + 3px) * 2; c: 1px (4 + 3px) 2; d: (5 + 6px - 2px); }');

    // Every declaration warns once, the chain (b) and the space-list member (c) included.
    expect(warnings).toEqual(Array(4).fill('eval/unexpressible-unit'));
  });

  it('kept math reached through a variable or a mixin argument keeps its precedence', async () => {
    const { css } = await render('preserve', '@w: 4; @x: @w + 3px; a: @x * 2; b: 2 * @x; c: 10px - @x; d: -@x; e: @x + 1px; f: 1px + @x;');
    expect(css).toBe('.a { a: (4 + 3px) * 2; b: 2 * (4 + 3px); c: 10px - (4 + 3px); d: -1 * (4 + 3px); e: 4 + 3px + 1px; f: 1px + 4 + 3px; }');

    const mixin = await renderSheet('preserve', '@w: 4; .m(@a) { width: @a * 2; } .a { .m(@w + 3px); }');
    expect(mixin.css).toBe('.a { width: (4 + 3px) * 2; }');

    // One kept operation, one warning: the argument and the declaration reading it are one thing written.
    expect(mixin.warnings).toEqual(['eval/unexpressible-unit']);

    // Inside a math function the operation itself is kept as written, and a kept operand still groups.
    expect((await render('preserve', '@x: foo + 1; a: calc(@x * 2); b: calc(2 - @x);')).css).toBe('.a { a: calc((foo + 1) * 2); b: calc(2 - (foo + 1)); }');
  });

  it('a call that consumes the kept math warns, whether it is written out or formats it', async () => {
    const { css, warnings } = await render('preserve', '@w: 4; a: percentage(@w + 3px); b: foo((@w + 3px)); c: e(%("%d", @w + 3px));');
    expect(css).toBe('.a { a: percentage(4 + 3px); b: foo((4 + 3px)); c: 4 + 3px; }');
    expect(warnings).toEqual(Array(3).fill('eval/unexpressible-unit'));
  });

  it('a guard reading the kept math does not match, and says why', async () => {
    const guard = await renderSheet('preserve', '.m(@a) when (@a + 1px > 5px) { x: y; } .m(@a) when (default()) { x: d; } .b { .m(5); }');
    expect(guard.css).toBe('.b { x: d; }');
    expect(guard.warnings).toEqual(['eval/unexpressible-unit']);
    expect((await renderSheet('loose', '.m(@a) when (@a + 1px > 5px) { x: y; } .m(@a) when (default()) { x: d; } .b { .m(5); }')).css).toBe('.b { x: y; }');

    // In value position the same comparison has no ground and raises (§4.2a).
    expect((await render('preserve', '@w: 4; a: if((@w + 3px) > 5px, y, n);')).errors).toEqual(['eval/incomparable-operands']);
    expect((await render('loose', '@w: 4; a: if((@w + 3px) > 5px, y, n);')).css).toBe('.a { a: y; }');
    expect((await render('strict', '@w: 4; a: if((@w + 3px) > 5px, y, n);')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });

  it('a non-dividing slash keeps each side as written: `4 / 2 + 5em` (P35)', async () => {
    expect((await render('preserve', 'a: 4 / 2 + 5em;', 'parens-division')).css).toBe('.a { a: 4 / 2 + 5em; }');
    expect((await render('loose', 'a: 4 / 2 + 5em;', 'parens-division')).css).toBe('.a { a: 4 / 7em; }');
    expect((await render('preserve', 'a: 4 / 2 + 5em;', 'always')).css).toBe('.a { a: 2 + 5em; }');
    expect((await render('loose', 'a: 4 / 2 + 5em;', 'always')).css).toBe('.a { a: 7em; }');
  });

  it('a compound operand stays on the V18 calc() spelling', async () => {
    const { css } = await render('preserve', 'a: (2em / 1px) + 20;');
    expect(css).toBe('.a { a: calc(2em / 1px + 20); }');
  });

  it('comparison is not arithmetic: a unitless side stays a wildcard (V21)', async () => {
    for (const unitMode of ['loose', 'preserve', 'strict'] as const) {
      const { css } = await render(unitMode, 'a: if((4 = 4px), y, n); b: if((4 < 5px), y, n);');
      expect(css, unitMode).toBe('.a { a: y; b: y; }');
    }
  });
});
