import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * KEYWORD ARGUMENTS IN A FUNCTION CALL — `fade(@c, @amount: 50%)`,
 * `adjust-hue($degrees: 60deg, $color: red)`.
 *
 * A keyword argument states a BINDING, not a position. The only place that
 * mapping exists is the callee's own parameter list, so the order comes from the
 * resolved function's declared parameter names and never from the call site.
 *
 * The construct is not new to the language — `.less` `.m(@a: 1)` and `.scss`
 * `@include m($x: 1)` have always spelled it — so it is not a new NODE either:
 * `FunctionCall.args` and `MixinCall.args` are both `CallArg[]`, and one `.jess`
 * source produces one node whichever callee it names.
 */
const render = async (source: string, extension: string): Promise<string> =>
  new Compiler({ compile: { collapseNesting: true } })
    .renderString(source, { filePath: `keyword-arguments${extension}`, extension });

describe('keyword arguments in a function call', () => {
  it('binds a Less keyword argument to the position its name declares', async () => {
    await expect(render('@c: #ff0000; a { b: fade(@c, @amount: 50%); }', '.less'))
      .resolves.toBe('a {\n  b: rgba(255, 0, 0, 0.5);\n}\n');
  });

  it('answers the same bytes as the positional spelling of the same call', async () => {
    const keyword = await render('@c: #ff0000; a { b: fade(@c, @amount: 50%); }', '.less');
    const positional = await render('@c: #ff0000; a { b: fade(@c, 50%); }', '.less');

    expect(keyword).toBe(positional);
  });

  it('REORDERS a user @function\'s arguments by declared parameter name', async () => {
    /* The proof that the name is doing the work: authored order is `$y, $x` and
     * the answer is `1 2`, which only the declaration's order can produce. */
    await expect(render('@function f($x, $y) { @return $x $y; } a { b: f($y: 2, $x: 1); }', '.scss'))
      .resolves.toBe('a {\n  b: 1 2;\n}\n');
  });

  it('mixes positional and keyword arguments, positional filling the unclaimed slots', async () => {
    await expect(render('@function f($x, $y) { @return $x $y; } a { b: f(1, $y: 2); }', '.scss'))
      .resolves.toBe('a {\n  b: 1 2;\n}\n');
  });

  it('parses the Sass module-call spelling that blocked the Foundation corpus', async () => {
    /* `color.adjust` has no implementation yet, so it PRESERVES — the point of
     * this case is that it reaches evaluation at all instead of being a parse
     * error, which is what blocked fifteen Foundation entry points. */
    await expect(render('$g: #333; a { b: color.adjust($g, $lightness: -10%); }', '.scss'))
      .resolves.toContain('color.adjust(');
  });
});
