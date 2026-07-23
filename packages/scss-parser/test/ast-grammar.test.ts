import { run } from 'parseman';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { valueLayoutOf } from '@jesscss/core/ast';
import type { Stylesheet } from '@jesscss/core/ast';
import { buildEvaluator } from '../../core/src/ast/evaluator.js';
import { serialize } from '../../core/src/ast/serialize.js';
import { scssAstGrammar } from '../src/ast/grammar.js';
import { parseScssCst } from '../src/cst.js';
import { parse } from '../src/index.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Stylesheet'
    && 'children' in value && Array.isArray(value.children);
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

const evaluator = buildEvaluator(makeBuiltinRegistry());

describe('SCSS canonical-AST grammar', () => {
  it('keeps ordinary adjacency as a raw value array and reserves List for explicit separators', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '$space: red blue; $comma: red, blue; $slash: 1 / 2;',
      { trivia: scssAstGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
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
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs the restricted static @if chain as canonical If/GuardNode facts', () => {
    const source = '@if not (false or false) and true { /* keep */ .yes { color: green; } @media screen { .inside { color: lime; } } } @else if false { .no { color: red; } } @else { .fallback { color: blue; } }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'If',
        branches: [
          { guard: { g: 'and', left: { g: 'not', inner: { g: 'or', left: { g: 'truth', value: { src: 'false' } }, right: { g: 'truth', value: { src: 'false' } } } }, right: { g: 'truth', value: { src: 'true' } } }, body: [
            { type: 'Comment' }, { type: 'Rule' }, { type: 'AtRuleBlock', name: '@media' }
          ] },
          { guard: { g: 'truth', value: { src: 'false' } }, body: [{ type: 'Rule' }] },
          { guard: null, body: [{ type: 'Rule' }] }
        ]
      }]
    });
  });

  it('renders only the selected static SCSS @if branch through the canonical serializer', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '@if false { .no { color: red; } } @else if not false { .yes { color: green; } } @else { .fallback { color: blue; } }',
      { trivia: scssAstGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(serialize(stylesheet(result.value))).toEqual({ css: '.yes {\n  color: green;\n}\n' });
  });

  it('constructs and evaluates static SCSS comparison conditions through existing guard facts', () => {
    const source = '@if 1 == 2 { .wrong { color: red; } } @else if 2 != 3 and 4 >= 4 { .right { color: green; } }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
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
      const result = run(scssAstGrammar.ScssAstDocument, `@if ${condition} { .yes { color: green; } } @else { .no { color: red; } }`, { trivia: scssAstGrammar.whitespace });
      expect(result.ok, condition).toBe(true);
      expect(result.unconsumedFrom, condition).toBeNull();
      expect(isStylesheet(result.value), condition).toBe(true);
      expect(serialize(stylesheet(result.value), { evaluator }).css, condition).toContain(`.${expected} {`);
    }
  });

  it('uses existing statement facts in a selected SCSS @if body', () => {
    const source = '@if true { $accent: blue; @mixin paint { color: $accent; } .host { @include paint; } @each $tone in red { .each { color: $tone; } } @for $i from 1 through 1 { .step { width: $i; } } }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'If', branches: [{ body: [
        { type: 'VariableDeclaration', name: 'accent' },
        { type: 'MixinDef', name: 'paint' },
        { type: 'Rule', body: [{ type: 'MixinCall', name: 'paint' }] },
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
      scssAstGrammar.ScssAstDocument,
      '@if true { @if false { .no { color: red; } } @else { .nested { color: green; } } }',
      { trivia: scssAstGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toMatchObject({ children: [{ type: 'If', branches: [{ body: [{ type: 'If' }] }] }] });
    expect(serialize(stylesheet(result.value))).toEqual({ css: '.nested {\n  color: green;\n}\n' });
  });

  it('constructs restricted @if blocks nested in direct static media bodies', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '@media screen { @if false { .no { color: red; } } @else { .inside { color: green; } } }',
      { trivia: scssAstGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@media', body: [{ type: 'If', branches: [{ guard: { g: 'truth', value: { src: 'false' } } }, { guard: null }] }] }]
    });
    expect(serialize(stylesheet(result.value))).toEqual({ css: '@media screen {\n  .inside {\n    color: green;\n  }\n}\n' });
  });

  it('rejects unmodelled @if conditions and body forms instead of borrowing eval or legacy parsing', () => {
    for (const source of [
      '@if $enabled { .a { color: green; } }',
      '@if feature() { .a { color: green; } }'
    ]) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'If', branches: [{ body: [{ type: 'ImportAtRule', target: { value: 'if.css' } }] }] },
        { type: 'MixinDef', body: [{ type: 'ImportAtRule', target: { value: 'mixin.css' } }] },
        { type: 'For', rules: [{ type: 'ImportAtRule', target: { value: 'each.css' } }] },
        { type: 'For', rules: [{ type: 'ImportAtRule', target: { value: 'for.css' } }] },
        { type: 'AtRuleBlock', name: '@media', body: [{ type: 'ImportAtRule', target: { value: 'media.css' } }] },
        { type: 'AtRuleBlock', name: '@supports', body: [{ type: 'ImportAtRule', target: { value: 'supports.css' } }] },
        { type: 'AtRuleBlock', name: '@layer', body: [{ type: 'ImportAtRule', target: { value: 'layer.css' } }] },
        { type: 'AtRuleBlock', name: '@scope', body: [{ type: 'ImportAtRule', target: { value: 'scope.css' } }] },
        { type: 'Rule', body: [
          { type: 'ImportAtRule', target: { type: 'Url', value: { value: 'rule.css' } } },
          { type: 'AtRuleBlock', name: '@media', body: [{ type: 'ImportAtRule', target: { value: 'nested-media.css' } }] },
          { type: 'AtRuleBlock', name: '@supports', body: [{ type: 'ImportAtRule', target: { value: 'nested-supports.css' } }] },
          { type: 'AtRuleBlock', name: '@layer', body: [{ type: 'ImportAtRule', target: { value: 'nested-layer.css' } }] },
          { type: 'AtRuleBlock', name: '@scope', body: [{ type: 'ImportAtRule', target: { value: 'nested-scope.css' } }] }
        ] },
        { type: 'Rule', body: [{ type: 'MixinCall', name: 'imported' }] }
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({ type: 'Stylesheet', children: [{ type: 'ImportAtRule', name: '@import', options: null, target: { type: 'Quoted', src: '"theme.css"', value: 'theme.css', quote: '"', escaped: false }, alias: null, tail: null }] });
  });

  it('constructs static SCSS url imports as typed ImportAtRule targets', () => {
    for (const source of ['@import url("theme.css");', '@import url(theme.css);']) {
      const cst = parseScssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'ImportAtRule', target: { type: 'Url' } }] });
    }
  });

  it('constructs the public-CST-valid empty SCSS url import target without a fallback', () => {
    const source = '@import url();';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'ImportAtRule', name: '@import', options: null,
        target: { type: 'Url', value: { type: 'Any', src: '' } },
        alias: null, tail: null
      }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe('@import url();\n');
  });

  it('constructs static SCSS import option lists as canonical List facts', () => {
    const source = '@import (css, once) "theme.css";';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'ImportAtRule', options: { type: 'List', sep: ',', value: [{ src: 'css' }, { src: 'once' }] } }] });
  });

  it('constructs typed static CSS-import supports tails without raw authored text', () => {
    const source = '@import "theme.css" layer(tokens) supports((display: grid)) screen;';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'ImportAtRule',
        tail: {
          type: 'SpacedValue', parts: [
            { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'tokens' }] },
            { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] },
            { type: 'Keyword', src: 'screen' }
          ]
        }
      }]
    });

    const simple = run(scssAstGrammar.ScssAstDocument, '@import "theme.css" supports(display: grid);', { trivia: scssAstGrammar.whitespace });
    expect(simple.ok).toBe(true);
    expect(simple.unconsumedFrom).toBeNull();
    expect(simple.value).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'ImportAtRule', tail: { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] } }]
    });

    for (const unsupported of [
      '@import "theme.css" supports(#{$feature});'
    ]) {
      const unsupportedResult = run(scssAstGrammar.ScssAstDocument, unsupported, { trivia: scssAstGrammar.whitespace });
      expect(unsupportedResult.ok && unsupportedResult.unconsumedFrom === null && isStylesheet(unsupportedResult.value), unsupported).toBe(false);
    }
  });

  it('constructs typed static CSS-import media-query tails and composes them after layer/supports', () => {
    const source = '@import "theme.css" layer(tokens) supports((display: grid)) only screen and (min-width: 1px), (color), not (color: red);';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'ImportAtRule',
        tail: {
          type: 'SpacedValue', parts: [
            { type: 'FunctionCall', name: 'layer', args: [{ type: 'Keyword', src: 'tokens' }] },
            { type: 'FunctionCall', name: 'supports', args: [{ type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] },
            {
              type: 'List', sep: ',', value: [
                { type: 'SpacedValue', parts: [{ src: 'only' }, { src: 'screen' }, { src: 'and' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] },
                { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'color' } },
                { type: 'SpacedValue', parts: [{ src: 'not' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }] }
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
      const direct = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(true);
    }

    for (const source of [
      '@import "theme.css" screen and foo(bar);',
      '@import "theme.css" #{$media};',
      '@import "theme.css" screen /* no raw/comment tail */ and (color);',
      '@import "theme.css" screen, #{$media};',
      '@import "a.css", "b.css" screen;',
      '@import "theme.css" screen or (color);',
      '@import "theme.css" only screen or (color);'
    ]) {
      const direct = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
    }
  });

  it('constructs interpolated SCSS import targets as parser-owned facts without classifying them', () => {
    for (const source of ['@import "theme-#{$mode}.css";', '@import url("theme-#{$mode}.css");']) {
      const cst = parseScssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(result.value).toMatchObject({
        type: 'Stylesheet',
        children: [{ type: 'ImportAtRule', target: source.includes('url(')
          ? { type: 'Url', value: { type: 'Interpolation', parts: [{ lit: '"theme-' }, { ref: { type: 'VariableReference', name: 'mode' }, unquote: true }, { lit: '.css"' }] } }
          : { type: 'Interpolation', parts: [{ lit: '"theme-' }, { ref: { type: 'VariableReference', name: 'mode' }, unquote: true }, { lit: '.css"' }] }
        }]
      });
    }
  });

  it('rejects malformed interpolated SCSS import targets structurally', () => {
    for (const source of ['@import "theme-#{$mode.css";', '@import url("theme-#{$mode.css");', '@import "theme-#{}";', '@import "theme.css"', '@import url(foo bar);', '@import url();, "other.css";']) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('classifies static SCSS @use paths and lowers bare @forward to existing import facts', () => {
    const source = '@use "sass:math" as math; @use "./tokens.ts" as tokens; @use "./theme.scss" as theme; @use "./global.scss" as *; @forward "./public.scss";';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
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

  it('rejects unrepresentable SCSS @use and @forward forms without classifying or resolving them', () => {
    for (const source of [
      '@use "theme-#{$name}.scss";',
      '@use "./theme\\.scss";',
      '@use "./theme.scss" with ($tone: red);',
      '@forward "./theme.scss" as theme-*;',
      '@forward "./theme\\.scss";',
      '@forward "./theme.scss" show $tone;',
      '@forward "./theme.scss" with ($tone: red);'
    ]) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs canonical SCSS variable declarations and references directly', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '$base: blue; $theme: $base; $font: "Inter"; $escaped: r\\65d; $quoted: "a\\\\b"; $hash: "#foo"; $singleHash: \'#foo\'; $shadow: 0 1px #000,\n    0 2px #fff; $asset: url("font.woff2"); $gradient: linear-gradient(#000, rgb(1, 2, 3)); .card { color: #00f; margin: 1.5rem; opacity: .5; background: url(images/a#icon.svg); }',
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'base', value: { type: 'Keyword', src: 'blue' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'theme', value: { type: 'VariableReference', name: 'base', lookup: 'live' }, write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'font', value: { type: 'Quoted', src: '"Inter"', value: 'Inter', quote: '"', escaped: false }, write: { mode: 'declare' } },
        // Value keywords deliberately preserve CSS escapes. `$` names above use
        // the SCSS-local unescaped terminal instead.
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
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card', interp: null }] }, tail: [] }]
          },
          body: [
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
    const direct = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'base', write: { mode: 'declare' } },
        { type: 'VariableDeclaration', name: 'fallback', write: { mode: 'if-absent', lookup: 'scoped' } },
        { type: 'VariableDeclaration', name: 'global', write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Rule', body: [{ type: 'Declaration', value: { type: 'VariableReference', name: 'base', lookup: 'live' } }] }
      ]
    });
    expect(parse(source)).toMatchObject({
      children: [
        { write: { mode: 'declare' } },
        { write: { mode: 'if-absent', lookup: 'scoped' } },
        { write: { mode: 'reassign', lookup: 'scoped' } },
        { type: 'Rule' }
      ]
    });

    for (const unsupported of ['$!base: blue;', 'theme.$base: blue;']) {
      expect(() => parse(unsupported), unsupported).toThrow(SyntaxError);
    }
  });

  it('constructs static custom-property tokens only as typed SCSS value leaves', () => {
    const source = '.card { direct: --theme; via-var: var(--theme, --fallback); via-env: env(--safe-area); via-calc: calc(--size + 1px); } @media (width: --viewport) { .media { color: red; } } @supports (display: --mode) { .support { color: blue; } }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [
        { type: 'Rule', body: [
          { type: 'Declaration', name: 'direct', value: { type: 'Keyword', src: '--theme' } },
          { type: 'Declaration', name: 'via-var', value: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--theme' }, { type: 'Keyword', src: '--fallback' }] } },
          { type: 'Declaration', name: 'via-env', value: { type: 'FunctionCall', name: 'env', args: [{ type: 'Keyword', src: '--safe-area' }] } },
          { type: 'Declaration', name: 'via-calc', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '+', left: { src: '--size' } }] } }
        ] },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue', parts: [{ type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', right: { type: 'Keyword', src: '--viewport' } } }] } },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':', right: { type: 'Keyword', src: '--mode' } } } }
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
      const direct = run(scssAstGrammar.ScssAstDocument, malformed, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), malformed).toBe(false);
    }
  });

  it('keeps the closed direct-fact grammar narrow', () => {
    for (const source of [
      '$ba\\se: blue;', '$base: $ba\\se;',
      '.card { color: #fffff; }', '.card { color: #1234567; }'
    ]) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs SCSS arithmetic precedence before assembling spaced and comma values', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '$base: 1 + 2 * 3; $nested: (1 + 2) * 3; $signed: -$base * 2; $spaced-signed: - $base * 2; $spaced-positive: + ($base); $minus-list: 1 -2; $legacy-plus: 1 +2; .card { compact: 17px-1px; sequence: 1 2 + 3; mixed: 1 + 2 red; ratio: 1 / 2; grouped-ratio: (1 / 2); calc-ratio: calc(1 / 2); mod: 7 % 3; }',
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'base', value: {
          type: 'Operation', operator: '+', left: { src: '1' }, right: {
            type: 'Operation', operator: '*', left: { src: '2' }, right: { src: '3' }
          }
        } },
        { type: 'VariableDeclaration', name: 'nested', value: {
          type: 'Operation', operator: '*', left: {
            type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '+' }
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
          type: 'Block', delimiter: 'paren', inner: { type: 'VariableReference', name: 'base' }
        } },
        { type: 'VariableDeclaration', name: 'minus-list', value: [{ src: '1' }, { src: '-2' }] },
        { type: 'VariableDeclaration', name: 'legacy-plus', value: { type: 'Operation', operator: '+' } },
        { type: 'Rule', body: [
          { name: 'compact', value: { type: 'Operation', operator: '-' } },
          { name: 'sequence', value: [{ src: '1' }, { type: 'Operation', operator: '+' }] },
          { name: 'mixed', value: [{ type: 'Operation', operator: '+' }, { src: 'red' }] },
          { name: 'ratio', value: { type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }] } },
          { name: 'grouped-ratio', value: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '/' } } },
          { name: 'calc-ratio', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'List', sep: '/', value: [{ src: '1' }, { src: '2' }] }] } },
          { name: 'mod', value: { type: 'Operation', operator: '%' } }
        ] }
      ]
    });
  });

  it('accepts the public optional final declaration semicolon', () => {
    for (const [source, expected] of [
      ['.card { color: blue }', { type: 'Rule' }]
    ] as const) {
      const cst = parseScssCst(source);
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      expect(result.value).toMatchObject({ type: 'Stylesheet', children: [expected] });
    }
  });

  it('constructs public SCSS declaration merge modifiers through Declaration.merge', () => {
    const source = '.card { font: Arial; font+: sans-serif; font+_: serif !important; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'font', merge: null, important: false },
        { type: 'Declaration', name: 'font', merge: ',', important: false },
        { type: 'Declaration', name: 'font', merge: ' ', important: true }
      ] }]
    });
  });

  it('lowers static SCSS nested properties to ordered existing declarations', () => {
    const source = '.card { font: { family: fantasy; weight: bold; } font: 20px { size: 1rem; } }';
    const cst = parseScssCst(source);
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [
          { type: 'Declaration', name: 'family', value: { src: 'fantasy' } },
          { type: 'Declaration', name: 'weight', value: { src: 'bold' }, important: false }
        ] } },
        { type: 'Declaration', name: 'font', value: { type: 'Collection', base: { src: '20px' }, entries: [
          { type: 'Declaration', name: 'size', value: { src: '1rem' } }
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
      const direct = run(scssAstGrammar.ScssAstDocument, unsupported, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), unsupported).toBe(false);
    }
  });

  it('lowers interpolated SCSS nested-property outer and leaf names directly', () => {
    const source = '$prefix: font; $part: weight; .card { #{$prefix}: { color: red; } font: { #{$part}: bold; } #{$prefix}: { #{$part}: 700; } }';
    const cst = parseScssCst(source);
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'VariableDeclaration', name: 'prefix' }, { type: 'VariableDeclaration', name: 'part' }, {
        type: 'Rule', body: [
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'prefix' } }] }, value: { type: 'Collection', entries: [
            { type: 'Declaration', name: 'color', value: { src: 'red' } }
          ] } },
          { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [
            { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'part' } }] }, value: { src: 'bold' } }
          ] } },
          { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'prefix' } }] }, value: { type: 'Collection', entries: [
            { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'part' } }] }, value: { src: '700' } }
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: 'font', important: true, value: { type: 'Collection', base: { src: '20px' }, entries: [
          { type: 'Declaration', name: 'size', important: false, value: { src: '1rem' } }
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'Rule', body: [
      { type: 'Declaration', name: 'font', value: { type: 'Collection', entries: [] } }
    ] }] });
    expect(serialize(stylesheet(result.value))).toEqual({ css: '' });
  });

  it('keeps CST-only nested-property body forms out of the direct lowering', () => {
    const cstValidButHeld = [
      '.card { font: { $weight: bold; } }',
      '.card { font: { theme.$weight: bold; } }',
      '.card { font: { @if true { weight: bold; } } }',
      '.card { font: { @each $weight in bold { weight: $weight; } } }',
      '.card { font: { @for $i from 1 through 1 { weight: $i; } } }',
      '.card { font: { @while false { weight: bold; } } }',
      '.card { font: { /* note */ weight: bold; } }'
    ];
    for (const source of cstValidButHeld) {
      const cst = parseScssCst(source);
      const direct = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'VariableDeclaration', name: 'tone' },
        { type: 'Rule', body: [
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

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', body: [
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ ref: { type: 'VariableReference', name: 'property' }, unquote: true }] } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: 'margin-' }, { ref: { type: 'VariableReference', name: 'side' }, unquote: true }] } },
        { type: 'Declaration', name: { type: 'Interpolation', parts: [{ lit: '--theme-' }, { ref: { type: 'VariableReference', name: 'mode' }, unquote: true }] } }
      ] }]
    });
  });

  it('keeps repeated, custom-property, and descriptor interpolation names structural and rejects malformed forms', () => {
    const source = '$property: color; $side: left; $mode: dark; $value: blue; .card { #{$property}: #{$value}; margin-#{$side}-#{$mode}: $value; --theme-#{$mode}: red; } @font-face { font-#{$side}: 1rem; }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      children: [
        { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, { type: 'VariableDeclaration' },
        { type: 'Rule', body: [
          { name: { type: 'Interpolation', parts: [{ ref: { name: 'property' } }] }, value: { type: 'Interpolation', parts: [{ ref: { name: 'value' } }] } },
          { name: { type: 'Interpolation', parts: [{ lit: 'margin-' }, { ref: { name: 'side' } }, { lit: '-' }, { ref: { name: 'mode' } }] }, value: { type: 'VariableReference', name: 'value' } },
          { name: { type: 'Interpolation', parts: [{ lit: '--theme-' }, { ref: { name: 'mode' } }] } }
        ] },
        { type: 'AtRuleBlock', name: '@font-face', body: [{ name: { type: 'Interpolation', parts: [{ lit: 'font-' }, { ref: { name: 'side' } }] } }] }
      ]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card {\n  color: blue;\n  margin-left-dark: blue;\n  --theme-dark: red;\n}\n@font-face {\n  font-left: 1rem;\n}\n'
    );
    for (const malformed of ['.card { #{}: red; }', '.card { margin-#{}: red; }', '.card { --theme-#{}: red; }']) {
      const rejected = run(scssAstGrammar.ScssAstDocument, malformed, { trivia: scssAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null, malformed).toBe(false);
    }
  });

  it('constructs nested SCSS rules and scoped variables directly', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '.card { $accent: #00f; color: $accent; .title { color: blue; } }',
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card', interp: null }] }, tail: [] }]
        },
        body: [
          { type: 'VariableDeclaration', name: 'accent', value: { type: 'Color', src: '#00f' }, write: { mode: 'declare' } },
          { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'accent', lookup: 'live' }, merge: null, important: false },
          {
            type: 'Rule',
            selector: {
              type: 'SelectorList',
              selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.title', interp: null }] }, tail: [] }]
            },
            body: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' }, merge: null, important: false }]
          }
        ]
      }]
    });
  });

  it('preserves public-SCSS block and line comments as direct AST statements', () => {
    const source = '// root\n$theme: blue; /* between */ .card { // inside\n color: $theme; /* tail */ }';
    expect(parseScssCst(source).errors).toHaveLength(0);
    const result = run(
      scssAstGrammar.ScssAstDocument,
      source,
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Comment', text: '// root' },
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'Comment', text: '/* between */' },
        {
          type: 'Rule',
          body: [
            { type: 'Comment', text: '// inside' },
            { type: 'Declaration', name: 'color' },
            { type: 'Comment', text: '/* tail */' }
          ]
        }
      ]
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' }, body: [{ type: 'Comment' }, { type: 'Rule' }] },
        { type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'only' }, { type: 'Keyword', src: 'screen' }] }, body: [{ type: 'Rule' }] },
        { type: 'AtRuleBlock', name: '@supports', prelude: { type: 'SpacedValue' }, body: [{ type: 'Rule' }] },
        { type: 'AtRuleBlock', name: '@container', prelude: { type: 'SpacedValue' }, body: [{ type: 'Rule' }] },
        { type: 'Rule', body: [{ type: 'AtRuleBlock', name: '@media', body: [{ type: 'VariableDeclaration' }, { type: 'Declaration' }] }] }
      ]
    });
  });

  it('documents the intentional CST-only SCSS query-interpolation route until the AST has typed prelude segments', () => {
    for (const source of [
      '@media #{$query} { .card { color: red; } }',
      '@container #{$container-query} { .card { color: red; } }'
    ]) {
      const cst = parseScssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();

      const direct = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), source).toBe(false);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('accepts `only` only as a media-type modifier', () => {
    expect(parse('@media only screen and (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' } }]
    });
    expect(() => parse('@media only (min-width: 1px) { .card { color: red; } }')).toThrow(SyntaxError);
    expect(parse('@media not (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@media' }]
    });
  });

  it('keeps public @supports to typed static conditions, not query-function or dynamic raw payloads', () => {
    const source = '@supports not ((display: grid) and (color)) { .card { color: blue; } }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@supports',
        prelude: {
          type: 'SpacedValue',
          parts: [{ type: 'Keyword', src: 'not' }, { type: 'Block', delimiter: 'paren', inner: { type: 'SpacedValue' } }]
        }
      }]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@supports not ((display: grid) and (color)) {\n  .card {\n    color: blue;\n  }\n}\n'
    );

    const escapedQuoted = run(
      scssAstGrammar.ScssAstDocument,
      '@supports (font-family: "A  \\"B\\"") { .card { color: blue; } }',
      { trivia: scssAstGrammar.whitespace }
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
      const query = run(scssAstGrammar.ScssAstDocument, querySource, { trivia: scssAstGrammar.whitespace });
      expect(query.ok && query.unconsumedFrom === null && isStylesheet(query.value), querySource).toBe(true);
    }

    for (const invalid of [
      '@supports (display: grid), (color: blue) { .card { color: blue; } }'
    ]) {
      const rejected = run(scssAstGrammar.ScssAstDocument, invalid, { trivia: scssAstGrammar.whitespace });
      expect(rejected.ok && rejected.unconsumedFrom === null && isStylesheet(rejected.value), invalid).toBe(false);
    }
  });

  it('constructs descriptor-only @font-face blocks with existing direct declaration values', () => {
    const source = '@font-face { font-family: $font; src: url("font.woff2"); }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'AtRuleBlock', name: '@font-face', prelude: null, body: [
      { type: 'Declaration', name: 'font-family', value: { type: 'VariableReference', name: 'font' } },
      { type: 'Declaration', name: 'src', value: { type: 'Url', value: { type: 'Quoted', value: 'font.woff2' } } }
    ] }] });
  });

  it('rejects nested rules in @font-face', () => {
    for (const source of ['@font-face { .nested { color: red; } }']) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs descriptor-only @counter-style blocks with a typed name prelude', () => {
    const source = '@counter-style thumbs { system: cyclic; symbols: "👍"; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'AtRuleBlock', name: '@counter-style', prelude: { type: 'Keyword', src: 'thumbs' }, body: [{ type: 'Declaration', name: 'system' }, { type: 'Declaration', name: 'symbols' }] }] });
  });

  it('rejects nested rules in @counter-style', () => {
    for (const source of ['@counter-style thumbs { .nested { color: red; } }']) {
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
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

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@PAGE', prelude: { type: 'Any', src: 'report:left' }, body: [
          { type: 'Comment', text: '/* page */' },
          { type: 'Declaration', name: 'size' },
          ...names.map(name => ({ type: 'AtRuleBlock', name: `@${name}`, prelude: null, body: [{ type: 'Declaration', name: 'content' }] }))
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
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('keeps static @page facts reachable through the existing selected @if body', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '@if true { @page appendix { size: letter; } }',
      { trivia: scssAstGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'If', branches: [{ body: [{
        type: 'AtRuleBlock', name: '@page', prelude: { type: 'Any', src: 'appendix' }, body: [{ type: 'Declaration', name: 'size' }]
      }] }] }]
    });
  });

  it('constructs static @document headers and recursive frame-one bodies directly', () => {
    const source = '@-moz-document url-prefix("https://example.test/"), domain("example.test") { @font-face { font-family: Demo; } .card { color: red; } @document regexp("nested") { .inside { color: blue; } } }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
        type: 'AtRuleBlock', name: '@-moz-document',
        prelude: { type: 'Any', src: 'url-prefix("https://example.test/"), domain("example.test")' },
        body: [
          { type: 'AtRuleBlock', name: '@font-face' },
          { type: 'Rule' },
          { type: 'AtRuleBlock', name: '@document', prelude: { type: 'Any', src: 'regexp("nested")' }, body: [{ type: 'Rule' }] }
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
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs descriptor-only @property blocks with a typed custom-property prelude', () => {
    const source = '@property --accent { /* descriptor */ syntax: "<color>"; inherits: false; initial-value: red; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@property', prelude: { type: 'Keyword', src: '--accent' }, body: [
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
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
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
      expect(parseScssCst(source).errors.length).toBeGreaterThan(0);
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
    const onlyContainer = '@container only screen { .bad { color: red; } }';
    const onlyContainerResult = run(scssAstGrammar.ScssAstDocument, onlyContainer, { trivia: scssAstGrammar.whitespace });
    expect(onlyContainerResult.ok && onlyContainerResult.unconsumedFrom === null && isStylesheet(onlyContainerResult.value), onlyContainer).toBe(false);
  });

  it('matches the public parser rejection of an unterminated block comment', () => {
    const source = '.card { color: red; /* unterminated';
    expect(parseScssCst(source).errors.length).toBeGreaterThan(0);
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('constructs static SCSS selector lists, compounds, pseudos, and nesting selectors directly', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '.card.featured:hover, #hero::before { color: blue; &.active { color: red; } }',
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ text: '.card' }, { text: '.featured' }, { text: ':hover' }] } },
            { type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ text: '#hero' }, { text: '::before' }] } }
          ]
        },
        body: [{ type: 'Declaration', name: 'color' }, {
          type: 'Rule',
          selector: { type: 'SelectorList', selectors: [{ head: { simples: [{ text: '&' }, { text: '.active' }] } }] }
        }]
      }]
    });
  });

  it('constructs public static selector combinators as canonical ComplexSelector tails', () => {
    const source = '.card > .icon + svg ~ .badge || .part, .menu .item { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [
        { head: { simples: [{ text: '.card' }] }, tail: [
          { comb: '>', compound: { simples: [{ text: '.icon' }] } },
          { comb: '+', compound: { simples: [{ text: 'svg' }] } },
          { comb: '~', compound: { simples: [{ text: '.badge' }] } },
          { comb: '||', compound: { simples: [{ text: '.part' }] } }
        ] },
        { head: { simples: [{ text: '.menu' }] }, tail: [{ comb: ' ', compound: { simples: [{ text: '.item' }] } }] }
      ] } }]
    });
  });

  it('constructs public static attribute selectors as canonical selector simples', () => {
    const source = '.card[data-state="open" i][lang|=en] { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.card' },
        { type: 'SimpleSelector', text: '[data-state="open"i]' },
        { type: 'SimpleSelector', text: '[lang|=en]' }
      ] } }] } }]
    });
  });

  it('rejects namespaced attribute selectors until their namespace fact has a canonical AST field', () => {
    const source = '.card[svg|href] { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('constructs static selector-valued pseudo arguments as structured PseudoSelector args (core owns the join)', () => {
    const source = '.card:not(.disabled, [aria-hidden=true]) { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    // Parser keeps the parsed `SelectorList` as `args`; `text` is null (the
    // inline join is core serialization's job, spaced). `:not` structures but is
    // sealed (crossable:false).
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.card' },
        {
          type: 'PseudoSelector', name: ':not', text: null, crossable: false, interp: null,
          args: { type: 'SelectorList', selectors: [
            { head: { simples: [{ type: 'SimpleSelector', text: '.disabled' }] } },
            { head: { simples: [{ type: 'SimpleSelector', text: '[aria-hidden=true]' }] } }
          ] }
        }
      ] } }] } }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card:not(.disabled, [aria-hidden=true]) {\n  color: blue;\n}\n'
    );
  });

  it('structures whitelisted selector-arg pseudos and leaves interp / non-whitelist pseudos unchanged', () => {
    // (1) `:is` structures: `args` is a real SelectorList, `text` is null, and it
    // is crossable. Authored spacing does NOT matter — core serialization joins
    // with `, ` on one line, so `:is(.a,.b)` and `:is(.a, .b)` both round-trip to
    // the spaced canonical form.
    const structured = run(scssAstGrammar.ScssAstDocument, '.x:is(.a, .b) { color: red; }', { trivia: scssAstGrammar.whitespace });
    expect(structured.ok && structured.unconsumedFrom === null).toBe(true);
    expect(structured.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.x' },
        {
          type: 'PseudoSelector', name: ':is', text: null, crossable: true, interp: null,
          args: { type: 'SelectorList', selectors: [
            { head: { simples: [{ type: 'SimpleSelector', text: '.a' }] } },
            { head: { simples: [{ type: 'SimpleSelector', text: '.b' }] } }
          ] }
        }
      ] } }] } }]
    });
    // The parser produces STRUCTURE + trivia only: it never joins, so the head
    // compound's serializer-owned `_canon` memo is still unset at parse time.
    let canonBeforeSerialize: string | undefined = 'unset-marker';
    if (isStylesheet(structured.value)) {
      const first = structured.value.children[0];
      if (first?.type === 'Rule') {
        canonBeforeSerialize = first.selector.selectors[0]?.head._canon;
      }
    }
    expect(canonBeforeSerialize).toBeUndefined();
    for (const [source, expected] of [
      ['.x:is(.a,.b) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n'],
      ['.x:is(.a, .b) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n']
    ] as const) {
      const rt = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(isStylesheet(rt.value) ? serialize(rt.value).css : undefined, source).toBe(expected);
    }

    // (2) `:where` structures too, but is SEALED (crossable:false).
    const sealed = run(scssAstGrammar.ScssAstDocument, '.x:where(.a, .b) { color: red; }', { trivia: scssAstGrammar.whitespace });
    expect(sealed.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'PseudoSelector', name: ':where', text: null, crossable: false }
      ] } }] } }]
    });

    // (3) An interpolation-bearing whitelisted pseudo arg is NOT structured — the
    // static-arg lookahead fails on `#{`, so it degrades to the unchanged path
    // (rejected today, still rejected). `:global` is not whitelisted, so it stays
    // opaque SimpleSelector text.
    const interp = run(scssAstGrammar.ScssAstDocument, '.x:is(#{$sel}) { color: red; }', { trivia: scssAstGrammar.whitespace });
    expect(interp.ok && interp.unconsumedFrom === null && isStylesheet(interp.value)).toBe(false);
    const opaque = run(scssAstGrammar.ScssAstDocument, '.x:global(.a) { color: red; }', { trivia: scssAstGrammar.whitespace });
    expect(opaque.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'SimpleSelector', text: ':global(.a)' }
      ] } }] } }]
    });
  });

  it('constructs static non-selector pseudo arguments as existing SimpleSelector text', () => {
    const source = '.card:lang(en-US):nth-child(-n+2 of .item)::part(icon) { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [{ head: { simples: [
        { type: 'SimpleSelector', text: '.card' },
        { type: 'SimpleSelector', text: ':lang(en-US)' },
        { type: 'SimpleSelector', text: ':nth-child(-n+2 of .item)' },
        { type: 'SimpleSelector', text: '::part(icon)' }
      ] } }] } }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.card:lang(en-US):nth-child(-n+2 of .item)::part(icon) {\n  color: blue;\n}\n'
    );

    for (const invalid of [
      '.card:nth-child(2n +) { color: blue; }',
      '.card:nth-child(1.5) { color: blue; }',
      '.card:lang(#{$locale}) { color: blue; }',
      '.card:part(icon-#{$name}) { color: blue; }'
    ]) {
      const direct = run(scssAstGrammar.ScssAstDocument, invalid, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('constructs ordinary SCSS interpolated simple selectors as existing typed SimpleSelector facts', () => {
    const source = '$name: button; $state: active; .#{$name}-#{$state}, #item-#{$name} { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'VariableDeclaration' }, { type: 'VariableDeclaration' }, {
        type: 'Rule', selector: { selectors: [
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '.' }, { ref: { type: 'VariableReference', name: 'name', lookup: 'live' }, unquote: true },
            { lit: '-' }, { ref: { type: 'VariableReference', name: 'state', lookup: 'live' }, unquote: true }
          ] } }] } },
          { head: { simples: [{ type: 'SimpleSelector', text: null, interp: { type: 'Interpolation', parts: [
            { lit: '#item-' }, { ref: { type: 'VariableReference', name: 'name', lookup: 'live' }, unquote: true }
          ] } }] } }
        ] }
      }]
    });
    expect(isStylesheet(result.value) ? serialize(result.value).css : undefined).toBe(
      '.button-active,\n#item-button {\n  color: blue;\n}\n'
    );
  });

  it('rejects interpolation-bearing pseudo arguments until their segments are represented in AST v2', () => {
    const source = '.card:not(#{$disabled}) { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('constructs static SCSS placeholder selectors as canonical selector simples', () => {
    const source = '%notice { color: blue; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{ type: 'Rule', selector: { selectors: [
        { head: { simples: [{ type: 'SimpleSelector', text: '%notice' }] } }
      ] } }]
    });
  });

  it('rejects interpolation-bearing placeholder names rather than flattening their source', () => {
    const source = '%#{$name} { color: blue; }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value)).toBe(false);
  });

  it('matches the public placeholder selector boundary', () => {
    const compound = '.card %notice { color: blue; }';
    const compoundCst = parseScssCst(compound);
    expect(compoundCst.errors).toHaveLength(0);
    expect(compoundCst.unconsumedFrom).toBeNull();
    const compoundResult = run(scssAstGrammar.ScssAstDocument, compound, { trivia: scssAstGrammar.whitespace });
    expect(compoundResult.ok && compoundResult.unconsumedFrom === null && isStylesheet(compoundResult.value)).toBe(true);

    const list = '%notice, .card { color: blue; }';
    const listCst = parseScssCst(list);
    expect(listCst.unconsumedFrom).not.toBeNull();
    const listResult = run(scssAstGrammar.ScssAstDocument, list, { trivia: scssAstGrammar.whitespace });
    expect(listResult.ok && listResult.unconsumedFrom === null && isStylesheet(listResult.value)).toBe(false);
  });

  it('constructs a case-insensitive declaration priority directly', () => {
    const result = run(
      scssAstGrammar.ScssAstDocument,
      '.card { color: blue !IMPORTANT; }',
      { trivia: scssAstGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{ type: 'ComplexSelector', head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card', interp: null }] }, tail: [] }]
        },
        body: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'blue' }, merge: null, important: true }]
      }]
    });
  });

  it('hoists static SCSS @extend targets onto the carrying canonical Rule', () => {
    const source = '.base { color: blue; } .button { @extend .base; color: red; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '.base' }] } }] } },
        {
          type: 'Rule',
          selector: { selectors: [{ head: { simples: [{ text: '.button' }] } }] },
          extendInstructions: [{
            partial: false,
            target: { type: 'SelectorList', selectors: [{ head: { simples: [{ text: '.base' }] } }] }
          }],
          body: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
        }
      ]
    });
  });

  it('rejects @extend !optional until its diagnostic semantics have a typed AST field', () => {
    const source = '.button { @extend .base !optional; }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
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

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [
        {
          type: 'MixinDef', name: 'paint',
          params: [
            { name: 'color' },
            { name: 'gap', default: { type: 'Dimension', number: 2, unit: 'px', src: '2px' } },
            { name: 'rest', rest: true }
          ],
          body: [
            { type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'color' } },
            { type: 'Declaration', name: 'margin', value: { type: 'VariableReference', name: 'gap' } },
            { type: 'MixinCall', name: 'normalize', args: [{ value: { type: 'Dimension', number: 0, unit: '', src: '0' } }], path: [], important: false },
            { type: 'Rule', body: [{ type: 'Declaration', name: 'padding' }] }
          ]
        },
        {
          type: 'Rule', body: [{
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
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock', name: '@media', body: [
          { type: 'MixinDef', name: 'local', params: [{ name: 'width', default: { type: 'Dimension', number: 1, unit: 'px' } }], body: [{ type: 'Declaration', name: 'width' }] },
          { type: 'MixinCall', name: 'outer', args: [{ value: { type: 'Dimension', number: 2, unit: 'px' } }] },
          { type: 'Rule', body: [{ type: 'MixinCall', name: 'local', args: [] }] }
        ]
      }]
    });
  });

  it('constructs static SCSS @each loops as canonical For nodes', () => {
    const source = '@each $tone in red blue { .swatch { color: $tone; } }';
    const cst = parseScssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'For', binding: { kind: 'single', name: 'tone' },
        iterable: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }],
        rules: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color', value: { type: 'VariableReference', name: 'tone' } }] }]
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

      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok).toBe(true);
      expect(result.unconsumedFrom).toBeNull();
      expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{ type: 'For', binding }] });
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

      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      const first = stylesheet(result.value).children[0];
      const loop = source.startsWith('.host')
        ? first?.type === 'Rule' && first.body[0]
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

    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet', children: [{
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
      const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
      expect(result.ok && result.unconsumedFrom === null && isStylesheet(result.value), source).toBe(false);
    }
  });

  it('constructs static CSS statement at-rules through the existing AtRuleStatement fact', () => {
    const source = '@charset "UTF-8"; @namespace svg url("https://example.test/svg"); @layer theme;';
    const cst = parseScssCst(source);
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [
      { type: 'AtRuleStatement', name: '@charset', prelude: { type: 'Any', src: '"UTF-8"' } },
      { type: 'AtRuleStatement', name: '@namespace', prelude: { type: 'Any', src: 'svg url("https://example.test/svg")' } },
      { type: 'AtRuleStatement', name: '@layer', prelude: { type: 'Any', src: 'theme' } }
    ] });
    expect(serialize(stylesheet(result.value))).toEqual({
      css: '@charset "UTF-8";\n@namespace svg url("https://example.test/svg");\n@layer theme;\n'
    });

    const lineComment = run(scssAstGrammar.ScssAstDocument, '@layer theme // local note\n;', { trivia: scssAstGrammar.whitespace });
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
      const direct = run(scssAstGrammar.ScssAstDocument, invalid, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('constructs static CSS @scope blocks through the existing AtRuleBlock fact', () => {
    const source = '@scope (.card) to (.card > .title) { .item { color: red; } }';
    const result = run(scssAstGrammar.ScssAstDocument, source, { trivia: scssAstGrammar.whitespace });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet', children: [{
      type: 'AtRuleBlock', name: '@scope', prelude: { type: 'Any', src: '(.card) to (.card > .title)' },
      body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'color' }] }]
    }] });

    for (const invalid of [
      '@scope #{scope} { .item { color: red; } }',
      '@scope (.card #{$part}) { .item { color: red; } }'
    ]) {
      const direct = run(scssAstGrammar.ScssAstDocument, invalid, { trivia: scssAstGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null && isStylesheet(direct.value), invalid).toBe(false);
    }
  });

  it('retains authored comments and multiline indentation on raw ValueSlot boundaries', () => {
    const document = parse('.a { color: red /* keep */\n  blue; shadow: a,\n  b; }');
    const body = document.children[0];
    if (body?.type !== 'Rule') {
      throw new Error('expected an SCSS rule');
    }
    const adjacent = body.body[0]?.type === 'Declaration' ? body.body[0].value : null;
    const comma = body.body[1]?.type === 'Declaration' ? body.body[1].value : null;
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

  // SCSS→Jess lowering (parse/AST-shape correctness; evaluator rendering of the
  // shared Collection/accessor/lambda is a separate downstream concern).
  it('lowers SCSS map literals to the shared Collection node', () => {
    expect(parse('$m: (a: 1, b: 2);')).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration', name: 'm', write: { mode: 'declare' },
        value: {
          type: 'Collection', entries: [
            { type: 'Declaration', name: 'a', value: { type: 'Dimension', number: 1, unit: '', src: '1' }, merge: null, important: false },
            { type: 'Declaration', name: 'b', value: { type: 'Dimension', number: 2, unit: '', src: '2' }, merge: null, important: false }
          ]
        }
      }]
    });

    // Empty `()` and a single `(a: 1)` are maps too.
    expect(parse('$m: ();').children[0]).toMatchObject({ value: { type: 'Collection', entries: [] } });
    expect(parse('$m: (a: 1);').children[0]).toMatchObject({ value: { type: 'Collection', entries: [{ type: 'Declaration', name: 'a' }] } });

    // A quoted-string key lowers to the entry name; a space-list value stays a
    // structured value slot.
    expect(parse('$m: ("k": 1px solid);').children[0]).toMatchObject({
      value: { type: 'Collection', entries: [{ type: 'Declaration', name: 'k', value: [{ type: 'Dimension', src: '1px' }, { type: 'Keyword', src: 'solid' }] }] }
    });

    // A paren value-list (no `key:` entry) stays a Block list, never a Collection.
    expect(parse('$m: (1 2 3);').children[0]).toMatchObject({ value: { type: 'Block', delimiter: 'paren' } });
    expect(parse('$m: (1 + 2);').children[0]).toMatchObject({ value: { type: 'Block', inner: { type: 'Operation' } } });
  });

  it('lowers SCSS map-get to the shared $[…] accessor read', () => {
    // `map-get($m, a)` => `$m[a]`: a Reference whose single BracketLookup step
    // carries the key (member lookup for a value key, var lookup for `$k`).
    expect(parse('.x { color: map-get($m, a); }').children[0]).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'Declaration', name: 'color',
        value: {
          type: 'Reference',
          base: { type: 'VariableReference', name: 'm', lookup: 'live' },
          steps: [{ type: 'BracketLookup', key: { type: 'Keyword', src: 'a' }, keyKind: 'member' }],
          raw: '$m[a]'
        }
      }]
    });

    expect(parse('.x { color: map-get($m, $k); }').children[0]).toMatchObject({
      body: [{ value: { type: 'Reference', steps: [{ type: 'BracketLookup', key: { type: 'VariableReference', name: 'k' }, keyKind: 'var' }], raw: '$m[$k]' } }]
    });

    // A non-canonical arity stays a plain FunctionCall for `fns` routing.
    expect(parse('.x { color: map-get($m); }').children[0]).toMatchObject({
      body: [{ value: { type: 'FunctionCall', name: 'map-get' } }]
    });
  });

  it('lowers a user SCSS @function to a $var-bound anonymous mixin whose @return is result:', () => {
    // A zero-parameter function lowers completely: `$two: @() > { result: 2 }`.
    expect(parse('@function two() { @return 2; }')).toEqual({
      type: 'Stylesheet',
      children: [{
        type: 'VariableDeclaration', name: 'two', write: { mode: 'declare' },
        value: {
          type: 'AnonymousMixin',
          body: [{ type: 'Declaration', name: 'result', value: { type: 'Dimension', number: 2, unit: '', src: '2' }, merge: null, important: false }]
        }
      }]
    });

    // A parameterized function still lowers to the var-bound lambda + `result:`;
    // the `($n)` parameter list is currently DROPPED — `AnonymousMixin` has no
    // `params` field (see the accompanying gap report).
    expect(parse('@function double($n) { @return $n * 2; }').children[0]).toMatchObject({
      type: 'VariableDeclaration', name: 'double',
      value: {
        type: 'AnonymousMixin',
        body: [{ type: 'Declaration', name: 'result', value: { type: 'Operation', operator: '*', left: { type: 'VariableReference', name: 'n' } } }]
      }
    });
  });
});
