import { run } from 'parseman';
import { makeLessRegistry } from '@jesscss/fns';
import { valueLayoutOf } from '@jesscss/core/ast';
import type { Stylesheet } from '@jesscss/core/ast';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize as serializeMaybeAsync, type SerializeResult } from '../../../../core/src/ast/serialize.js';
import { scssGrammar } from '../src/grammar.js';
import { parseScssCst } from '../src/cst.js';
import { parse } from '../src/index.js';
import { bare } from '../../../../../test/provenance-free.js';

/*
 * `serialize` lifts to `Promise<SerializeResult>` only when an async built-in
 * forces a leaf onto the async branch — never for these all-sync SCSS fixtures.
 * Asserting that here is what lets every case below read `.css` directly, and it
 * fails loudly rather than silently comparing against a pending Promise.
 */
function serialize(...args: Parameters<typeof serializeMaybeAsync>): SerializeResult {
  const result = serializeMaybeAsync(...args);
  if (result instanceof Promise) {
    throw new TypeError('This SCSS test expects a synchronous serialize result.');
  }
  return result;
}

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Stylesheet'
    && Array.isArray(value.rules);
}

function stylesheet(value: unknown): Stylesheet {
  if (!isStylesheet(value)) {
    throw new TypeError('Expected the SCSS grammar to produce a Stylesheet');
  }
  return value;
}

function expectExplicitListSeparators(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectExplicitListSeparators);
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.type === 'List') {
    expect(value.sep).toSatisfy(separator => separator === ',' || separator === '/');
  }
  Object.values(value).forEach(expectExplicitListSeparators);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const evaluator = buildEvaluator(makeLessRegistry());

