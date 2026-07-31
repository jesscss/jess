/**
 * Interpolation inside a structured pseudo's ARGUMENT (`:not(a#{$x})`).
 *
 * Found by hand-probing, not by any suite: the argument of a selector-valued
 * pseudo is a retained `SelectorList`, and core joined it with the STATIC
 * `pseudoCanonical`. An interpolated member has `text: null`, so it contributed
 * `''` and the argument SERIALIZED AWAY — `.card:not(a#{$x})` emitted
 * `.card:not(a)` and `.card:not(#{$x})` emitted `.card:not()`. Valid-looking
 * CSS, silently missing content, no error and no warning.
 *
 * The gate is a DIFFERENTIAL rather than a fixed expected string: an
 * interpolated selector must emit exactly what its resolved static spelling
 * emits. That is the property the defect broke, and it cannot be satisfied by a
 * serializer that drops the member — `:not(a)` is not `:not(a.foo)`.
 *
 * Ledger row **P21** (`docs/architecture/core/DESIGN-DECISIONS.md`).
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

const render = async (source: string): Promise<string> =>
  await new Compiler({ output: { collapseNesting: true } })
    .renderString(source, { language: 'scss', filePath: '/virtual/pseudo-interp.scss' });

/** `[label, static spelling, interpolated spelling]` — the two must agree byte for byte. */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['whole argument', '.card:not(foo) { c: d }', '$x: foo;\n.card:not(#{$x}) { c: d }'],
  ['after a static prefix', '.card:not(a.foo) { c: d }', '$x: foo;\n.card:not(a.#{$x}) { c: d }'],
  ['class member', '.card:not(.foo) { c: d }', '$x: foo;\n.card:not(.#{$x}) { c: d }'],
  ['after a comma', '.card:not(.a, foo) { c: d }', '$x: foo;\n.card:not(.a, #{$x}) { c: d }'],
  ['after a combinator', '.x:has(> foo) { c: d }', '$x: foo;\n.x:has(> #{$x}) { c: d }'],
  ['crossable pseudo', '.card:is(.a, .foo) { c: d }', '$x: foo;\n.card:is(.a, .#{$x}) { c: d }'],
  ['pseudo inside a complex', '.card:not(a.foo) .b { c: d }', '$x: foo;\n.card:not(a.#{$x}) .b { c: d }'],
  ['trailing static pseudo', '.card:not(a.foo):hover { c: d }', '$x: foo;\n.card:not(a.#{$x}):hover { c: d }'],
  ['nested pseudo argument', '.card:not(:is(.foo, .z)) { c: d }', '$x: foo;\n.card:not(:is(.#{$x}, .z)) { c: d }'],
  ['deep relative argument', '.card:has(.a > .foo + .b) { c: d }', '$x: foo;\n.card:has(.a > .#{$x} + .b) { c: d }'],
  ['attribute value', '.card:not([title="b"]) { c: d }', '$x: "b";\n.card:not([title="#{$x}"]) { c: d }'],
  ['under a nesting parent', '.a:not(.foo) { c: d }', '$x: foo;\n.a { &:not(.#{$x}) { c: d } }'],
  ['parent reference inside the argument', '.c:not(.a.foo) { c: d }', '$x: foo;\n.a { .c:not(&.#{$x}) { c: d } }'],
  ['inside an at-rule', '@media screen { .card:not(.foo) { c: d } }', '$x: foo;\n@media screen { .card:not(.#{$x}) { c: d } }'],
  ['extended target', '.card:not(a.foo) { c: d }\n.other { @extend .card; }', '$x: foo;\n.card:not(a.#{$x}) { c: d }\n.other { @extend .card; }'],
  ['crossable extend source', '.card:is(a.foo) { c: d }\n.other { @extend a.foo; }', '$x: foo;\n.card:is(a.#{$x}) { c: d }\n.other { @extend a.foo; }']
];

describe('interpolated structured pseudo arguments', () => {
  it.each(PAIRS)('emits the resolved spelling — %s', async (_label, staticSource, interpolatedSource) => {
    expect(await render(interpolatedSource)).toBe(await render(staticSource));
  });

  /*
   * The differential above would also be satisfied by resolving ONCE and reusing
   * the result. Two `@each` iterations bind the same reference to different
   * values, so a cached argument spelling shows up here and nowhere else.
   */
  it('resolves the argument per frame, not once', async () => {
    const css = await render('$x: foo;\n@each $i in 1, 2 { .a:not(.#{$x}-#{$i}) { c: d } }');

    expect(css).toBe('.a:not(.foo-1) {\n  c: d;\n}\n.a:not(.foo-2) {\n  c: d;\n}\n');
  });

  /*
   * The subject `&` over MULTIPLE parents wraps in `:is(…)`; inside a
   * list-accepting pseudo it stays the BARE parent list. Both happen in one
   * selector here, with an interpolated member riding along, so a fix that
   * resolved the argument by flattening the pseudo to opaque text would show up.
   */
  it('keeps `&` semantics inside an interpolated argument', async () => {
    const css = await render('$x: foo;\n.a, .b { &:not(&.#{$x}) { c: d } }');

    expect(css).toBe(':is(.a, .b):not(:is(.a, .b).foo) {\n  c: d;\n}\n');
  });
});
