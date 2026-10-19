import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { parse as parseScss } from '../../../../syntax/scss/scss-parser/src/index.js';
import { parse as parseJess } from '../../../../syntax/jess/jess-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry, makeSassRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';
import type { Stylesheet } from '../nodes.js';

const lessEvaluator = buildEvaluator(makeLessRegistry());
const sassEvaluator = buildEvaluator(makeSassRegistry());

/* `'native'` is the collapsed output; `false` is the nested output. */
type Mode = 'native' | false;
const render = (document: Stylesheet, collapseNesting: Mode, sass = false): string => {
  const result = serialize(document, { evaluator: sass ? sassEvaluator : lessEvaluator, collapseNesting });
  if (result instanceof Promise) {
    throw new Error('expected a synchronous render');
  }
  return result.css ?? '';
};
const less = (source: string, mode: Mode): string => render(parseLess(source), mode);
const scss = (source: string, mode: Mode): string => render(parseScss(source), mode, true);
const jess = (source: string, mode: Mode): string => render(parseJess(source), mode);

/**
 * Every walked body has a `Placement`: where its rules compose, which block its
 * declarations join, and the `!important`, `$apply` and comment-replay facts it
 * carries. A body walked in place of a statement (a mixin, a detached ruleset, a
 * `$apply`'d rule, a loop iteration) derives its placement from the one the
 * statement stands in; a body with no enclosing walk (the document, an at-rule's
 * body, a mixin read as a map) builds its own. Each case pins one fact one of those
 * placements carries, through an input that neither the rest of the suite nor the
 * corpus reaches.
 */
describe('placement derivation', () => {
  it('a mixin body keeps the opaque ancestor its caller composes `&`-less rules against', () => {
    const direct = less('.a { .b, .c { .d { x: y; } } }', 'native');
    expect(direct).toBe('.a :is(.b, .c) .d {\n  x: y;\n}\n');
    expect(less('.a { .b, .c { .m(); } }\n.m() { .d { x: y; } }', 'native')).toBe(direct);
  });

  it('a mixin body\'s trailing comment stays in its caller\'s block, ahead of a rule it places', () => {
    expect(less('.m() { a: b; .x { c: d; } /* tail */ }\n.y { .m(); }', 'native'))
      .toBe('.y {\n  a: b;\n  /* tail */\n}\n.y .x {\n  c: d;\n}\n');
  });

  it('a detached ruleset body and a loop body replay their own comments', () => {
    for (const mode of ['native', false] as const) {
      expect(less('@dr: { /* note */ c: d; };\n.a { @dr(); }', mode)).toBe('.a {\n  /* note */\n  c: d;\n}\n');
      expect(less('.a { each(1 2, { /* c */ b: @value; }); }', mode))
        .toBe('.a {\n  /* c */\n  b: 1;\n  /* c */\n  b: 2;\n}\n');
    }
  });

  it('a body inside a `$apply`\'d rule keeps its repeated declarations visible', () => {
    expect(jess('.x { a: 1; }\n.m { $apply .x; }\n.y { $apply .m; a: 1; }', 'native'))
      .toBe('.x {\n  a: 1;\n}\n.m {\n  a: 1;\n}\n.y {\n  a: 1;\n  a: 1;\n}\n');
    expect(jess('$d: @{ a: 1; };\n.m { $d(); }\n.y { $apply .m; a: 1; }', 'native'))
      .toBe('.m {\n  a: 1;\n}\n.y {\n  a: 1;\n  a: 1;\n}\n');
  });

  it('nested output: a `$apply`\'d body and a mixin-call alias join their caller\'s leaf run', () => {
    expect(jess('.x { b: 2; }\n.y { a: 1; $apply .x; .z { c: d; } }', false))
      .toBe('.x {\n  b: 2;\n}\n.y {\n  a: 1;\n  b: 2;\n  .z {\n    c: d;\n  }\n}\n');
    expect(less('.m() { b+: 2; }\n@alias: .m();\n.a { b+: 1; @alias(); }', false)).toBe('.a {\n  b: 1, 2;\n}\n');
  });

  it('a `@while` body in a rule composes its rules under that rule', () => {
    expect(scss('.a { $i: 0; @while $i < 1 { .b { c: d; } $i: $i + 1; } }', 'native')).toBe('.a .b {\n  c: d;\n}\n');
  });

  it('a document-level `@while` body places its declarations at the root, where they are an error', () => {
    expect(() => scss('$i: 0;\n@while $i < 1 { color: red; $i: $i + 1; }', 'native'))
      .toThrow(expect.objectContaining({ code: 'eval/property-in-root' }));
  });

  it('a mixin body under a bubbled two-branch context composes its `&`-less rules against that context as one unit', () => {
    expect(less('.a, .b { @media print { .m(); } }\n.m() { .c { d: e; } }', 'native'))
      .toBe('@media print {\n  :is(.a, .b) .c {\n    d: e;\n  }\n}\n');
  });

  it('a `$apply` in a bubbled at-rule writes its declarations in the context block and composes its rules under it', () => {
    const css = jess('.x { a: 1; .z { b: 2; } }\n.y { @media print { $apply .x; } }', 'native');
    expect(css).toContain('@media print {\n  .y {\n    a: 1;\n  }\n');
    expect(css).toMatch(/\n\s*\.y \.z \{\n/u);
  });

  it('a mixin iterated by `each()` contributes no rule of its own to the output', () => {
    for (const mode of ['native', false] as const) {
      expect(less('.m() { .x { b: 2; } }\n.y { each(.m(), { r-@{key}: @value; }); z: 1; }', mode)).toBe('.y {\n  z: 1;\n}\n');
    }
  });

  it('nested output: a rule whose `&` builds a name keeps its mixin call\'s `!important`', () => {
    expect(less('.m() { &__e { c: d; } }\n.b { .m() !important; }', false)).toBe('.b__e {\n  c: d !important;\n}\n');
  });

  it('an `$if` branch in a rule replays that rule\'s comments where they stand in the branch', () => {
    for (const mode of ['native', false] as const) {
      expect(jess('.a { /* x */ $if (true) { /* c */ b: c; } /* y */ d: e; }', mode))
        .toBe('.a {\n  /* x */\n  /* c */\n  b: c;\n  /* y */\n  d: e;\n}\n');
    }
  });

  it('nested output: a self-collapsing `&&` rule written in place of its parent keeps the parent\'s comments', () => {
    expect(less('.a { /* k */ && { c: d; } }\n.x:extend(.a all) {}', false)).toContain('/* k */');
  });

  it('a ruleset-mixin shell\'s body nests under the shell, so its `&` builds a name from it', () => {
    for (const mode of ['native', false] as const) {
      expect(less('#foo-foo { &-k { c: c; } }\nmi-test-c { &-1 { #foo-foo(); } }', mode))
        .toBe('#foo-foo-k {\n  c: c;\n}\nmi-test-c-1-k {\n  c: c;\n}\n');
    }
  });

  it('nested output: a ruleset-mixin shell placed by a mixin called with `!important` keeps it', () => {
    const src = '#foo-foo { > .bar { .baz { c: c; } } }\n.m() { mi-test-c { &-1 { #foo-foo(); } } }\n.y { .m() !important; }';
    for (const mode of ['native', false] as const) {
      expect(less(src, mode)).toContain('c: c !important;');
    }
  });
});
