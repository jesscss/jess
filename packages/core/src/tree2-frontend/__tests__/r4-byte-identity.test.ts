import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { expectedCss, fixtureLess, resolveCollapseNesting } from '../oracle-source.js';

/**
 * R4 — interpolation · detached rulesets · merge · namespaces/maps.
 *
 * Two gate kinds:
 *   1. FIXTURE byte-identity in the fixture's resolved config mode, vs the oracle
 *      (less.js `alpha`) — or, for merge (v5 last-occurrence anchor diverges from
 *      alpha's first-occurrence golden), vs the checked-in proposed correction.
 *   2. FEATURE snippets — minimal cases proving each R4 feature works independent
 *      of the larger fixtures' adjacent (non-R4) gaps.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const correction = (name: string): string =>
  readFileSync(
    path.resolve(HERE, '../../../../../docs/future/core-architecture/proposed-alpha-corrections', `${name}.css`),
    'utf8',
  );

async function render(src: string, collapse: boolean): Promise<string> {
  const root = bridgeToTree2(parseLessFn(src).tree, src);
  return (await serialize(root, { evaluator: buildEvaluator(), collapseNesting: collapse })).css;
}

describe('R4 — byte-identity vs oracle', () => {
  it('namespace-targeted (map accessor + selector interpolation) is byte-identical to alpha', async () => {
    const css = await render(fixtureLess('namespace-targeted'), resolveCollapseNesting('namespace-targeted'));
    expect(css).toBe(expectedCss('namespace-targeted'));
  });

  it('merge folds to the v5 LAST-occurrence anchor (vs proposed alpha correction)', async () => {
    // The committed alpha `merge.css` encodes Less FIRST-occurrence; v5 anchors at
    // LAST occurrence (owner intent), which reorders test-rule-interleaved /
    // -spaced. Gated against the checked-in proposed correction, NOT alpha's golden.
    const css = await render(fixtureLess('merge'), resolveCollapseNesting('merge'));
    expect(css).toBe(correction('merge'));
  });
});

describe('R4 — feature snippets', () => {
  it('R4.1 value + string interpolation (quote-strip, escaped)', async () => {
    const src = `#i {
  @var: '/dev';
  url: "http://lesscss.org@{var}/image.jpg";
  @var3: #456;
  url3: "http://lesscss.org@{var3}";
}
.mix(@a) { color: ~"@{a}"; }
.c { .mix(blue); }`;
    expect(await render(src, true)).toBe(
      `#i {
  url: "http://lesscss.org/dev/image.jpg";
  url3: "http://lesscss.org#456";
}
.c {
  color: blue;
}
`,
    );
  });

  it('R4.1 property-name interpolation', async () => {
    const src = `a { @prefix: ufo-; @{prefix}width: 50%; }`;
    expect(await render(src, true)).toBe(`a {\n  ufo-width: 50%;\n}\n`);
  });

  it('R4.1 selector interpolation resolves at ruleset-enter', async () => {
    const src = `@type: 5_large;\n.icon-@{type} { background: red; }`;
    expect(await render(src, true)).toBe(`.icon-5_large {\n  background: red;\n}\n`);
  });

  it('R4.1 @@name indirect variable (unquoting)', async () => {
    const src = `.a { @var: 'hi'; @name: 'var'; name: @@name; }`;
    expect(await render(src, true)).toBe(`.a {\n  name: 'hi';\n}\n`);
  });

  it('R4.2 detached ruleset scope-unlock (definition-first, caller-fallback)', async () => {
    const src = `@a: 1px;
.wrap(@rs) {
  @a: hidden;
  @d: magic-frame;
  .sel { @rs(); }
}
.wrap({ one: @a; four: @d; });`;
    expect(await render(src, true)).toBe(`.sel {\n  one: 1px;\n  four: magic-frame;\n}\n`);
  });

  it('R4.2 detached ruleset unlocks mixins + default detached args', async () => {
    const src = `@mixins: { .m() { test: test; } };
@mixins();
.a { .m(); }
.def(@x: {}; @y: {default: works;};) { @x(); @y(); }
.b { .def(); }`;
    expect(await render(src, true)).toBe(
      `.a {\n  test: test;\n}\n.b {\n  default: works;\n}\n`,
    );
  });

  it('R4.3 merge +/+_ per-member joiner + !important promotion', async () => {
    const src = `.r {
  a+: x;
  a+: y;
  b+_: p;
  b+_: q;
  c+: m !important;
  c+: n;
}`;
    expect(await render(src, true)).toBe(
      `.r {\n  a: x, y;\n  b: p q;\n  c: m, n !important;\n}\n`,
    );
  });

  it('R4.4 map accessor over a namespace ruleset', async () => {
    const src = `@p: my-prop;
#ns { my-prop: prop-value; }
.t { value: #ns[$@p]; }`;
    // flat: #ns emits its decl; .t resolves the accessor
    expect(await render(src, true)).toBe(
      `#ns {\n  my-prop: prop-value;\n}\n.t {\n  value: prop-value;\n}\n`,
    );
  });
});
