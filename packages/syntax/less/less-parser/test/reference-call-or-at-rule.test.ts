import { describe, expect, it } from 'vitest';
import type { AtRuleBlock, AtRuleStatement, Reference, UnknownAtRuleBlock } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/**
 * `@name (…)` reads as one head, and the next token decides. `;`, `}` or the end
 * of input leaves a call; a `{` or more prelude makes it an at-rule, whose prelude
 * starts with the head's bytes (ledger P2, P52).
 */
type Statement = AtRuleBlock | AtRuleStatement | Reference | UnknownAtRuleBlock;

function first(source: string): Statement {
  const [statement] = parse(source).rules;
  return statement as Statement;
}

function preludeOf(statement: Statement): unknown {
  return statement.type === 'AtRuleBlock' || statement.type === 'AtRuleStatement'
    ? statement.prelude
    : undefined;
}

describe('Less `@name (…)` is an at-rule when a block or more prelude follows', () => {
  it.each([
    ['@foo (a) { c: d }', '@foo', '(a)'],
    ['@foo () { c: d }', '@foo', '()'],
    ['@foo ((a: b)) { c: d }', '@foo', '((a: b))'],
    ['@-moz-document (a) { a { b: c } }', '@-moz-document', '(a)'],
    ['@keyframes (a) { }', '@keyframes', '(a)'],
    ['@layer (a) { c: d }', '@layer', '(a)'],
    ['@foo (a) b { c: d }', '@foo', '(a) b'],
    ['@foo (a: b) { c: d }', '@foo', '(a: b)'],
    ['@foo(a: b) { c: d }', '@foo', '(a: b)'],
    ['@foo (a: b) and (c: d) { e: f }', '@foo', '(a: b) and (c: d)'],
    ['@foo (a: b), (c: d) { e: f }', '@foo', '(a: b), (c: d)'],
    ['@page (a: b) { c: d }', '@page', '(a: b)'],
    ['@font-face (a: b) { c: d }', '@font-face', '(a: b)'],
    ['@position-try (a: b) { c: d }', '@position-try', '(a: b)'],
    ['@document (a: b) { a { b: c } }', '@document', '(a: b)'],
    ['@-moz-whatever (foo: "(" bam ")") {\n  bar: foo;\n}', '@-moz-whatever', '(foo: "(" bam ")")'],
    ['@foo.bar (a) { c: d }', '@foo', '.bar (a)'],
    ['@foo(a)(b) { c: d }', '@foo', '(a)(b)'],
    ['@foo (a > b) { c: d }', '@foo', '(a > b)']
  ])('%s', (source, name, prelude) => {
    expect(first(source)).toMatchObject({
      type: 'AtRuleBlock',
      name,
      prelude: { type: 'Any', src: prelude }
    });
  });

  it('keeps one statement and the whole body', () => {
    const { rules } = parse('@foo (a) b { c: d; e { f: g } } h { i: j }');
    expect(rules.map(rule => rule.type)).toEqual(['AtRuleBlock', 'Ruleset']);
    expect((rules[0] as AtRuleBlock).rules.map(rule => rule.type)).toEqual(['Declaration', 'Ruleset']);
  });

  it('reads the same inside a ruleset', () => {
    const [ruleset] = parse('.x { @foo (a) { c: d } }').rules;
    expect(ruleset).toMatchObject({ rules: [{ type: 'AtRuleBlock', name: '@foo', prelude: { src: '(a)' } }] });
  });

  it('drops a comment and keeps one space for the gap, as any prelude does', () => {
    expect(preludeOf(first('@foo /* c */ (a) /* d */ b { c: d }'))).toMatchObject({ src: '(a) b' });
    expect(preludeOf(first('@foo (a /* c */ b) { c: d }'))).toMatchObject({ src: '(a /* c */ b)' });
  });

  it('keeps a glued continuation glued', () => {
    expect(preludeOf(first('@foo (a)b { c: d }'))).toMatchObject({ src: '(a)b' });
    expect(preludeOf(first('@foo (a), (b);'))).toMatchObject({ src: '(a), (b)' });
  });

  it('collapses the head\'s layout as a prelude group does', () => {
    expect(preludeOf(first('@foo (a   b) { c: d }'))).toMatchObject({ src: '(a b)' });
  });

  it('interpolates `@{…}` in the rest of the prelude, and only there', () => {
    expect(preludeOf(first('@foo (a) @{b} { c: d }'))).toMatchObject({
      type: 'Interpolation',
      parts: [{ lit: '(a) ' }, { ref: { name: 'b' } }]
    });
    expect(preludeOf(first('@foo (a) b@{c} { d: e }'))).toMatchObject({ type: 'Interpolation' });
  });

  it('reports a bare `@name` in the rest of the prelude (ledger P7)', () => {
    expect(() => parse('@foo (a) @b { c: d }')).toThrow(/Bare @variable/);
  });

  it.each([
    '@foo (@b) { c: d }',
    '@foo (a @b) { c: d }',
    '@foo (a, @b) { c: d }',
    '@foo (fn(@b)) { c: d }',
    '@foo (@b) c;'
  ])('reports a bare `@name` in the head of an at-rule (ledger P7): %s', (source) => {
    expect(() => parse(source)).toThrow(/Bare @variable/);
  });

  it('leaves a bare `@name` to the call when the head stays a call', () => {
    expect(first('@foo (@b);')).toMatchObject({ type: 'Reference' });
  });

  it('keeps a named argument in the head as written', () => {
    expect(preludeOf(first('@foo (a: @b) { c: d }'))).toMatchObject({ src: '(a: @b)' });
    expect(preludeOf(first('@foo (@a: @b) { c: d }'))).toMatchObject({ src: '(@a: @b)' });
  });

  it('carries a `@{…}` in the head as the group it read', () => {
    expect(preludeOf(first('@foo (@{b}) { c: d }'))).toMatchObject({
      type: 'Block',
      value: { type: 'Interpolation', parts: [{ ref: { name: 'b' } }] }
    });
    expect(preludeOf(first('@foo ("@{b}") c { d: e }'))).toMatchObject({
      type: 'Sequence',
      parts: [{ type: 'Block', value: { type: 'Quoted' } }, { src: 'c' }]
    });
  });

  it('is an at-rule statement when more prelude runs to `;`', () => {
    expect(first('@foo (a) b;')).toMatchObject({
      type: 'AtRuleStatement',
      name: '@foo',
      prelude: { type: 'Any', src: '(a) b' }
    });
  });

  it('keeps a body that is not a block as opaque bytes', () => {
    expect(first('@foo (a) b { $$$ %% }')).toMatchObject({
      type: 'UnknownAtRuleBlock',
      name: '@foo',
      prelude: '(a) b',
      rawBody: ' $$$ %% '
    });
    expect(first('@foo (a) {}')).toMatchObject({ type: 'AtRuleBlock', prelude: { src: '(a)' } });
  });
});

