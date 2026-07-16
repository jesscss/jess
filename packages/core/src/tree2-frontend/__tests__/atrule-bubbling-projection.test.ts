/**
 * [atrule-bubbling] Serialize-side at-rule bubbling projection (WS1).
 *
 * CONTRACT with the bridge: a nested at-rule (`@media`/`@supports`/`@container`/
 * `@layer`/`@document`/`@starting-style`/…) appears as a normal child `AtRuleBlock`
 * node inside a ruleset's tree2 body. At serialize time we PROJECT it to the block
 * level per the spine-is-projection principle (no tree mutation): a bubbleable
 * (conditional-group) at-rule wraps the enclosing composed selector inside its
 * body; a directive at-rule (`@font-face`/`@keyframes`/…) bubbles WITHOUT selector
 * propagation. These constructed-node cases lock the projection independently of
 * the bridge accepting nested at-rules (verified end-to-end byte-identical against
 * the alpha `at-rules-bubbling` / `at-rules-targeted` goldens with the bridge
 * accept-side in place).
 */
import { describe, it, expect } from 'vitest';
import { serialize } from '../../tree2/index.js';
import { buildEvaluator } from '../value-eval.js';
import { root, rule, decl, word, complex, compound } from '../../tree2/nodes.js';
import { atRuleBlock } from '../../tree2/at-rule.js';

const ev = buildEvaluator();
async function ser(r: Parameters<typeof serialize>[0]): Promise<string> {
  return (await serialize(r, { evaluator: ev, collapseNesting: true })).css;
}
const insideAmp = complex([{ compound: compound('.inside') }, { comb: ' ', compound: compound('&') }]);

describe('WS1 bubbling (constructed nodes)', () => {
  it('bubbleable propagates selector into nested ruleset', async () => {
    // .parent { color: green; @document url-prefix() { .child { color: red; } } }
    const tree = root([
      rule('.parent', [
        decl('color', word('green')),
        atRuleBlock('@document', word('url-prefix()'), [
          rule('.child', [decl('color', word('red'))]),
        ]),
      ]),
    ]);
    expect(await ser(tree)).toBe(
      '.parent {\n  color: green;\n}\n@document url-prefix() {\n  .parent .child {\n    color: red;\n  }\n}\n',
    );
  });

  it('& composes with the enclosing selector', async () => {
    // .top { @supports (sandwitch: butter) { .inside & { property: value; } } }
    const tree = root([
      rule('.top', [
        atRuleBlock('@supports', word('(sandwitch: butter)'), [
          rule(insideAmp, [decl('property', word('value'))]),
        ]),
      ]),
    ]);
    expect(await ser(tree)).toBe(
      '@supports (sandwitch: butter) {\n  .inside .top {\n    property: value;\n  }\n}\n',
    );
  });

  it('directive at-rule does NOT propagate selector', async () => {
    // .onTop { @font-face { font-family: something; src: made-up-url; } }
    const tree = root([
      rule('.onTop', [
        atRuleBlock('@font-face', null, [
          decl('font-family', word('something')),
          decl('src', word('made-up-url')),
        ]),
      ]),
    ]);
    expect(await ser(tree)).toBe(
      '@font-face {\n  font-family: something;\n  src: made-up-url;\n}\n',
    );
  });

  it('direct declarations in a bubbleable body wrap in the context', async () => {
    // @media print { html { in-html: visible; @supports (upper: test) { in-supports: first; div { in-div: visible; } } } }
    const tree = root([
      atRuleBlock('@media', word('print'), [
        rule('html', [
          decl('in-html', word('visible')),
          atRuleBlock('@supports', word('(upper: test)'), [
            decl('in-supports', word('first')),
            rule('div', [decl('in-div', word('visible'))]),
          ]),
        ]),
      ]),
    ]);
    expect(await ser(tree)).toBe(
      '@media print {\n  html {\n    in-html: visible;\n  }\n  @supports (upper: test) {\n    html {\n      in-supports: first;\n    }\n    html div {\n      in-div: visible;\n    }\n  }\n}\n',
    );
  });

  it('ctx flows through directly-nested bubbleable at-rules', async () => {
    // .outOfMedia { @media (max-size: 2px) { @supports (whatever: something) { property: value; } } }
    const tree = root([
      rule('.outOfMedia', [
        atRuleBlock('@media', word('(max-size: 2px)'), [
          atRuleBlock('@supports', word('(whatever: something)'), [
            decl('property', word('value')),
          ]),
        ]),
      ]),
    ]);
    expect(await ser(tree)).toBe(
      '@media (max-size: 2px) {\n  @supports (whatever: something) {\n    .outOfMedia {\n      property: value;\n    }\n  }\n}\n',
    );
  });
});
