import { describe, expect, it } from 'vitest';
import type { AtRuleBlock, AtRuleStatement, Reference, UnknownAtRuleBlock } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/**
 * `@name (…)` reads as one head, and the next token decides. `;`, `}`, the end of
 * input or an at-keyword leaves a call; a `{` or anything else makes it an at-rule,
 * whose prelude starts with the head's bytes (ledger P2, P52).
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
    ['@foo (a) b { c: d }', '@foo', '(a) b'],
    ['@foo (a: b) { c: d }', '@foo', '(a: b)'],
    ['@foo(a: b) { c: d }', '@foo', '(a: b)'],
    ['@foo (a: b) and (c: d) { e: f }', '@foo', '(a: b) and (c: d)'],
    ['@foo (a: b), (c: d) { e: f }', '@foo', '(a: b), (c: d)'],
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

  it('interpolates `@{…}` in the rest of the prelude', () => {
    expect(preludeOf(first('@foo (a) @{b} { c: d }'))).toMatchObject({
      type: 'Interpolation',
      parts: [{ lit: '(a) ' }, { ref: { name: 'b' } }]
    });
    expect(preludeOf(first('@foo (a) b@{c} { d: e }'))).toMatchObject({ type: 'Interpolation' });
  });

  it.each([
    ['@foo ("@{b}") c { d: e }', 0],
    ['@foo ("@{b}") { $$$ %% }', 0],
    ['@foo (a) b (@{c}) { d: e }', 9],
    ['@foo (a) "@{b}";', 9],
    ['@foo (a) url(@{b}) { c: d }', 9],
    ['@foo (a) fn(@{b}) { c: d }', 9],
    ['@foo (a) @{b} (@{c}) { d: e }', 9],
    ['@foo (a) @{b} { $$$ %% }', 9]
  ])('never keeps a `@{…}` it cannot resolve as text: %s', (source, offset) => {
    let thrown: unknown;
    try {
      parse(source);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'parse/unresolved-prelude-interpolation', offset });
  });

  it('drops the report with an at-rule the parse did not keep', () => {
    expect(first('@foo x { @bar (a) "@{b}"; $$$ }')).toMatchObject({ type: 'UnknownAtRuleBlock' });
  });

  it.each([
    '@foo (@{b}) { c: d }',
    '@foo (@{b}, c) { d: e }',
    '@foo (@{b}...) { d: e }',
    '@foo (@{b}) { $$$ %% }',
    '@foo (url(@{b})) { c: d }'
  ])('stays the error a call\'s `@{…}` argument is: %s', (source) => {
    expect(() => parse(source)).toThrow(/cannot represent Interpolation/);
  });

  it('reports a bare `@name` in the rest of the prelude (ledger P7)', () => {
    expect(() => parse('@foo (a) c @b { d: e }')).toThrow(/Bare @variable/);
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

  it('is an at-rule statement when more prelude runs to `;`', () => {
    expect(first('@foo (a) b;')).toMatchObject({
      type: 'AtRuleStatement',
      name: '@foo',
      prelude: { type: 'Any', src: '(a) b' }
    });
  });

  it.each([
    ['.a { @d() color: red }', '(…) color: red'],
    ['.a { @d()\n  color: red\n}', '(…) color: red'],
    ['.a { @d()\n  color: red;\n}', '(…) color: red']
  ])('runs to `}` or `;` alike: %j', (source) => {
    const [ruleset] = parse(source).rules;
    expect(ruleset).toMatchObject({ rules: [{ type: 'AtRuleStatement', name: '@d', prelude: { src: '() color: red' } }] });
  });

  it('runs to `}` or the end of input with no `;`', () => {
    expect(parse('.x { @foo (a) b }').rules[0]).toMatchObject({ rules: [{ type: 'AtRuleStatement', prelude: { src: '(a) b' } }] });
    expect(first('@foo (a) b')).toMatchObject({ type: 'AtRuleStatement', prelude: { src: '(a) b' } });
  });

  it('reads a statement inside an at-rule body rather than leave the body opaque', () => {
    expect(first('@foo x { @bar (b) c; }')).toMatchObject({
      type: 'AtRuleBlock',
      rules: [{ type: 'AtRuleStatement', name: '@bar', prelude: { src: '(b) c' } }]
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

describe('an escaped at-rule name keeps its bytes, and a call its decoded name (ledger P39, P40)', () => {
  it.each([
    ['@\\6d edia (a) { c: d }', '@\\6d edia'],
    ['@\\69 mport (a) b;', '@\\69 mport'],
    ['@\\63 harset (a) b;', '@\\63 harset'],
    ['@foo\\ bar (a) { c: d }', '@foo\\ bar'],
    ['@a\\:b (a) { c: d }', '@a\\:b']
  ])('%s', (source, name) => {
    expect(first(source)).toMatchObject({ name });
  });

  it('decodes the name of a call', () => {
    expect(first('@\\66oo (a);')).toMatchObject({ type: 'Reference', base: { name: 'foo' } });
  });
});

describe('prelude bytes the head read past', () => {
  it.each([
    ['@foo ("a   b") { c: d }', '("a   b")'],
    ['@foo ("a\tb") { c: d }', '("a\tb")'],
    ['@foo (\'a   b\') { c: d }', '(\'a   b\')'],
    ['@foo (url("a  b.png")) { c: d }', '(url("a  b.png"))'],
    ['@foo (a: "b   c") { d: e }', '(a: "b   c")'],
    ['@foo (a) "b   c" { d: e }', '(a) "b   c"']
  ])('keeps a string\'s spaces: %s', (source, prelude) => {
    expect(preludeOf(first(source))).toMatchObject({ src: prelude });
  });

  it('keeps a string\'s spaces beside `@{…}`', () => {
    expect(preludeOf(first('@foo @{x} "b   c" { d: e }'))).toMatchObject({ parts: [{ ref: { name: 'x' } }, { lit: ' "b   c"' }] });
  });

  it.each([
    ['@foo (a // c\n b) { d: e }', '(a b)'],
    ['@foo (a // )\n b) { d: e }', '(a b)'],
    ['@foo (a) // c\n b { d: e }', '(a) b'],
    ['@foo (a) b // c\n d { e: f }', '(a) b d'],
    ['@foo (a) (b // c\n d) { e: f }', '(a) (b d)'],
    ['@foo (a) b (c // d\n e) { f: g }', '(a) b (c e)'],
    ['@foo (a) b (c // )\n e) { f: g }', '(a) b (c e)'],
    ['@foo (a) b // it\'s; {\n c { d: e }', '(a) b c']
  ])('drops a `//` comment and keeps the gap: %j', (source, prelude) => {
    expect(preludeOf(first(source))).toMatchObject({ src: prelude });
  });

  it('drops a `//` comment beside `@{…}`', () => {
    expect(preludeOf(first('@foo (a) b // c\n @{d};'))).toMatchObject({ parts: [{ lit: '(a) ' }, { lit: 'b ' }, { ref: { name: 'd' } }] });
  });

  it.each([
    ['@foo ("a // b") { c: d }', '("a // b")'],
    ['@foo (url(http://a.b/c)) { d: e }', '(url(http://a.b/c))'],
    ['@foo (a /* // */ b) { c: d }', '(a /* // */ b)'],
    ['@foo (a) http://b/c { d: e }', '(a) http://b/c'],
    ['@foo (a) url(http://b/c) d { e: f }', '(a) url(http://b/c) d'],
    ['@foo (a) url(//b/c) d { e: f }', '(a) url(//b/c) d'],
    ['@foo (a) b (http://c/d) { e: f }', '(a) b (http://c/d)'],
    ['@foo (a) b (c/d) { e: f }', '(a) b (c/d)']
  ])('leaves a `//` that is no comment: %s', (source, prelude) => {
    expect(preludeOf(first(source))).toMatchObject({ src: prelude });
  });

  it.each([
    ['@foo z (c: url(http://a)) { g: h }', 'z (c: url(http://a))'],
    ['@foo (http://a) { c: d }', '(http://a)'],
    ['@foo z (c // d\n e: f) { g: h }', 'z (c e: f)'],
    ['@foo (a: b) // c\n { d: e }', '(a: b)'],
    ['@foo a:b (c/d{e}) { f: g }', 'a:b (c/d{e})']
  ])('reads a `//` the same way on the route with no call head: %j', (source, prelude) => {
    expect(preludeOf(first(source))).toMatchObject({ src: prelude });
  });

  it('drops a `//` comment before `{ $$$ }` and beside `@{…}` with no call head', () => {
    expect(first('@foo x // c\n y { $$$ }')).toMatchObject({ type: 'UnknownAtRuleBlock', prelude: 'x y' });
    expect(preludeOf(first('@foo x // c\n @{y};'))).toMatchObject({ parts: [{ lit: 'x ' }, { ref: { name: 'y' } }] });
  });

  it.each([
    ['@foo (a /* " */ "b   c") { d: e }', '(a /* " */ "b   c")'],
    ['@foo (a /* it\'s */ "b   c" \'d   e\') { f: g }', '(a /* it\'s */ "b   c" \'d   e\')'],
    ['@foo (a /* it\'s   b */ c   d) { e: f }', '(a /* it\'s   b */ c d)']
  ])('reads a quote in a block comment as comment bytes: %j', (source, prelude) => {
    expect(preludeOf(first(source))).toMatchObject({ src: prelude });
  });

  it.each([
    ['@foo (a /* @{x} */) { c: d }', '(a /* @{x} */)'],
    ['@foo ("\\@{x}") { c: d }', '("\\@{x}")']
  ])('does not take a `@{` in a comment or an escape for an interpolation: %s', (source, prelude) => {
    expect(preludeOf(first(source))).toMatchObject({ src: prelude });
  });

  it('ends the statement at the `;` after a `//` in a group, with no block further on', () => {
    expect(parse('@foo url(http://a);\n.b { c: d }').rules.map(rule => rule.type)).toEqual(['AtRuleStatement', 'Ruleset']);
    expect(parse('@foo (a) url(http://b);\n.c { d: e }').rules.map(rule => rule.type)).toEqual(['AtRuleStatement', 'Ruleset']);
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

  it.each([
    ['@d()\n@media (a) { b: c }', 'MediaContainerBlock'],
    ['@d()\n@x: 1;', 'VarDeclaration'],
    ['@d()\n@b();', 'Reference'],
    ['@d()\n@e;', 'AtRuleStatement'],
    ['@d()\n@import "q";', 'ImportStatement'],
    ['@d()\n@charset "utf-8";', 'AtRuleStatement'],
    ['@d()\n@plugin "q";', 'PluginDirective'],
    ['@d() /* c */ @b();', 'Reference'],
    ['@d() // c\n@b();', 'Reference']
  ])('ends at an at-keyword, where a new statement starts: %j', (source) => {
    const { rules } = parse(source);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ type: 'Reference', raw: '@d()' });
    expect(rules[1]).toBeDefined();
  });
});

describe('a `!` after the head', () => {
  it.each(['.a { @d() !important; }', '.a { @d() ! important; }', '@d() !important;'])('stays a parse error: %s', (source) => {
    expect(() => parse(source)).toThrow();
  });

  it('is no stop anywhere else in the prelude', () => {
    expect(first('@d() x !important;')).toMatchObject({ type: 'AtRuleStatement', prelude: { src: '() x !important' } });
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