describe('Less `@name (…)` is a call before `;`, `}` or the end of input', () => {
  it.each([
    ['@rules();', '@rules()'],
    ['@rules ();', '@rules()'],
    ['@rules(1px);', '@rules(1px)'],
    ['@rules (1px);', '@rules(1px)'],
    ['@rules()', '@rules()'],
    ['@rules() ', '@rules()'],
    ['@rules()\n/* last */\n', '@rules()'],
    ['@theme.elevate(3px);', '@theme.elevate(3px)'],
    ['@map[key]();', '@map[key]()'],
    ['@rules()();', '@rules()()']
  ])('%s', (source, raw) => {
    expect(first(source)).toMatchObject({ type: 'Reference', raw });
  });

  it('reads a call before a closing brace', () => {
    const [ruleset] = parse('.x { @rules() }').rules;
    expect(ruleset).toMatchObject({ rules: [{ type: 'Reference', raw: '@rules()' }] });
  });

  it('reads two statements when `;` separates them', () => {
    expect(parse('@a(); @b { c: d }').rules.map(rule => rule.type)).toEqual(['Reference', 'AtRuleBlock']);
  });
});

describe('at-keywords with statements of their own stay out of the generic reading', () => {
  it.each([
    ['@import (a) b;'],
    ['@compose (a) b;'],
    ['@use (a) b;'],
    ['@charset (a) b;']
  ])('%s is still refused', (source) => {
    expect(() => parse(source)).toThrow();
  });

  it.each([
    ['@import (a);', '@import(a)'],
    ['@charset (a);', '@charset(a)']
  ])('%s still reads as it did', (source, raw) => {
    expect(first(source)).toMatchObject({ type: 'Reference', raw });
  });
});
