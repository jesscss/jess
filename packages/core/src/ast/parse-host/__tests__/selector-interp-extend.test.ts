import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * [extend/selector-interp] The extend planner reads each rule selector's IR before
 * the frame walk, so an interpolated selector (`[data=@{v}]`, `.@{n}`) was `''` at
 * match/emit time — the interp rule neither matched an `:extend()` target nor emitted
 * its concrete header. The `resolveSelectorInterpForExtend` pre-pass (serialize.ts)
 * resolves interp selectors to static text in their lexical frame BEFORE the planner
 * runs, so both matching and header emission see the concrete selector.
 */
function render(src: string): string {
  const res = renderAstDoc(src, {
    evaluator: buildEvaluator(makeBuiltinRegistry()),
    collapseNesting: false,
  });
  if (res.threw) throw res.threw;
  return res.css ?? '';
}

describe('selector interpolation under extend', () => {
  it('attribute-value interp resolves and an :extend() targeting the resolved value folds in', () => {
    const css = render(
      `.attributes {\n` +
        `  @attr-data: "test3";\n` +
        `  [data=@{attr-data}] {\n` +
        `    extend: attributes2;\n` +
        `  }\n` +
        `  .attribute-test {\n` +
        `    &:extend([data="test3"] all);\n` +
        `  }\n` +
        `}`,
    );
    expect(css).toBe(
      `.attributes {\n` +
        `  [data="test3"],\n` +
        `  .attribute-test {\n` +
        `    extend: attributes2;\n` +
        `  }\n` +
        `}\n`,
    );
  });

  it('a class interp selector emits its resolved header even when the document has an unrelated extend', () => {
    const css = render(
      `@n: foo;\n` +
        `.wrap {\n` +
        `  .@{n} {\n` +
        `    color: red;\n` +
        `  }\n` +
        `}\n` +
        `.a:extend(.b) {\n` +
        `  x: y;\n` +
        `}`,
    );
    // The interp selector `.@{n}` resolves to `.foo` (not an empty header) despite the
    // document carrying an `:extend()` that forces the planner to build every rule's plan.
    expect(css).toContain('.foo {');
  });
});
