import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import type { Rules } from '../rules.js';

/**
 * RATCHET (cutover MIXIN #0 — interpolated call-name parity). An interpolated
 * mixin-call NAME (`.@{n}()`, `.foo-@{n}()`) is NOT representable by the current
 * parser: the interpolation is dropped from the call-name key (`.@{n}()` parses to
 * no Call; `.foo-@{n}()` parses with the truncated static key `.foo-`). BOTH the
 * spine and the eval path therefore produce the SAME (currently-degenerate) result
 * — there is no spine-vs-eval divergence and no silent-empty spine bug.
 *
 * This ratchet LOCKS that parity: the spine render must byte-match the eval render
 * for these shapes. A future change that folds an interpolated call name on the
 * spine WITHOUT also fixing the eval/parser path (or vice-versa) trips this RED —
 * catching a silent divergence before it ships.
 *
 * The real fix (resolve the interpolated call name to a string key, then reuse the
 * static callable lookup) is a PARSER feature gap: the parser must first represent
 * the interpolation in the call-name key. Deferred to the parser owner; it is OFF
 * the spine-P4 critical path (neither path handles the shape, so it does not block
 * removing the eval pass). See the design report's fold #7.
 */
async function render(source: string, spine: boolean): Promise<string> {
  const context = new Context({ output: { collapseNesting: false }, leakyRules: true });
  const { tree } = new Parser().parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  // A `preSerializeRoot` hook forces the eval path (Rules.render skips the spine
  // when the hook is set); its absence lets the spine run. Identity hook = eval.
  const options = spine
    ? { context }
    : { context, preSerializeRoot: (r: Rules): Rules => r };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (await renderNodeToString(root as unknown as RenderBufferNode, context, options)).trim();
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message : String(e)}`;
  }
}

describe('mixin #0 — interpolated call-name spine==eval parity (parser-blocked fold)', () => {
  const cases: Array<[string, string]> = [
    ['.@{n}()', `@n: foo;\n.foo() { color: red; }\n.a { .@{n}(); }`],
    ['.foo-@{n}()', `@n: bar;\n.foo-bar() { color: red; }\n.a { .foo-@{n}(); }`]
  ];
  for (const [name, src] of cases) {
    it(`${name} renders byte-identical on spine and eval`, async () => {
      const spineCss = await render(src, true);
      const evalCss = await render(src, false);
      expect(spineCss).toBe(evalCss);
    });
  }
});