describe('SCSS canonical-AST grammar', () => {
  it('keeps ordinary adjacency as a raw value array and reserves List for explicit separators', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '$space: red blue; $comma: red, blue; $slash: 1 / 2;',
      { trivia: scssGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'space', value: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }] },
        { type: 'VariableDeclaration', name: 'comma', value: { type: 'List', sep: ',' } },
        { type: 'VariableDeclaration', name: 'slash', value: { type: 'List', sep: '/' } }
      ]
    });
    expectExplicitListSeparators(result.value);
  });

  it('retains @supports general-enclosed bodies as structural interpolation templates', () => {
    const source = '@supports selector(.card-#{$tone}:has([data-x="#{$state}"])) { .card { color: blue; } }';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector', content: {
            type: 'Interpolation', parts: [
              { lit: '.card-' }, { ref: { type: 'VariableReference', name: 'tone' }, unquote: true },
              { lit: ':has([data-x="' }, { ref: { type: 'VariableReference', name: 'state' }, unquote: true }, { lit: '"])' }
            ]
          }
        }
      }]
    });
  });

  it('rejects malformed @supports general-enclosed delimiters without raw fallback', () => {
    for (const source of [
      '@supports selector(#{}) { .card { color: blue; } }'
    ]) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs the restricted static @if chain as canonical If/GuardNode facts', () => {
    const source = '@if not (false or false) and true { /* keep */ .yes { color: green; } @media screen { .inside { color: lime; } } } @else if false { .no { color: red; } } @else { .fallback { color: blue; } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'If',
        branches: [
          { guard: { g: 'and', left: { g: 'not', inner: { g: 'or', left: { g: 'truth', value: { src: 'false' } }, right: { g: 'truth', value: { src: 'false' } } } }, right: { g: 'truth', value: { src: 'true' } } }, rules: [
            { type: 'Comment' }, { type: 'Ruleset' }, { type: 'AtRuleBlock', name: '@media' }
          ] },
          { guard: { g: 'truth', value: { src: 'false' } }, rules: [{ type: 'Ruleset' }] },
          { guard: null, rules: [{ type: 'Ruleset' }] }
        ]
      }]
    });
  });

  it('renders only the selected static SCSS @if branch through the canonical serializer', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '@if false { .no { color: red; } } @else if not false { .yes { color: green; } } @else { .fallback { color: blue; } }',
      { trivia: scssGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(serialize(stylesheet(result.value))).toEqual({ css: '.yes {\n  color: green;\n}\n' });
  });

  it('constructs and evaluates static SCSS comparison conditions through existing guard facts', () => {
    const source = '@if 1 == 2 { .wrong { color: red; } } @else if 2 != 3 and 4 >= 4 { .right { color: green; } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'If', branches: [
          { guard: { g: 'cmp', op: '=', left: { type: 'Dimension', number: 1 }, right: { type: 'Dimension', number: 2 } } },
          { guard: { g: 'and', left: { g: 'not', inner: { g: 'cmp', op: '=' } }, right: { g: 'cmp', op: '>=' } } }
        ]
      }]
    });
    expect(serialize(stylesheet(result.value), { evaluator })).toEqual({ css: '.right {\n  color: green;\n}\n' });
  });

  it('covers every direct SCSS comparison spelling without consuming arithmetic or boolean boundaries', () => {
    for (const [condition, expected] of [
      ['3 > 2', 'yes'],
      ['2 < 3', 'yes'],
      ['3 <= 2', 'no'],
      ['(1 + 2) * 3 == 9 and not (2 > 3)', 'yes']
    ] as const) {
      const result = run(scssGrammar.Stylesheet, `@if ${condition} { .yes { color: green; } } @else { .no { color: red; } }`, { trivia: scssGrammar.whitespace });
      expect(result.ok, condition).toBe(true);
      expect(result.unconsumedFrom, condition).toBeNull();
      expect(isStylesheet(result.value), condition).toBe(true);
      expect(serialize(stylesheet(result.value), { evaluator }).css, condition).toContain(`.${expected} {`);
    }
  });

  it('uses existing statement facts in a selected SCSS @if body', () => {
    const source = '@if true { $accent: blue; @mixin paint { color: $accent; } .host { @include paint; } @each $tone in red { .each { color: $tone; } } @for $i from 1 through 1 { .step { width: $i; } } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'If', branches: [{ rules: [
        { type: 'VariableDeclaration', name: 'accent' },
        { type: 'MixinDefinition', name: 'paint' },
        { type: 'Ruleset', rules: [{ type: 'MixinCall', name: 'paint' }] },
        { type: 'For', binding: { kind: 'single', name: 'tone' } },
        { type: 'For', binding: { kind: 'single', name: 'i' } }
      ] }] }]
    });
    expect(serialize(stylesheet(result.value), { evaluator })).toEqual({
      css: '.host {\n  color: blue;\n}\n.each {\n  color: red;\n}\n.step {\n  width: 1;\n}\n'
    });
  });

  it('does not publish or execute existing statement facts from a false SCSS @if body', () => {
    const source = '@if false { $accent: blue; @mixin paint { color: $accent; } .host { @include paint; } @each $tone in red { .each { color: $tone; } } @for $i from 1 through 1 { .step { width: $i; } } }';
    expect(serialize(parse(source), { evaluator })).toEqual({ css: '' });
  });

  it('recurses through the same restricted @if body grammar', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '@if true { @if false { .no { color: red; } } @else { .nested { color: green; } } }',
      { trivia: scssGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toMatchObject({ rules: [{ type: 'If', branches: [{ rules: [{ type: 'If' }] }] }] });
    expect(serialize(stylesheet(result.value))).toEqual({ css: '.nested {\n  color: green;\n}\n' });
  });

  it('constructs restricted @if blocks nested in direct static media bodies', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '@media screen { @if false { .no { color: red; } } @else { .inside { color: green; } } }',
      { trivia: scssGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media', rules: [{ type: 'If', branches: [{ guard: { g: 'truth', value: { src: 'false' } } }, { guard: null }] }] }]
    });
    expect(serialize(stylesheet(result.value))).toEqual({ css: '@media screen {\n  .inside {\n    color: green;\n  }\n}\n' });
  });

  it('rejects unmodelled @if conditions and body forms instead of borrowing eval or legacy parsing', () => {
    for (const source of [
      '@if $enabled { .a { color: green; } }',
      '@if feature() { .a { color: green; } }'
    ]) {
      let accepted = false;
      try {
        const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
        accepted = result.ok && result.unconsumedFrom === null && isStylesheet(result.value);
      } catch {
        accepted = false;
      }
      expect(accepted, source).toBe(false);
    }
  });

  it('places existing static CSS import facts in ordinary executable SCSS bodies', () => {
    const source = `
      @if true { @import "if.css"; }
      @mixin imported { @import "mixin.css"; }
      @each $name in one { @import "each.css"; }
      @for $index from 1 through 1 { @import "for.css"; }
      @media screen { @import "media.css"; }
      @supports (display: grid) { @import "supports.css"; }
      @layer utilities { @import "layer.css"; }
      @scope (.scope) { @import "scope.css"; }
      .card {
        @import url("rule.css");
        @media screen { @import "nested-media.css"; }
        @supports (display: grid) { @import "nested-supports.css"; }
        @layer utilities { @import "nested-layer.css"; }
        @scope (.inner) { @import "nested-scope.css"; }
      }
      .from-mixin { @include imported; }
    `;
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'If', branches: [{ rules: [{ type: 'ImportAtRule', target: { value: 'if.css' } }] }] },
        { type: 'MixinDefinition', rules: [{ type: 'ImportAtRule', target: { value: 'mixin.css' } }] },
        { type: 'For', rules: [{ type: 'ImportAtRule', target: { value: 'each.css' } }] },
        { type: 'For', rules: [{ type: 'ImportAtRule', target: { value: 'for.css' } }] },
        { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'ImportAtRule', target: { value: 'media.css' } }] },
        { type: 'AtRuleBlock', name: '@supports', rules: [{ type: 'ImportAtRule', target: { value: 'supports.css' } }] },
        { type: 'AtRuleBlock', name: '@layer', rules: [{ type: 'ImportAtRule', target: { value: 'layer.css' } }] },
        { type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'ImportAtRule', target: { value: 'scope.css' } }] },
        { type: 'Ruleset', rules: [
          { type: 'ImportAtRule', target: { type: 'Url', value: { value: 'rule.css' } } },
          { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'ImportAtRule', target: { value: 'nested-media.css' } }] },
          { type: 'AtRuleBlock', name: '@supports', rules: [{ type: 'ImportAtRule', target: { value: 'nested-supports.css' } }] },
          { type: 'AtRuleBlock', name: '@layer', rules: [{ type: 'ImportAtRule', target: { value: 'nested-layer.css' } }] },
          { type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'ImportAtRule', target: { value: 'nested-scope.css' } }] }
        ] },
        { type: 'Ruleset', rules: [{ type: 'MixinCall', name: 'imported' }] }
      ]
    });
    expect(serialize(stylesheet(result.value), { evaluator }).css).toContain('@import "if.css";');
    expect(serialize(stylesheet(result.value), { evaluator }).css).toContain('@import url("rule.css");');
  });

  it('constructs a static SCSS import as canonical ImportAtRule', () => {
    const source = '@import "theme.css";';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({ type: 'Stylesheet', rules: [{ type: 'ImportAtRule', name: '@import', options: null, target: { type: 'Quoted', src: '"theme.css"', value: 'theme.css', quote: '"', escaped: false }, alias: null, tail: null }] });
  });

  it('constructs static SCSS url imports as typed ImportAtRule targets', () => {
    for (const source of ['@import url("theme.css");', '@import url(theme.css);']) {
      const cst = parseScssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'ImportAtRule', target: { type: 'Url' } }] });
    }
  });

  it('constructs the public-CST-valid empty SCSS url import target without a fallback', () => {
    const source = '@import url();';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'ImportAtRule', name: '@import', options: null,
        target: { type: 'Url', value: { type: 'Any', src: '' } },
        alias: null, tail: null
      }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe('@import url();\n');
  });

  it('rejects Less-style import options in SCSS imports', () => {
    const source = '@import (css, once) "theme.css";';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors.length > 0 || cst.unconsumedFrom !== null).toBe(true);
    expect(result.ok && result.unconsumedFrom === null).toBe(false);
  });

  it('constructs typed static CSS-import supports tails without raw authored text', () => {
    const source = '@import "theme.css" layer(tokens) supports((display: grid)) screen;';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'ImportAtRule',
        tail: {
          type: 'SpacedValue', parts: [
            { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'tokens' }] },
            { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] },
            { type: 'Keyword', src: 'screen' }
          ]
        }
      }]
    });

    const simple = run(scssGrammar.Stylesheet, '@import "theme.css" supports(display: grid);', { trivia: scssGrammar.whitespace });
    expect(simple.ok).toBe(true);
    expect(simple.unconsumedFrom).toBeNull();
    expect(simple.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'ImportAtRule', tail: { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] } }]
    });

    for (const unsupported of [
      '@import "theme.css" supports(#{$feature});'
    ]) {
      const unsupportedResult = run(scssGrammar.Stylesheet, unsupported, { trivia: scssGrammar.whitespace });
      expect(unsupportedResult.ok && unsupportedResult.unconsumedFrom === null && isStylesheet(unsupportedResult.value), unsupported).toBe(false);
    }
  });

  it('constructs typed static CSS-import media-query tails and composes them after layer/supports', () => {
    const source = '@import "theme.css" layer(tokens) supports((display: grid)) only screen and (min-width: 1px), (color), not (color: red);';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'ImportAtRule',
        tail: {
          type: 'SpacedValue', parts: [
            { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'tokens' }] },
            { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] },
            {
              type: 'List', sep: ',', value: [
                { type: 'SpacedValue', parts: [{ src: 'only' }, { src: 'screen' }, { src: 'and' }, { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] },
                { type: 'Block', delimiter: 'paren', value: { type: 'Keyword', src: 'color' } },
                { type: 'SpacedValue', parts: [{ src: 'not' }, { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }] }
              ]
            }
          ]
        }
      }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '@import "theme.css" layer(tokens) supports((display : grid)) only screen and (min-width: 1px), (color), not (color: red);\n'
    );

    for (const source of [
      '@import "theme.css" only screen;',
      '@import "theme.css" screen and (min-width: 1px);',
      '@import "theme.css" (color);',
      '@import "theme.css" not (color: red);',
      '@import "theme.css" (color) or (monochrome);'
    ]) {
      const direct = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(true);
    }

    /*
     * Three entries left this list when the `ImportMedia*` copy was deleted and
     * the import tail started using the shared `QueryPrelude`. They were pinning
     * the copy's narrowness, not a Sass fact:
     *
     *  - `screen and foo(bar)` is `<general-enclosed>` (media-queries-4 §3.4)
     *    and dart-sass accepts the same shape — sass-spec
     *    `css/plain/import/conditions.hrx :: multiple/unknown_ident_then/
     *    unknown_function` is `@import "a" b c(d)`, a non-error section.
     *  - `screen or (color)` and `only screen or (color)` are genuinely invalid
     *    per media-queries-4 §2.1 (`<media-type> [and <media-condition-without-
     *    or>]?`), but `QueryClause` has always accepted them, so `@media screen
     *    or (color)` parses in this grammar today. Sharing the production makes
     *    `@import` consistent with `@media` rather than newly wrong; tightening
     *    both is a separate, cross-dialect change (see the note on ImportTail).
     */
    for (const source of [
      '@import "theme.css" #{$media};',
      '@import "theme.css" screen /* no raw/comment tail */ and (color);',
      '@import "theme.css" screen, #{$media};',
      '@import "a.css", "b.css" screen;'
    ]) {
      const direct = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
  });

  it('constructs interpolated SCSS import targets as parser-owned facts without classifying them', () => {
    for (const source of ['@import "theme-#{$mode}.css";', '@import url("theme-#{$mode}.css");']) {
      const cst = parseScssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(result.value).toMatchObject({
        type: 'Stylesheet',
        rules: [{ type: 'ImportAtRule', target: source.includes('url(')
          ? { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: '"theme-' }, { ref: { type: 'VariableReference', name: 'mode' }, unquote: true }, { lit: '.css"' }] } }
          : { type: 'Interpolation', parts: [{ lit: '"theme-' }, { ref: { type: 'VariableReference', name: 'mode' }, unquote: true }, { lit: '.css"' }] }
        }]
      });
    }
  });

  it('rejects malformed interpolated SCSS import targets structurally', () => {
    for (const source of ['@import "theme-#{$mode.css";', '@import url("theme-#{$mode.css");', '@import "theme-#{}";', '@import "theme.css"', '@import url(foo bar);', '@import url();, "other.css";']) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('classifies static SCSS @use paths and lowers bare @forward to existing import facts', () => {
    const source = '@use "sass:math" as math; @use "./tokens.ts" as tokens; @use "./theme.scss" as theme; @use "./global.scss" as *; @forward "./public.scss";';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'ModuleImport', mode: 'use', path: { type: 'Quoted', value: '#sass/math' }, namespace: 'math', defaultImport: null, imports: [] },
        { type: 'ModuleImport', mode: 'use', path: { type: 'Quoted', value: './tokens.ts' }, namespace: 'tokens', defaultImport: null, imports: [] },
        { type: 'StyleImport', mode: 'compose', path: { type: 'Quoted', value: './theme.scss' }, namespace: 'theme', forward: false },
        { type: 'StyleImport', mode: 'compose', path: { type: 'Quoted', value: './global.scss' }, namespace: '*', forward: false },
        { type: 'StyleImport', mode: 'compose', path: { type: 'Quoted', value: './public.scss' }, namespace: null, forward: true }
      ]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '@-use "#sass/math" as math;\n@-use "./tokens.ts" as tokens;\n@-compose "./theme.scss" as theme;\n@-compose "./global.scss" as *;\n@-export "./public.scss";\n'
    );
  });

  /*
   * `"./theme\.scss"` USED to be in this list. It is not unrepresentable — an
   * escape is part of every `QuotedString` (sass `spec/at-rules/use.md` takes
   * the same terminal as `@import`; CSS Syntax 3 §4.3.1 makes `\` an escape
   * inside a `<string-token>`). It only failed because `@use`/`@forward` ran
   * through a private escape-free copy of the quoted production. There is one
   * `Quoted` rule now and it is accepted, pinned in `discovered-constructs`.
   * What remains here is genuinely unrepresentable: a DYNAMIC path, and the
   * clauses this grammar has no model for.
   */
  it('rejects unrepresentable SCSS @use and @forward forms without classifying or resolving them', () => {
    for (const source of [
      '@use "theme-#{$name}.scss";',
      '@use "./theme.scss" with ($tone: red);',
      '@forward "./theme.scss" as theme-*;',
      '@forward "./theme.scss" show $tone;',
      '@forward "./theme.scss" with ($tone: red);'
    ]) {
      let accepted = false;
      try {
        const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
        accepted = result.ok && result.unconsumedFrom === null && isStylesheet(result.value);
      } catch {
        accepted = false;
      }
      expect(accepted, source).toBe(false);
    }
  });

  it('routes SCSS @at-root to its filter or ordinary block continuation', () => {
    const source = '@at-root { .top { color: red; } } @at-root (with: .scope) { .filtered { color: blue; } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'AtRuleBlock', name: '@at-root', prelude: null },
        { type: 'AtRuleBlock', name: '@at-root', prelude: { type: 'Any', src: '(with: .scope)' } }
      ]
    });
  });

  it('uses ambient quoted-span skipping for opaque query arguments and structural @at-root filters', () => {
    const queryFunction = run(
      scssGrammar.QueryFunction,
      'selector([data-state=")"])',
      { trivia: scssGrammar.whitespace }
    );
    expect(queryFunction.ok).toBe(true);
    expect(queryFunction.unconsumedFrom).toBeNull();
    expect(queryFunction.value).toMatchObject({
      type: 'FunctionCall', name: 'selector', args: [{ type: 'Any', src: '[data-state=")"]' }]
    });

    for (const [rule, source, expected] of [
      [scssGrammar.AtRootFilterPrelude, '(with: ".scope {") {', '(with: ".scope {")']
    ] as const) {
      const result = run(rule, source, { trivia: scssGrammar.whitespace });
      expect(result.ok, source).toBe(true);
      expect(result.value, source).toMatchObject({ type: 'Any', src: expected });
    }

    for (const source of [
      '@at-root .scope { .item { color: red; } }',
      '@at-root "{" { .item { color: red; } }'
    ]) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs canonical SCSS variable declarations and references directly', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '$base: blue; $theme: $base; $font: "Inter"; $escaped: r\\65d; $quoted: "a\\\\b"; $hash: "#foo"; $singleHash: \'#foo\'; $shadow: 0 1px #000,\n    0 2px #fff; $asset: url("font.woff2"); $gradient: linear-gradient(#000, rgb(1, 2, 3)); .card { color: #00f; margin: 1.5rem; opacity: .5; background: url(images/a#icon.svg); }',
      { trivia: scssGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'base', value: { type: 'Keyword', src: 'blue' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'theme', value: { type: 'VariableReference', name: 'base', lookup: 'live' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'font', value: { type: 'Quoted', src: '"Inter"', value: 'Inter', quote: '"', escaped: false }, write: { mode: 'declare' } },

        /*
         * Value keywords deliberately preserve CSS escapes. `$` names above use
         * the SCSS-local unescaped terminal instead.
         */
        { type: 'VariableDeclaration', name: 'escaped', value: { type: 'Keyword', src: 'r\\65d' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'quoted', value: { type: 'Quoted', src: '"a\\\\b"', value: 'a\\\\b', quote: '"', escaped: false }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'hash', value: { type: 'Quoted', src: '"#foo"', value: '#foo', quote: '"', escaped: false }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'singleHash', value: { type: 'Quoted', src: '\'#foo\'', value: '#foo', quote: '\'', escaped: false }, write: { mode: 'declare' } },
        {
          type: 'VariableDeclaration', name: 'shadow', value: {
            type: 'List', sep: ',', value: [
              [{ type: 'Dimension', number: 0, unit: '', src: '0' }, { type: 'Dimension', number: 1, unit: 'px', src: '1px' }, { type: 'Color', src: '#000' }],
              [{ type: 'Dimension', number: 0, unit: '', src: '0' }, { type: 'Dimension', number: 2, unit: 'px', src: '2px' }, { type: 'Color', src: '#fff' }]
            ]
          },
          write: { mode: 'declare' }
        },
        { type: 'VariableDeclaration', name: 'asset', value: { type: 'Url', value: { type: 'Quoted', src: '"font.woff2"', value: 'font.woff2', quote: '"', escaped: false } }, write: { mode: 'declare' } },
        {
          type: 'VariableDeclaration', name: 'gradient', value: {
            type: 'FunctionCall', name: 'linear-gradient', modern: false, args: [
              { type: 'Color', src: '#000' },
              { type: 'FunctionCall', name: 'rgb', modern: false, args: [
                { type: 'Dimension', number: 1, unit: '', src: '1' },
                { type: 'Dimension', number: 2, unit: '', src: '2' },
                { type: 'Dimension', number: 3, unit: '', src: '3' }
              ] }
            ]
          },
          write: { mode: 'declare' }
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [{ type: 'SimpleSelector', text: '.card', interp: null }]
          },
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'Color', src: '#00f' }, merge: null, important: false },
            { type: 'Declaration', name: 'margin', value: { type: 'Dimension', number: 1.5, unit: 'rem', src: '1.5rem' }, merge: null, important: false },
            { type: 'Declaration', name: 'opacity', value: { type: 'Dimension', number: 0.5, unit: '', src: '.5' }, merge: null, important: false },
            { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'images/a#icon.svg' } }, merge: null, important: false }
          ]
        }
      ]
    });
  });

  it('lowers local SCSS variable operations to the shared lookup/write facts', () => {
    const source = '$base: blue; $fallback: red !default; $global: green !global; .card { color: $base; }';
    const direct = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'base', write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'fallback', write: { mode: 'if-absent', lookup: 'scoped' } },
        { type: 'VariableDeclaration', name: 'global', write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Ruleset', rules: [{ type: 'Declaration', value: { type: 'VariableReference', name: 'base', lookup: 'live' } }] }
      ]
    });
    expect(parse(source)).toMatchObject({
      rules: [
        { write: { mode: 'declare' } },
        { write: { mode: 'if-absent', lookup: 'scoped' } },
        { write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Ruleset' }
      ]
    });

    for (const unsupported of ['$!base: blue;', 'theme.$base: blue;']) {
      expect(() => parse(unsupported), unsupported).toThrow(SyntaxError);
    }
  });

  it('constructs static custom-property tokens only as typed SCSS value leaves', () => {
    const source = '.card { direct: --theme; via-var: var(--theme, --fallback); via-env: env(--safe-area); via-calc: calc(--size + 1px); } @media (width: --viewport) { .media { color: red; } } @supports (display: --mode) { .support { color: blue; } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [
        { type: 'Ruleset', rules: [
          { type: 'Declaration', name: 'direct', value: { type: 'Keyword', src: '--theme' } },
          { type: 'Declaration', name: 'via-var', value: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--theme' }, { type: 'Keyword', src: '--fallback' }] } },
          { type: 'Declaration', name: 'via-env', value: { type: 'FunctionCall', name: 'env', args: [{ type: 'Keyword', src: '--safe-area' }] } },
          { type: 'Declaration', name: 'via-calc', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '+', left: { src: '--size' } }] } }
        ] },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', right: { type: 'Keyword', src: '--viewport' } } } },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', right: { type: 'Keyword', src: '--mode' } } } }
      ]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card {\n  direct: --theme;\n  via-var: var(--theme, --fallback);\n  via-env: env(--safe-area);\n  via-calc: calc(--size + 1px);\n}\n@media (width: --viewport) {\n  .media {\n    color: red;\n  }\n}\n@supports (display: --mode) {\n  .support {\n    color: blue;\n  }\n}\n'
    );

    for (const malformed of [
      '.card { value: --; }',
      '.card { value: --#{$name}; }',
      '.card { value: --theme#{$name}; }',
      '.card { value: -- theme; }',
      '@media (width: --#{$value}) { .bad { color: red; } }'
    ]) {
      const direct = run(scssGrammar.Stylesheet, malformed, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), malformed).toBe(false);
    }
  });

  it('keeps the closed direct-fact grammar narrow', () => {
    for (const source of [
      '$ba\\se: blue;', '$base: $ba\\se;',
      '.card { color: #fffff; }', '.card { color: #1234567; }'
    ]) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs SCSS arithmetic precedence before assembling spaced and comma values', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '$base: 1 + 2 * 3; $nested: (1 + 2) * 3; $signed: -$base * 2; $spaced-signed: - $base * 2; $spaced-positive: + ($base); $minus-list: 1 -2; $legacy-plus: 1 +2; .card { compact: 17px-1px; sequence: 1 2 + 3; mixed: 1 + 2 red; ratio: 1 / 2; grouped-ratio: (1 / 2); calc-ratio: calc(1 / 2); mod: 7 % 3; }',
      { trivia: scssGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'base', value: {
          type: 'Operation', operator: '+', left: { src: '1' }, right: {
            type: 'Operation', operator: '*', left: { src: '2' }, right: { src: '3' }
          }
        } },
        { type: 'VariableDeclaration', name: 'nested', value: {
          type: 'Operation', operator: '*', left: {
            type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '+' }
          }, right: { src: '3' }
        } },
        { type: 'VariableDeclaration', name: 'signed', value: {
          type: 'Operation', operator: '*', left: {
            type: 'Operation', operator: '*', left: { src: '-1' }, right: { type: 'VariableReference', name: 'base' }
          }, right: { src: '2' }
        } },
        { type: 'VariableDeclaration', name: 'spaced-signed', value: {
          type: 'Operation', operator: '*', left: {
            type: 'Operation', operator: '*', left: { src: '-1' }, right: { type: 'VariableReference', name: 'base' }
          }, right: { src: '2' }
        } },
        { type: 'VariableDeclaration', name: 'spaced-positive', value: {
          type: 'Block', delimiter: 'paren', value: { type: 'VariableReference', name: 'base' }
        } },
        { type: 'VariableDeclaration', name: 'minus-list', value: [{ src: '1' }, { src: '-2' }] },
        { type: 'VariableDeclaration', name: 'legacy-plus', value: { type: 'Operation', operator: '+' } },
        { type: 'Ruleset', rules: [
          { name: 'compact', value: { type: 'Operation', operator: '-' } },
          { name: 'sequence', value: [{ src: '1' }, { type: 'Operation', operator: '+' }] },
          { name: 'mixed', value: [{ type: 'Operation', operator: '+' }, { src: 'red' }] },
          { name: 'ratio', value: { type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }] } },
          { name: 'grouped-ratio', value: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '/' } } },
          { name: 'calc-ratio', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }] }] } },
          { name: 'mod', value: { type: 'Operation', operator: '%' } }
        ] }
      ]
    });
  });

  it('accepts the public optional final declaration semicolon', () => {
    for (const [source, expected] of [
      ['.card { color: blue }', { type: 'Ruleset' }]
    ] as const) {
      const cst = parseScssCst(source);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [expected] });
    }
  });

  it('rejects Less declaration merge modifiers on the direct SCSS routes', () => {
    for (const source of [
      '.card { font+: sans-serif; }',
      '.card { font+_: serif !important; }'
    ]) {
      const cst = parseScssCst(source);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      expect(result.ok && result.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('lowers static SCSS nested properties to ordered existing declarations', () => {
    const source = '.card { font: { family: fantasy; weight: bold; } font: 20px { size: 1rem; } }';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'family' }, value: { src: 'fantasy' } },
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'weight' }, value: { src: 'bold' }, important: false }
        ] } },
        { type: 'Declaration', name: 'font', value: { type: 'Collection', base: { src: '20px' }, entries: [
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'size' }, value: { src: '1rem' } }
        ] } }
      ] }]
    });
    expect(serialize(stylesheet(result.value))).toEqual({
      css: '.card {\n  font-family: fantasy;\n  font-weight: bold;\n  font: 20px;\n  font-size: 1rem;\n}\n'
    });

    for (const unsupported of [
      '.card { font: { variant: { caps: small-caps; } } }',
      '.card { font: { $weight: bold; } }',
      '.card { font: { @if true { family: fantasy; } } }',
      '.card { font: { @extend .base; } }'
    ]) {
      const direct = run(scssGrammar.Stylesheet, unsupported, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), unsupported).toBe(false);
    }
  });

  it('lowers interpolated SCSS nested-property outer and leaf names directly', () => {
    const source = '$prefix: font; $part: weight; .card { #{$prefix}: { color: red; } font: { #{$part}: bold; } #{$prefix}: { #{$part}: 700; } }';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'VariableDeclaration', name: 'prefix' }, { type: 'VariableDeclaration', name: 'part' }, {
        type: 'Ruleset', rules: [
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'prefix' } }] }, value: { type: 'Collection', entries: [
            { type: 'CollectionEntry', key: { type: 'Keyword', src: 'color' }, value: { src: 'red' } }
          ] } },
          { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [
            { type: 'CollectionEntry', key: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'part' } }] }, value: { src: 'bold' } }
          ] } },
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'prefix' } }] }, value: { type: 'Collection', entries: [
            { type: 'CollectionEntry', key: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'part' } }] }, value: { src: '700' } }
          ] } }
        ]
      }]
    });
    expect(serialize(stylesheet(result.value), { evaluator })).toEqual({
      css: '.card {\n  font-color: red;\n  font-weight: bold;\n  font-weight: 700;\n}\n'
    });
  });

  it('keeps a nested-property own declaration priority after its block', () => {
    const source = '.card { font: 20px { size: 1rem; } !important; }';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: 'font', important: true, value: { type: 'Collection', base: { src: '20px' }, entries: [
          { type: 'CollectionEntry', key: { type: 'Keyword', src: 'size' }, important: false, value: { src: '1rem' } }
        ] } }
      ] }]
    });
    expect(serialize(stylesheet(result.value))).toEqual({
      css: '.card {\n  font: 20px !important;\n  font-size: 1rem;\n}\n'
    });
  });

  it('lowers an empty public-CST nested-property block to no declaration', () => {
    const source = '.empty { font: {}; }';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
      { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [] } }
    ] }] });
    expect(serialize(stylesheet(result.value))).toEqual({ css: '' });
  });

  it('keeps unmodelled nested-property body forms out of the folded grammar', () => {
    const unmodelled = [
      '.card { font: { $weight: bold; } }',
      '.card { font: { theme.$weight: bold; } }',
      '.card { font: { @if true { weight: bold; } } }',
      '.card { font: { @each $weight in bold { weight: $weight; } } }',
      '.card { font: { @for $i from 1 through 1 { weight: $i; } } }',
      '.card { font: { @while false { weight: bold; } } }',
      '.card { font: { /* note */ weight: bold; } }'
    ];
    for (const source of unmodelled) {
      const cst = parseScssCst(source);
      const direct = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }

    for (const source of [
      '.card { font: { variant: { caps: small-caps; } } }',
      '.card { font: { @extend .base; } }'
    ]) {
      const cst = parseScssCst(source);
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
    }
  });

  it('constructs structural interpolation in quoted strings and ordinary values directly', () => {
    const source = '$tone: blue; .card { content: "tone-#{$tone}"; color: shade-#{$tone}-strong; }';
    expect(parseScssCst(source).errors).toHaveLength(0);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'tone' },
        { type: 'Ruleset', rules: [
          { type: 'Declaration', name: 'content', value: { type: 'Interpolation', parts: [{ lit: '"tone-' }, { ref: { type: 'VariableReference', name: 'tone' }, unquote: true }, { lit: '"' }] } },
          { type: 'Declaration', name: 'color', value: { type: 'Interpolation', parts: [{ lit: 'shade-' }, { ref: { type: 'VariableReference', name: 'tone' }, unquote: true }, { lit: '-strong' }] } }
        ] }
      ]
    });
  });

  it('constructs interpolated declaration names as typed Declaration.name facts', () => {
    const source = '.card { #{$property}: blue; margin-#{$side}: 1rem; --theme-#{$mode}: red; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'property' }, unquote: true }] } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'margin-' }, { ref: { type: 'VariableReference', name: 'side' }, unquote: true }] } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: '--theme-' }, { ref: { type: 'VariableReference', name: 'mode' }, unquote: true }] } }
      ] }]
    });
  });

  it('keeps repeated, custom-property, and descriptor interpolation names structural and rejects malformed forms', () => {
    const source = '$property: color; $side: left; $mode: dark; $value: blue; .card { #{$property}: #{$value}; margin-#{$side}-#{$mode}: $value; --theme-#{$mode}: red; } @font-face { font-#{$side}: 1rem; }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [
          { name: { type: 'Interpolation', parts: [{ ref: { name: 'property' } }] }, value: { type: 'Interpolation', parts: [{ ref: { name: 'value' } }] } },
          { name: { type: 'Interpolation', parts: [{ lit: 'margin-' }, { ref: { name: 'side' } }, { lit: '-' }, { ref: { name: 'mode' } }] }, value: { type: 'VariableReference', name: 'value' } },
          { name: { type: 'Interpolation', parts: [{ lit: '--theme-' }, { ref: { name: 'mode' } }] } }
        ] },
        { type: 'AtRuleBlock', name: '@font-face', rules: [{ name: { type: 'Interpolation', parts: [{ lit: 'font-' }, { ref: { name: 'side' } }] } }] }
      ]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card {\n  color: blue;\n  margin-left-dark: blue;\n  --theme-dark: red;\n}\n@font-face {\n  font-left: 1rem;\n}\n'
    );
    for (const malformed of ['.card { #{}: red; }', '.card { margin-#{}: red; }', '.card { --theme-#{}: red; }']) {
      const rejected = run(scssGrammar.Stylesheet, malformed, { trivia: scssGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, malformed).toBe(false);
    }
  });

  it('constructs nested SCSS rules and scoped variables directly', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '.card { $accent: #00f; color: $accent; .title { color: blue; } }',
      { trivia: scssGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: {
          type: 'SelectorList',
          selectors: [{ type: 'SimpleSelector', text: '.card', interp: null }]
        },
        rules: [
          { type: 'VariableDeclaration', name: 'accent', value: { type: 'Color', src: '#00f' }, write: { mode: 'declare' } },
          { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'accent', lookup: 'live' }, merge: null, important: false },
          {
            type: 'Ruleset',
            selector: {
              type: 'SelectorList',
              selectors: [{ type: 'SimpleSelector', text: '.title', interp: null }]
            },
            rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' }, merge: null, important: false }]
          }
        ]
      }]
    });
  });

  it('preserves block comments as direct AST statements and drops `//` line comments as trivia', () => {
    const source = '// root\n$theme: blue; /* between */ .card { // inside\n color: $theme; /* tail */ }';
    expect(parseScssCst(source).errors).toHaveLength(0);
    const result = run(
      scssGrammar.Stylesheet,
      source,
      { trivia: scssGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();

    /*
     * A Sass `//` comment is silent and is not valid CSS, so — exactly as in
     * Less — it is lexical trivia and never becomes a renderable `Comment`
     * node. `/* *\/` stays CSS output.
     */
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        expect.objectContaining({ type: 'VariableDeclaration', name: 'theme' }),
        { type: 'Comment', text: '/* between */' },
        expect.objectContaining({
          type: 'Ruleset',
          rules: [
            expect.objectContaining({ type: 'Declaration', name: 'color' }),
            { type: 'Comment', text: '/* tail */' }
          ]
        })
      ]
    });
  });

  it('keeps `//` out of the AST wherever it may appear, matching the Less parser', () => {
    for (const source of [
      '// only a comment\n',
      '.a { color: red; } // trailing\n',
      '.a {\n  // leading\n  color: red;\n}\n',
      '.a {\n  color: red; // after a declaration\n}\n',
      '$x: 1; // after a variable\n',
      '@media screen {\n  // inside an at-rule\n  .a { color: red; }\n}\n',
      '@mixin m {\n  // inside a mixin\n  color: red;\n}\n.a { @include m; }\n',
      '@each $i in 1, 2 {\n  // inside a loop\n  .a-#{$i} { color: red; }\n}\n'
    ]) {
      expect(JSON.stringify(parse(source)), source).not.toContain('//');
    }
  });

  it('renders `/* */` but never renders a `//` line comment', () => {
    const source = '// dropped\n.card {\n  // dropped\n  color: red; // dropped\n}\n/* kept */\n';
    expect(serialize(parse(source)).css).toBe('.card {\n  color: red;\n}\n/* kept */\n');

    /*
     * A rule whose only content was a `//` comment is empty once the comment is
     * trivia, so it renders nothing at all — as Sass does.
     */
    expect(serialize(parse('a {b: c}\nd {\n  @extend a //\n}\n')).css).toBe('a,\nd {\n  b: c;\n}\n');
    expect(serialize(parse('.a {\n  // only a comment\n}\n')).css).toBe('');
  });

  it('does not let `//` trivia reach inside strings or url() bodies', () => {
    expect(parse('.a { content: "//not-a-comment"; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Quoted', value: '//not-a-comment' } }] }]
    });

    // A leading space belongs to the string, not to the ambient trivia.
    expect(parse('.a { content: " x"; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Quoted', value: ' x' } }] }]
    });
    expect(() => parse('.a { background: url(//cdn.example.com/x.png); }')).not.toThrow();
    expect(() => parse('.a { background: url("//cdn.example.com/x.png"); }')).not.toThrow();

    /*
     * The three productions whose quoted arms are NOT reached through the
     * already-`noTrivia` value chain, and so needed their own `noTrivia`.
     */
    expect(() => parse('@use "//cdn.example.com/lib";')).not.toThrow();
    expect(() => parse('@forward "//cdn.example.com/lib";')).not.toThrow();
    expect(() => parse('.a[href="//cdn.example.com"] { color: red; }')).not.toThrow();
    expect(() => parse('@supports (content: "//x") { .a { color: red; } }')).not.toThrow();

    // Disabling trivia on those arms must not cost them their literal spacing.
    expect(parse('@use " sp ";')).toMatchObject({ rules: [{ path: { type: 'Quoted', value: ' sp ' } }] });
    expect(parse('.a[href=" sp "] { color: red; }')).toMatchObject({
      rules: [{ selector: { selectors: [{ type: 'CompoundSelector', value: [{ text: '.a' }, { text: '[href=" sp "]' }] }] } }]
    });
  });

  it('constructs public static media, supports, and container blocks directly', () => {
    const source = `
      @media screen and (min-width: 30rem) { // media
        .card { color: blue; }
      }
      @media only screen { .legacy { color: red; } }
      @supports not (display: grid) { .fallback { display: block; } }
      @container sidebar (width > 30rem) { .card { padding: 1rem; } }
      .card { @media (width: 1px) { $accent: red; color: $accent; } }
    `;
    expect(parseScssCst(source).errors).toHaveLength(0);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        // The `// media` line comment is trivia and leaves no node behind.
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' }, rules: [{ type: 'Ruleset' }] },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'only' }, { type: 'Keyword', src: 'screen' }] }, rules: [{ type: 'Ruleset' }] },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'SpacedValue' }, rules: [{ type: 'Ruleset' }] },
        { type: 'AtRuleBlock', name: '@container', prelude: { type: 'SpacedValue' }, rules: [{ type: 'Ruleset' }] },
        { type: 'Ruleset', rules: [{ type: 'AtRuleBlock', name: '@media', rules: [{ type: 'VariableDeclaration' }, { type: 'Declaration' }] }] }
      ]
    });
  });

  it('constructs a media feature <ratio> value instead of a value-position slash list', () => {
    const ratio = {
      type: 'Operation', operator: '/',
      left: { type: 'Dimension', src: '16' },
      right: { type: 'Dimension', src: '9' }
    };

    for (const [source, operator] of [
      ['@media (aspect-ratio: 16/9) { .card { color: red; } }', ':'],

      // Spaced, this used to reduce to SCSS's slash List rather than a ratio.
      ['@media (aspect-ratio: 16 / 9) { .card { color: red; } }', ':'],
      ['@media (min-aspect-ratio: 16/9) { .card { color: red; } }', ':'],
      ['@container (aspect-ratio: 16/9) { .card { color: red; } }', ':'],
      ['@media (aspect-ratio >= 16/9) { .card { color: red; } }', '>=']
    ] as const) {
      expect(parseScssCst(source).errors, source).toHaveLength(0);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      expect(parse(source).rules[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator, right: ratio } }
      });
    }

    expect(serialize(parse('@media (aspect-ratio: 16/9) { .card { color: red; } }'))).toEqual({
      css: '@media (aspect-ratio: 16 / 9) {\n  .card {\n    color: red;\n  }\n}\n'
    });

    /*
     * A single `<number>` is a whole ratio, and a plain feature value keeps its
     * component value: the slash tail is optional, not implied.
     */
    for (const [source, inner] of [
      ['@media (aspect-ratio: 1) { .card { color: red; } }', { type: 'Dimension', src: '1' }],
      ['@media (min-width: $size) { .card { color: red; } }', { type: 'VariableReference', name: 'size' }],
      ['@media (min-width: #{$size}) { .card { color: red; } }', { type: 'Interpolation' }]
    ] as const) {
      expect(parse(source).rules[0], source).toMatchObject({
        prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', right: inner } }
      });
    }

    /*
     * SCSS value position is untouched: a declaration slash is still SCSS's own
     * slash list, not a ratio operation.
     */
    expect(parse('.card { font: 16px / 9; }').rules[0]).toMatchObject({
      rules: [{ type: 'Declaration', name: 'font', value: { type: 'List', sep: '/' } }]
    });
  });

  it('constructs the value-first media-feature range, including a <ratio> bound', () => {
    const width = { type: 'Keyword', src: 'width' };
    const ratio = (numerator: string, denominator: string) => ({
      type: 'Operation', operator: '/',
      left: { type: 'Dimension', src: numerator },
      right: { type: 'Dimension', src: denominator }
    });

    /*
     * media-queries-4 §2.4.3 `<mf-range>`: the value may lead, on one side or
     * both. The outer comparison wraps the inner one, which is the identical
     * shape the css/less/jess grammars build for these same bytes.
     */
    for (const [source, inner] of [
      [
        '@media (100px < width < 200px) { .card { color: red; } }',
        {
          type: 'Operation', operator: '<',
          left: { type: 'Operation', operator: '<', left: { type: 'Dimension', src: '100px' }, right: width },
          right: { type: 'Dimension', src: '200px' }
        }
      ],
      [
        '@media (400px <= width <= 700px) { .card { color: red; } }',
        {
          type: 'Operation', operator: '<=',
          left: { type: 'Operation', operator: '<=', left: { type: 'Dimension', src: '400px' }, right: width },
          right: { type: 'Dimension', src: '700px' }
        }
      ],

      /*
       * Reusing QueryValue is what gives the range form its `<ratio>`
       * bounds, rather than the range restating the ratio grammar.
       */
      [
        '@media (16/9 < aspect-ratio < 2/1) { .card { color: red; } }',
        {
          type: 'Operation', operator: '<',
          left: { type: 'Operation', operator: '<', left: ratio('16', '9'), right: { type: 'Keyword', src: 'aspect-ratio' } },
          right: ratio('2', '1')
        }
      ],

      // One-sided: the trailing comparison is optional, not implied.
      ['@media (100px < width) { .card { color: red; } }', { type: 'Operation', operator: '<', left: { type: 'Dimension', src: '100px' }, right: width }],
      ['@container (100px < width < 200px) { .card { color: red; } }', {
        type: 'Operation', operator: '<',
        left: { type: 'Operation', operator: '<', left: { type: 'Dimension', src: '100px' }, right: width },
        right: { type: 'Dimension', src: '200px' }
      }],

      // A bound may be any SCSS feature value, so a variable reads as one too.
      ['@media ($min < width) { .card { color: red; } }', { type: 'Operation', operator: '<', left: { type: 'VariableReference', name: 'min' }, right: width }]
    ] as const) {
      expect(parseScssCst(source).errors, source).toHaveLength(0);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      expect(parse(source).rules[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren', value: inner }
      });
    }

    expect(serialize(parse('@media (100px < width < 200px) { .card { color: red; } }'))).toEqual({
      css: '@media (100px < width < 200px) {\n  .card {\n    color: red;\n  }\n}\n'
    });

    // The name-first comparison keeps its own operand order.
    expect(parse('@media (width < 200px) { .card { color: red; } }').rules[0]).toMatchObject({
      prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '<', left: width, right: { type: 'Dimension', src: '200px' } } }
    });
  });

  it('rejects query interpolation until the AST has typed prelude segments', () => {
    for (const source of [
      '@media #{$query} { .card { color: red; } }',
      '@container #{$container-query} { .card { color: red; } }'
    ]) {
      const cst = parseScssCst(source);
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);

      const direct = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('accepts `only` only as a media-type modifier', () => {
    expect(parse('@media only screen and (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' } }]
    });
    expect(() => parse('@media only (min-width: 1px) { .card { color: red; } }')).toThrow(SyntaxError);
    expect(parse('@media not (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media' }]
    });
  });

  it('keeps public @supports to typed static conditions, not query-function or dynamic raw payloads', () => {
    const source = '@supports not ((display: grid) and (color)) { .card { color: blue; } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@supports',
        prelude: {
          type: 'SpacedValue',
          parts: [{ type: 'Keyword', src: 'not' }, { type: 'Block', delimiter: 'paren', value: { type: 'SpacedValue' } }]
        }
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@supports not ((display: grid) and (color)) {\n  .card {\n    color: blue;\n  }\n}\n'
    );

    const escapedQuoted = run(
      scssGrammar.Stylesheet,
      '@supports (font-family: "A  \\"B\\"") { .card { color: blue; } }',
      { trivia: scssGrammar.whitespace }
    );
    expect(escapedQuoted.ok).toBe(true);
    expect(escapedQuoted.unconsumedFrom).toBeNull();
    expect(isStylesheet(escapedQuoted.value)).toBe(true);
    if (!isStylesheet(escapedQuoted.value)) {
      throw new TypeError('expected escaped static supports quote to parse');
    }
    expect(serialize(escapedQuoted.value).css).toBe(
      '@supports (font-family: "A  \\"B\\"") {\n  .card {\n    color: blue;\n  }\n}\n'
    );

    for (const querySource of [
      '@media selector(.card) { .card { color: blue; } }',
      '@container style(--theme: dark) { .card { color: blue; } }'
    ]) {
      const query = run(scssGrammar.Stylesheet, querySource, { trivia: scssGrammar.whitespace });
      expect(query.ok && query.unconsumedFrom === null && isStylesheet(query.value), querySource).toBe(true);
    }

    for (const invalid of [
      '@supports (display: grid), (color: blue) { .card { color: blue; } }'
    ]) {
      const rejected = run(scssGrammar.Stylesheet, invalid, { trivia: scssGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && isStylesheet(rejected.value), invalid).toBe(false);
    }
  });

  it('constructs descriptor-only @font-face blocks with existing direct declaration values', () => {
    const source = '@font-face { font-family: $font; src: url("font.woff2"); }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'AtRuleBlock', name: '@font-face', prelude: null, rules: [
      { type: 'Declaration', name: 'font-family', value: { type: 'VariableReference', name: 'font' } },
      { type: 'Declaration', name: 'src', value: { type: 'Url', value: { type: 'Quoted', value: 'font.woff2' } } }
    ] }] });
  });

  it('rejects nested rules in @font-face', () => {
    for (const source of ['@font-face { .nested { color: red; } }']) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs descriptor-only @counter-style blocks with a typed name prelude', () => {
    const source = '@counter-style thumbs { system: cyclic; symbols: "👍"; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'AtRuleBlock', name: '@counter-style', prelude: { type: 'Keyword', src: 'thumbs' }, rules: [{ type: 'Declaration', name: 'system' }, { type: 'Declaration', name: 'symbols' }] }] });
  });

  it('rejects nested rules in @counter-style', () => {
    for (const source of ['@counter-style thumbs { .nested { color: red; } }']) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs static @page blocks and every finite margin box as existing AtRuleBlock facts', () => {
    const names = [
      'top-left-corner', 'top-left', 'top-center', 'top-right', 'top-right-corner',
      'bottom-left-corner', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-right-corner',
      'left-top', 'left-middle', 'left-bottom', 'right-top', 'right-middle', 'right-bottom'
    ];
    const source = `@PAGE report:left { /* page */ size: A4; ${names.map((name, index) => `@${name}${index === 0 ? ' /* header */' : ''} { content: "${name}"; }`).join(' ')} }`;
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@PAGE', prelude: { type: 'Any', src: 'report:left' }, rules: [
          { type: 'Comment', text: '/* page */' },
          { type: 'Declaration', name: 'size' },
          ...names.map(name => ({ type: 'AtRuleBlock', name: `@${name}`, prelude: null, rules: [{ type: 'Declaration', name: 'content' }] }))
        ]
      }]
    });
  });

  it('keeps direct @page bodies declaration-only and rejects dynamic headers rather than flattening them', () => {
    for (const source of [
      '@page { .nested { color: red; } }',
      '@page { @media print { color: red; } }',
      '@page { @top-left { .nested { color: red; } } }',
      '@page { @top-left { @media print { color: red; } } }',
      '@page { @unknown { content: "x"; } }',
      '@page #{$name} { size: A4; }'
    ]) {
      expect(parseScssCst(source).errors, source).toHaveLength(0);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('keeps static @page facts reachable through the existing selected @if body', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '@if true { @page appendix { size: letter; } }',
      { trivia: scssGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'If', branches: [{ rules: [{
        type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: 'appendix' }, rules: [{ type: 'Declaration', name: 'size' }]
      }] }] }]
    });
  });

  it('constructs static @document headers and recursive frame-one bodies directly', () => {
    const source = '@-moz-document url-prefix("https://example.test/"), domain("example.test") { @font-face { font-family: Demo; } .card { color: red; } @document regexp("nested") { .inside { color: blue; } } }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'AtRuleBlock', name: '@-moz-document',
        prelude: { type: 'Any', src: 'url-prefix("https://example.test/"), domain("example.test")' },
        rules: [
          { type: 'AtRuleBlock', name: '@font-face' },
          { type: 'Ruleset' },
          { type: 'AtRuleBlock', name: '@document', prelude: { type: 'Any', src: 'regexp("nested")' }, rules: [{ type: 'Ruleset' }] }
        ]
      }]
    });
  });

  it('rejects dynamic and non-frame-one @document forms instead of lowering raw text', () => {
    for (const source of [
      '@document #{$target} { .card { color: red; } }',
      '@document url-prefix("#{$target}") { .card { color: red; } }',
      '@document url("screen") { color: red; }',
      '@document url("screen") { @import "nested.css"; }',
      '@page { @document url("screen") { .card { color: red; } } }',
      '@keyframes fade { @document url("screen") { .card { color: red; } } }'
    ]) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs descriptor-only @property blocks with a typed custom-property prelude', () => {
    const source = '@property --accent { /* descriptor */ syntax: "<color>"; inherits: false; initial-value: red; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' }, rules: [
          { type: 'Comment', text: '/* descriptor */' },
          { type: 'Declaration', name: 'syntax', value: { type: 'Quoted', src: '"<color>"', value: '<color>', quote: '"', escaped: false }, merge: null, important: false },
          { type: 'Declaration', name: 'inherits', value: { type: 'Keyword', src: 'false' }, merge: null, important: false },
          { type: 'Declaration', name: 'initial-value', value: { type: 'Keyword', src: 'red' }, merge: null, important: false }
        ]
      }]
    });
  });

  it('rejects malformed @property headers and nested rules', () => {
    for (const source of [
      '@property accent { syntax: "<color>"; }',
      '@property -- accent { syntax: "<color>"; }',
      '@property --#{$name} { syntax: "<color>"; }',
      '@property --accent { .nested { color: red; } }'
    ]) {
      const cst = parseScssCst(source);
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('matches public conditional-prelude rejection without a fallback block path', () => {
    for (const source of [
      '@supports color { .bad { color: red; } }',
      '@supports { .bad { color: red; } }',
      '@media $cond { .bad { color: red; } }',
      '@container $cond { .bad { color: red; } }',
      '@media only; screen { .bad { color: red; } }',
      '@container only; screen { .bad { color: red; } }'
    ]) {
      const cst = parseScssCst(source);
      expect(cst.errors.length > 0 || cst.unconsumedFrom !== null, source).toBe(true);
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
    const onlyContainer = '@container only screen { .bad { color: red; } }';
    const onlyContainerResult = run(scssGrammar.Stylesheet, onlyContainer, { trivia: scssGrammar.whitespace });
    expect(onlyContainerResult.ok && onlyContainerResult.unconsumedFrom === null && isStylesheet(onlyContainerResult.value), onlyContainer).toBe(false);
  });

  it('matches the public parser rejection of an unterminated block comment', () => {
    const source = '.card { color: red; /* unterminated';
    const cst = parseScssCst(source);
    expect(cst.errors.length > 0 || cst.unconsumedFrom !== null).toBe(true);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('constructs static SCSS selector lists, compounds, pseudos, and nesting selectors directly', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '.card.featured:hover, #hero::before { color: blue; &.active { color: red; } > .child { color: green; } }',
      { trivia: scssGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: {
          type: 'SelectorList',
          selectors: [
            { type: 'CompoundSelector', value: [{ text: '.card' }, { text: '.featured' }, { text: ':hover' }] },
            { type: 'CompoundSelector', value: [{ text: '#hero' }, { text: '::before' }] }
          ]
        },
        rules: [{ type: 'Declaration', name: 'color' }, {
          type: 'Ruleset',
          selector: { type: 'SelectorList', selectors: [{ type: 'CompoundSelector', value: [{ text: '&' }, { text: '.active' }] }] }
        }, {
          type: 'Ruleset',
          selector: { type: 'SelectorList', selectors: [{ type: 'RelativeSelector', value: ['>', { text: '.child' }] }] }
        }]
      }]
    });

    const rootRelative = run(
      scssGrammar.Stylesheet,
      '> .child { color: green; }',
      { trivia: scssGrammar.whitespace }
    );
    expect(rootRelative.ok && rootRelative.unconsumedFrom === null && isStylesheet(rootRelative.value)).toBe(false);
  });

  it('rejects whitespace-separated static pseudo colons on the direct AST path', () => {
    for (const source of [
      '.card : hover { color: red; }',
      '.card: hover { color: red; }'
    ]) {
      const direct = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs public static selector combinators as canonical ComplexSelector tails', () => {
    const source = '.card > .icon + svg ~ .badge || .part, .menu .item { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [
        { value: [
          { text: '.card' },
          '>',
          { text: '.icon' },
          '+',
          { text: 'svg' },
          '~',
          { text: '.badge' },
          '||',
          { text: '.part' }
        ] },
        { value: [{ text: '.menu' }, ' ', { text: '.item' }] }
      ] } }]
    });
  });

  it('constructs public static attribute selectors as canonical selector simples', () => {
    const source = '.card[data-state="open" i][lang|=en] { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.card' },
        { type: 'SimpleSelector', text: '[data-state="open"i]' },
        { type: 'SimpleSelector', text: '[lang|=en]' }
      ] }] } }]
    });
  });

  it('uses the universal quoted override for interpolated attribute selectors', () => {
    const source = '$state: open; .card[data-state="#{$state}"] { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'VariableDeclaration' }, {
        type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
          { type: 'SimpleSelector', text: '.card' },
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '[data-state="' },
            { ref: { type: 'VariableReference', name: 'state', lookup: 'live' }, unquote: true },
            { lit: '"]' }
          ] } }
        ] }] }
      }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card[data-state="open"] {\n  color: blue;\n}\n'
    );
  });

  it('rejects namespaced attribute selectors until their namespace fact has a canonical AST field', () => {
    const source = '.card[svg|href] { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors.length > 0 || cst.unconsumedFrom !== null).toBe(true);

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('constructs static selector-valued pseudo arguments as structured PseudoSelector args (core owns the join)', () => {
    const source = '.card:not(.disabled, [aria-hidden=true]) { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();

    /*
     * Parser keeps the parsed `SelectorList` as `args`; `text` is null (the
     * inline join is core serialization's job, spaced). `:not` structures but is
     * sealed (crossable:false).
     */
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.card' },
        {
          type: 'PseudoSelector', name: ':not', text: null, crossable: false, interp: null,
          args: { type: 'SelectorList', selectors: [
            { type: 'SimpleSelector', text: '.disabled' },
            { type: 'SimpleSelector', text: '[aria-hidden=true]' }
          ] }
        }
      ] }] } }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card:not(.disabled, [aria-hidden=true]) {\n  color: blue;\n}\n'
    );
  });

  it('structures whitelisted selector-arg pseudos and leaves interp / non-whitelist pseudos unchanged', () => {
    /*
     * (1) `:is` structures: `args` is a real SelectorList, `text` is null, and it
     * is crossable. Authored spacing does NOT matter — core serialization joins
     * with `, ` on one line, so `:is(.a,.b)` and `:is(.a, .b)` both round-trip to
     * the spaced canonical form.
     */
    const structured = run(scssGrammar.Stylesheet, '.x:is(.a, .b) { color: red; }', { trivia: scssGrammar.whitespace });
    expect(structured.ok && structured.unconsumedFrom === null).toBe(true);
    expect(structured.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.x' },
        {
          type: 'PseudoSelector', name: ':is', text: null, crossable: true, interp: null,
          args: { type: 'SelectorList', selectors: [
            { type: 'SimpleSelector', text: '.a' },
            { type: 'SimpleSelector', text: '.b' }
          ] }
        }
      ] }] } }]
    });

    /*
     * The parser produces STRUCTURE + trivia only: it never joins, so the head
     * compound's serializer-owned `_canon` memo is still unset at parse time.
     */
    let canonBeforeSerialize: string | undefined = 'unset-marker';
    if (isStylesheet(structured.value)) {
      const first = structured.value.rules[0];
      if (first?.type === 'Ruleset') {
        const term = first.selector.selectors[0]?.value[0];
        canonBeforeSerialize = term?.type === 'CompoundSelector' ? term._canon : undefined;
      }
    }
    expect(canonBeforeSerialize).toBeUndefined();
    for (const [source, expected] of [
      ['.x:is(.a,.b) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n'],
      ['.x:is(.a, .b) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n']
    ] as const) {
      const rt = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(isStylesheet(rt.value) ? serialize(rt.value).css : undefined, source).toBe(expected);
    }

    // (2) `:where` structures too, but is SEALED (crossable:false).
    const sealed = run(scssGrammar.Stylesheet, '.x:where(.a, .b) { color: red; }', { trivia: scssGrammar.whitespace });
    expect(sealed.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'PseudoSelector', name: ':where', text: null, crossable: false }
      ] }] } }]
    });

    /*
     * (3) An interpolation-bearing whitelisted pseudo arg IS structured: the
     * argument is a retained `SelectorList` either way, and an interpolated
     * member is an ordinary interpolated simple one level down. This used to
     * assert rejection on the claim that the segments were "not represented in
     * AST v2" — false; they are typed here. The real defect was in core, which
     * joined `args` statically and dropped the member (ledger P21).
     * `:global` is not whitelisted, so it stays opaque SimpleSelector text.
     */
    const interp = run(scssGrammar.Stylesheet, '.x:is(#{$sel}) { color: red; }', { trivia: scssGrammar.whitespace });
    expect(interp.ok && interp.unconsumedFrom === null && isStylesheet(interp.value)).toBe(true);
    expect(interp.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'PseudoSelector', name: ':is', text: null, crossable: true, args: { type: 'SelectorList', selectors: [
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { ref: { type: 'VariableReference', name: 'sel' } }
          ] } }
        ] } }
      ] }] } }]
    });
    const opaque = run(scssGrammar.Stylesheet, '.x:global(.a) { color: red; }', { trivia: scssGrammar.whitespace });
    expect(opaque.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'SimpleSelector', text: ':global(.a)' }
      ] }] } }]
    });
  });

  it('restricts `of` to nth-child and rejects non-selector selector-pseudo args', () => {
    const accepted = (source: string): boolean => {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      return result.ok && result.unconsumedFrom === null && isStylesheet(result.value);
    };

    /*
     * `of <selector>` is defined only for the nth-child index family (Selectors-4
     * §6.6.2); the type-index families reject it, and a non-selector argument to a
     * selector-arg pseudo (`:not`/`:is`) now rejects rather than falling through to
     * opaque text. Bare `:nth-child`/`:nth-of-type` (no parens) reject too. This
     * closes the SCSS divergences against css/jess/less.
     */
    for (const source of [
      '.card:nth-of-type(2n of .a) { color: blue; }',
      '.card:nth-of-type(n of .a) { color: blue; }',
      '.card:nth-last-of-type(-n+3 of .a) { color: blue; }',
      '.card:not(2n+1) { color: blue; }',
      '.card:is(2n+1) { color: blue; }',
      '.card:nth-child { color: blue; }',
      '.card:nth-of-type { color: blue; }'
    ]) {
      expect(accepted(source), source).toBe(false);
    }
    for (const source of [
      'a:nth-child(2n of .a) { color: blue; }',
      'a:nth-of-type(2n+1) { color: blue; }',
      '.card:not(.a) { color: blue; }',
      '.card:is(.a, .b) { color: blue; }',
      '.card:has(> .b) { color: blue; }',
      '.card:has(+ .b) { color: blue; }',
      '.card:has(~ .b) { color: blue; }',
      '.card:lang(en) { color: blue; }'
    ]) {
      expect(accepted(source), source).toBe(true);
    }

    /*
     * A SELECTOR-valued argument is a retained `SelectorList`, so an
     * interpolated member is an ordinary interpolated simple one level down —
     * fully represented, and resolved per frame by core. The claim these three
     * used to carry ("their segments are not yet represented in AST v2") was
     * false for the selector-valued pair; they were rejected because the
     * SERIALIZER dropped the member, and the grammar had been narrowed to keep
     * that out of the output. Both are fixed.
     */
    for (const source of [
      '.card:not(#{$x}) { color: blue; }',
      '.card:is(#{$sel}) { color: blue; }'
    ]) {
      expect(accepted(source), source).toBe(true);
    }

    /*
     * `:nth-child` is the genuinely-unrepresented one and stays rejected. Its
     * argument is `<An+B>` — a static token grammar, not a selector list — so
     * an interpolated An+B has no node to live in, and the `of S` tail is the
     * only selector-valued part of it. Representing it needs an interpolation
     * carrier on the nth argument, which does not exist.
     */
    expect(accepted('.card:nth-child(#{$n}) { color: blue; }')).toBe(false);
    for (const source of ['.x:global(.a) { color: blue; }', '.x:local(.a) { color: blue; }']) {
      expect(accepted(source), source).toBe(true);
    }

    /*
     * Structured selector-arg pseudos normalize the insignificant whitespace
     * surrounding their argument (`:not( .b )` -> `:not(.b)`) via core's
     * `pseudoCanonical`, matching the other dialects.
     */
    for (const [source, expected] of [
      ['.card:not( .b ) { color: blue; }', '.card:not(.b) {\n  color: blue;\n}\n'],
      ['.card:is( .b, .c ) { color: blue; }', '.card:is(.b, .c) {\n  color: blue;\n}\n']
    ] as const) {
      expect(serialize(parse(source)).css, source).toBe(expected);
    }
  });

  it('constructs static non-selector pseudo arguments as existing SimpleSelector text', () => {
    const source = '.card:lang(en-US):nth-child(-n+2 of .item)::part(icon) { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.card' },
        { type: 'SimpleSelector', text: ':lang(en-US)' },
        { type: 'SimpleSelector', text: ':nth-child(-n+2 of .item)' },
        { type: 'SimpleSelector', text: '::part(icon)' }
      ] }] } }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card:lang(en-US):nth-child(-n+2 of .item)::part(icon) {\n  color: blue;\n}\n'
    );

    for (const invalid of [
      '.card:nth-child(2n +) { color: blue; }',
      '.card:nth-child(1.5) { color: blue; }',
      '.card:nth-child(+ n) { color: blue; }',
      '.card:nth-child(+ n-5) { color: blue; }',
      '.card:nth-child(1 - n) { color: blue; }',
      '.card:nth-child(2 n + 2) { color: blue; }',
      '.card:nth-child(- 2n) { color: blue; }',
      '.card:lang(#{$locale}) { color: blue; }',
      '.card:part(icon-#{$name}) { color: blue; }'
    ]) {
      const direct = run(scssGrammar.Stylesheet, invalid, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('accepts An+B whitespace around the sign and normalizes surrounding argument space', () => {
    /*
     * Selectors-4 §6.6.2 permits OPTIONAL whitespace around the `+`/`-` sign and
     * surrounding the argument inside the parens
     * (https://www.w3.org/TR/selectors-4/#anb-microsyntax). Sign whitespace is
     * preserved verbatim; insignificant space surrounding the argument is
     * normalized away, matching the canonical CSS grammar and the other dialects.
     */
    for (const [source, expected] of [
      ['a:nth-child(2n + 1) { color: red; }', 'a:nth-child(2n + 1) {\n  color: red;\n}\n'],
      ['a:nth-last-child(n - 3) { color: red; }', 'a:nth-last-child(n - 3) {\n  color: red;\n}\n'],
      ['a:nth-child(2n+1) { color: red; }', 'a:nth-child(2n+1) {\n  color: red;\n}\n'],
      ['a:nth-child( 2n+1 ) { color: red; }', 'a:nth-child(2n+1) {\n  color: red;\n}\n']
    ] as const) {
      expect(serialize(parse(source)).css, source).toEqual(expected);
    }
  });

  it('constructs ordinary SCSS interpolated simple selectors as existing typed SimpleSelector facts', () => {
    const source = '$name: button; $state: active; .#{$name}-#{$state}, #item-#{$name} { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, {
        type: 'Ruleset', selector: { selectors: [
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '.' }, { ref: { type: 'VariableReference', name: 'name', lookup: 'live' }, unquote: true },
            { lit: '-' }, { ref: { type: 'VariableReference', name: 'state', lookup: 'live' }, unquote: true }
          ] } },
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '#item-' }, { ref: { type: 'VariableReference', name: 'name', lookup: 'live' }, unquote: true }
          ] } }
        ] }
      }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.button-active,\n#item-button {\n  color: blue;\n}\n'
    );
  });

  /*
   * FLIPPED. This asserted rejection "until their segments are represented in
   * AST v2" — the segments were already represented, and the failure was core
   * joining `PseudoSelector.args` statically so an interpolated member
   * (`text: null`) serialized away. Ledger P21; emitted-CSS gate lives in
   * `packages/jess/test/scss/interpolated-pseudo-argument.test.ts`.
   */
  it('constructs interpolation-bearing pseudo arguments as typed selector members', () => {
    const source = '.card:not(#{$disabled}) { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(true);
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector', value: [
        { type: 'SimpleSelector', text: '.card' },
        { type: 'PseudoSelector', name: ':not', text: null, crossable: false, args: { type: 'SelectorList', selectors: [
          { type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { ref: { type: 'VariableReference', name: 'disabled' } }
          ] } }
        ] } }
      ] }] } }]
    });
  });

  it('constructs static SCSS placeholder selectors as canonical selector simples', () => {
    const source = '%notice { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{ type: 'Ruleset', selector: { selectors: [
        { type: 'SimpleSelector', text: '%notice' }
      ] } }]
    });
  });

  it('rejects interpolation-bearing placeholder names rather than flattening their source', () => {
    const source = '%#{$name} { color: blue; }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('matches the public placeholder selector boundary', () => {
    const compound = '.card %notice { color: blue; }';
    const compoundCst = parseScssCst(compound);
    expect(compoundCst.errors).toHaveLength(0);
    expect(compoundCst.unconsumedFrom).toBeNull();
    const compoundResult = run(scssGrammar.Stylesheet, compound, { trivia: scssGrammar.whitespace });
    expect(compoundResult.ok && compoundResult.unconsumedFrom === null && isStylesheet(compoundResult.value)).toBe(true);

    const list = '%notice, .card { color: blue; }';
    const listCst = parseScssCst(list);
    expect(listCst.unconsumedFrom).not.toBeNull();
    const listResult = run(scssGrammar.Stylesheet, list, { trivia: scssGrammar.whitespace });
    expect(listResult.ok && listResult.unconsumedFrom === null && isStylesheet(listResult.value)).toBe(false);
  });

  it('constructs a case-insensitive declaration priority directly', () => {
    const result = run(
      scssGrammar.Stylesheet,
      '.card { color: blue !IMPORTANT; }',
      { trivia: scssGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: {
          type: 'SelectorList',
          selectors: [{ type: 'SimpleSelector', text: '.card', interp: null }]
        },
        rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' }, merge: null, important: true }]
      }]
    });
  });

  it('hoists static SCSS @extend targets onto the carrying canonical Ruleset', () => {
    const source = '.base { color: blue; } .button { @extend .base; color: red; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Ruleset', selector: { selectors: [{ type: 'SimpleSelector', text: '.base' }] } },
        {
          type: 'Ruleset',
          selector: { selectors: [{ type: 'SimpleSelector', text: '.button' }] },
          extendInstructions: [{
            partial: false,
            target: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: '.base' }] }
          }],
          rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
        }
      ]
    });
  });

  it('rejects @extend !optional until its diagnostic semantics have a typed AST field', () => {
    const source = '.button { @extend .base !optional; }';
    const cst = parseScssCst(source);
    expect(cst.errors.length > 0 || cst.unconsumedFrom !== null).toBe(true);

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('constructs static SCSS mixin definitions and includes as canonical mixin nodes', () => {
    const source = `
      @mixin paint($color, $gap: 2px, $rest...) {
        color: $color;
        margin: $gap;
        @include normalize(0);
        .nested { padding: 1px; }
      }
      .card { @include paint(blue, $gap: 4px, $rest...); }
    `;
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition', name: 'paint',
          params: [
            { name: 'color' },
            { name: 'gap', default: { type: 'Dimension', number: 2, unit: 'px', src: '2px' } },
            { name: 'rest', rest: true }
          ],
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'color' } },
            { type: 'Declaration', name: 'margin', value: { type: 'VariableReference', name: 'gap' } },
            { type: 'MixinCall', name: 'normalize', args: [{ value: { type: 'Dimension', number: 0, unit: '', src: '0' } }], path: [], important: false },
            { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'padding' }] }
          ]
        },
        {
          type: 'Ruleset', rules: [{
            type: 'MixinCall', name: 'paint', path: [], important: false,
            args: [
              { value: { type: 'Keyword', src: 'blue' } },
              { name: 'gap', value: { type: 'Dimension', number: 4, unit: 'px', src: '4px' } },
              { value: { type: 'VariableReference', name: 'rest' }, spread: true }
            ]
          }]
        }
      ]
    });
  });

  it('retains static mixin definitions and includes inside public conditional at-rule bodies', () => {
    const source = `
      @media screen {
        @mixin local($width: 1px) { width: $width; }
        @include outer(2px);
        .host { @include local; }
      }
    `;
    expect(parseScssCst(source).errors).toHaveLength(0);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@media', rules: [
          { type: 'MixinDefinition', name: 'local', params: [{ name: 'width', default: { type: 'Dimension', number: 1, unit: 'px' } }], rules: [{ type: 'Declaration', name: 'width' }] },
          { type: 'MixinCall', name: 'outer', args: [{ value: { type: 'Dimension', number: 2, unit: 'px' } }] },
          { type: 'Ruleset', rules: [{ type: 'MixinCall', name: 'local', args: [] }] }
        ]
      }]
    });
  });

  it('constructs static SCSS @each loops as canonical For nodes', () => {
    const source = '@each $tone in red blue { .swatch { color: $tone; } }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'For', binding: { kind: 'single', name: 'tone' },
        iterable: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }],
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone' } }] }]
      }]
    });
  });

  it('constructs SCSS @each tuple bindings without borrowing Less key/index roles', () => {
    for (const [source, binding] of [
      ['@each $name, $tone in red blue { .swatch { color: $name; } }', { kind: 'tuple', names: ['name', 'tone'] }],
      ['@each $name, $tone, $weight in red blue { .swatch { color: $name; } }', { kind: 'tuple', names: ['name', 'tone', 'weight'] }],
      ['@each $name, $tone, $weight, $size in red blue { .swatch { color: $name; } }', { kind: 'tuple', names: ['name', 'tone', 'weight', 'size'] }]
    ] as const) {
      const cst = parseScssCst(source);
      expect(cst.errors).toHaveLength(0);
      expect(cst.unconsumedFrom).toBeNull();

      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok).toBe(true);
      expect(result.unconsumedFrom).toBeNull();
      expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [{ type: 'For', binding }] });
    }
  });

  it('constructs SCSS @for endpoints as a typed inclusive or exclusive Range', () => {
    for (const [source, includeEnd] of [
      ['@for $i from 1 through 3 { .n { width: $i; } }', true],
      ['@for $i from 1 to 3 { .n { width: $i; } }', false],
      ['.host { @for $i from 2 through 4 { width: $i; } }', true]
    ] as const) {
      const cst = parseScssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();

      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      const first = stylesheet(result.value).rules[0];
      const loop = source.startsWith('.host')
        ? first?.type === 'Ruleset' && first.rules[0]
        : first;
      expect(loop).toMatchObject({
        type: 'For', binding: { kind: 'single', name: 'i' },
        iterable: { type: 'Range', start: { type: 'Dimension', number: source.startsWith('.host') ? 2 : 1 }, end: { type: 'Dimension', number: source.startsWith('.host') ? 4 : 3 }, includeStart: true, includeEnd }
      });
    }
  });

  it('keeps unparenthesized SCSS @for arithmetic bounds as Range value facts', () => {
    const source = '@for $i from 1 + 1 through 4 - 1 { .n { width: $i * 1px; } }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', rules: [{
        type: 'For',
        iterable: {
          type: 'Range',
          start: { type: 'Operation', operator: '+', left: { src: '1' }, right: { src: '1' } },
          end: { type: 'Operation', operator: '-', left: { src: '4' }, right: { src: '1' } },
          includeStart: true,
          includeEnd: true
        }
      }]
    });
    expect(serialize(stylesheet(result.value), { evaluator })).toEqual({
      css: '.n {\n  width: 2px;\n}\n.n {\n  width: 3px;\n}\n'
    });
  });

  it('does not let malformed SCSS @for arithmetic bounds fall through as ranges', () => {
    for (const source of [
      '@for $i from 1 + through 3 { .n { width: $i; } }',
      '@for $i from 1 through 3 - { .n { width: $i; } }',
      '@for $i from 1 2 through 3 { .n { width: $i; } }'
    ]) {
      const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs static CSS statement at-rules through the existing AtRuleStatement fact', () => {
    const source = '@charset "UTF-8"; @namespace svg url("https://example.test/svg"); @layer theme;';
    const cst = parseScssCst(source);
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [
      { type: 'AtRuleStatement', name: '@charset', prelude: { type: 'Any', src: '"UTF-8"' } },
      { type: 'AtRuleStatement', name: '@namespace', prelude: { type: 'Any', src: 'svg url("https://example.test/svg")' } },
      { type: 'AtRuleStatement', name: '@layer', prelude: { type: 'Any', src: 'theme' } }
    ] });
    expect(serialize(stylesheet(result.value))).toEqual({
      css: '@charset "UTF-8";\n@namespace svg url("https://example.test/svg");\n@layer theme;\n'
    });

    const lineComment = run(scssGrammar.Stylesheet, '@layer theme // local note\n;', { trivia: scssGrammar.whitespace });
    expect(lineComment.ok).toBe(true);
    expect(lineComment.unconsumedFrom).toBeNull();
    expect(serialize(stylesheet(lineComment.value))).toEqual({ css: '@layer theme;\n' });

    for (const invalid of [
      '@debug "note";',
      '@warn "note";',
      '@error "note";',
      '@namespace #{$prefix} url("https://example.test/svg");',
      '@layer #{$name};'
    ]) {
      const direct = run(scssGrammar.Stylesheet, invalid, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('constructs static CSS @scope blocks through the existing AtRuleBlock fact', () => {
    const source = '@scope (.card) to (.card > .title) { .item { color: red; } }';
    const result = run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', rules: [{
      type: 'AtRuleBlock', name: '@scope', prelude: { type: 'Any', src: '(.card) to (.card > .title)' },
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }]
    }] });

    for (const invalid of [
      '@scope #{scope} { .item { color: red; } }',
      '@scope (.card #{$part}) { .item { color: red; } }'
    ]) {
      const direct = run(scssGrammar.Stylesheet, invalid, { trivia: scssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('retains authored comments and multiline indentation on raw ValueSlot boundaries', () => {
    const document = parse('.a { color: red /* keep */\n  blue; shadow: a,\n  b; }');
    const body = document.rules[0];
    if (body?.type !== 'Ruleset') {
      throw new Error('expected an SCSS rule');
    }
    const adjacent = body.rules[0]?.type === 'Declaration' ? body.rules[0].value : null;
    const comma = body.rules[1]?.type === 'Declaration' ? body.rules[1].value : null;
    expect(Array.isArray(adjacent)).toBe(true);
    expect(comma).toMatchObject({ type: 'List' });
    if (typeof adjacent !== 'object' || adjacent === null || typeof comma !== 'object' || comma === null) {
      throw new Error('expected structured declaration values');
    }
    expect(valueLayoutOf(adjacent)).toEqual([' /* keep */\n  ']);
    expect(valueLayoutOf(comma)).toEqual([',\n  ']);
    expect(serialize(document).css).toContain('color: red /* keep */\n    blue;');
    expect(serialize(document).css).toContain('shadow: a,\n    b;');
  });

  /*
   * SCSS→Jess lowering (parse/AST-shape correctness; evaluator rendering of the
   * shared Collection/accessor/lambda is a separate downstream concern).
   */
  it('lowers SCSS map literals to the shared Collection node', () => {
    expect(bare(parse('$m: (a: 1, b: 2);'))).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'VariableDeclaration', name: 'm', write: { mode: 'declare' },
        value: {
          type: 'Collection', entries: [
            { type: 'CollectionEntry', key: { type: 'Keyword', src: 'a' }, value: { type: 'Dimension', number: 1, unit: '', src: '1' }, merge: null, important: false },
            { type: 'CollectionEntry', key: { type: 'Keyword', src: 'b' }, value: { type: 'Dimension', number: 2, unit: '', src: '2' }, merge: null, important: false }
          ]
        }
      }]
    });

    // Empty `()` and a single `(a: 1)` are maps too.
    expect(parse('$m: ();').rules[0]).toMatchObject({ value: { type: 'Collection', entries: [] } });
    expect(parse('$m: (a: 1);').rules[0]).toMatchObject({ value: { type: 'Collection', entries: [{ type: 'CollectionEntry', key: { type: 'Keyword', src: 'a' } }] } });

    /*
     * A quoted-string key stays typed; a space-list value stays a structured
     * value slot.
     */
    expect(parse('$m: ("k": 1px solid);').rules[0]).toMatchObject({
      value: { type: 'Collection', entries: [{ type: 'CollectionEntry', key: { type: 'Quoted', value: 'k' }, value: [{ type: 'Dimension', src: '1px' }, { type: 'Keyword', src: 'solid' }] }] }
    });

    // A paren value-list (no `key:` entry) stays a Block list, never a Collection.
    expect(parse('$m: (1 2 3);').rules[0]).toMatchObject({ value: { type: 'Block', delimiter: 'paren' } });
    expect(parse('$m: (1 + 2);').rules[0]).toMatchObject({ value: { type: 'Block', value: { type: 'Operation' } } });
  });

  it('lowers SCSS map-get to the shared $[…] accessor read', () => {
    /*
     * `map-get($m, a)` => `$m[a]`: a Reference whose single BracketLookup step
     * carries the key (member lookup for a value key, var lookup for `$k`).
     */
    expect(parse('.x { color: map-get($m, a); }').rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Declaration', name: 'color',
        value: {
          type: 'Reference',
          base: { type: 'VariableReference', name: 'm', lookup: 'live' },
          steps: [{ type: 'BracketLookup', key: { type: 'Keyword', src: 'a' }, keyKind: 'member' }],
          raw: '$m[a]'
        }
      }]
    });

    expect(parse('.x { color: map-get($m, $k); }').rules[0]).toMatchObject({
      rules: [{ value: { type: 'Reference', steps: [{ type: 'BracketLookup', key: { type: 'VariableReference', name: 'k' }, keyKind: 'var' }], raw: '$m[$k]' } }]
    });

    // A non-canonical arity stays a plain FunctionCall for `fns` routing.
    expect(parse('.x { color: map-get($m); }').rules[0]).toMatchObject({
      rules: [{ value: { type: 'FunctionCall', name: 'map-get' } }]
    });
  });

  it('keeps the authored callee path of a @use-namespaced function call', () => {
    /*
     * The parser has no binding table: it cannot know whether `color` names a
     * built-in `sass:` module or a `@use`d file, so it records the authored
     * callee path verbatim and leaves the namespace/member split to resolution.
     */
    expect(parse('a { b: color.mix(red, blue); }').rules[0]).toMatchObject({
      rules: [{ value: { type: 'FunctionCall', name: 'color.mix', args: [{ type: 'Keyword' }, { type: 'Keyword' }] } }]
    });

    // `map.get` is the module spelling of `map-get`; one semantics, one tree.
    expect(parse('a { b: map.get($m, k); }').rules[0]).toMatchObject({
      rules: [{ value: { type: 'Reference', base: { type: 'VariableReference', name: 'm' }, raw: '$m[k]' } }]
    });
  });

  it('lowers a @use-namespaced variable read to the shared $[…] accessor', () => {
    expect(parse('a { b: theme.$primary; }').rules[0]).toMatchObject({
      rules: [{
        value: {
          type: 'Reference',
          base: { type: 'Keyword', src: 'theme' },
          steps: [{ type: 'BracketLookup', key: { type: 'VariableReference', name: 'primary', lookup: 'live' }, keyKind: 'var' }],
          raw: 'theme.$primary'
        }
      }]
    });
  });

  it('does not admit a bare identifier-dot-identifier value as a namespace read', () => {
    /*
     * `ns.name` with neither a glued `(` nor a `$` is not a Sass member form.
     * Admitting it would silently reinterpret plain CSS value text, so the
     * qualifier arms require the deciding suffix and this stays a rejection.
     */
    expect(() => parse('a { b: foo.bar; }')).toThrow();
  });

  it('lowers a user SCSS @function to a $var-bound anonymous mixin whose @return is result:', () => {
    /*
     * A zero-parameter function lowers completely: `$two: @() > { result: 2 }`.
     * The `params` field is OMITTED so the plain-block shape stays monomorphic.
     */
    expect(bare(parse('@function two() { @return 2; }'))).toEqual({
      type: 'Stylesheet',
      rules: [{
        type: 'VariableDeclaration', name: 'two', write: { mode: 'declare' },
        value: {
          type: 'AnonymousMixin',
          rules: [{ type: 'Declaration', name: 'result', value: { type: 'Dimension', number: 2, unit: '', src: '2' }, merge: null, important: false }]
        }
      }]
    });

    /*
     * A parameterized function threads its `($n)` list into `AnonymousMixin.params`
     * (the same `Param` shape a MixinDefinition uses), with `@return` → `result:`.
     */
    expect(bare(parse('@function double($n) { @return $n * 2; }').rules[0])).toEqual({
      type: 'VariableDeclaration', name: 'double', write: { mode: 'declare' },
      value: {
        type: 'AnonymousMixin',
        params: [{ name: 'n' }],
        rules: [{ type: 'Declaration', name: 'result', value: { type: 'Operation', operator: '*', left: { type: 'VariableReference', name: 'n', lookup: 'live' }, right: { type: 'Dimension', number: 2, unit: '', src: '2' } }, merge: null, important: false }]
      }
    });
  });

  it('leaves a user SCSS @function call site as an ordinary FunctionCall', () => {
    /*
     * A call to a user `@function` and a call to a builtin are the SAME shape —
     * `double(2)` and `darken(...)` are indistinguishable at the leaf, and which
     * one a name denotes depends on what is in scope where it is called. That is
     * a semantic question, so the parser answers neither: it records the call as
     * authored and the evaluator resolves the name against the binding it made
     * for `@function double`. Deciding it here would mean re-deriving scope from
     * a whole-tree scan the parse already had no need to perform.
     */
    const doc = parse('@function double($n) { @return $n * 2; } .a { w: double(2); c: darken(#fff, 10%); }');
    const ruleNode = doc.rules.find(child => child.type === 'Ruleset');
    expect(ruleNode).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'w', value: {
          type: 'FunctionCall',
          name: 'double',
          args: [{ type: 'Dimension', number: 2, unit: '', src: '2' }]
        } },
        { type: 'Declaration', name: 'c', value: { type: 'FunctionCall', name: 'darken' } }
      ]
    });
  });
});
