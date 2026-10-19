import { describe, expect, it } from 'vitest';
import type { Stylesheet } from '@jesscss/core/ast';
import { parse as parseCss } from '@jesscss/css-parser';
import { parse, parseRecovering } from '../src/index.js';
import { bare } from '../../../../../test/provenance-free.js';

/*
 * Well-formed values `.jess` used to stop on (ledger P45, owner 2026-10-09:
 * what a dialect rejects or cannot give meaning to is a diagnostic at its
 * span, and the parse carries on).
 */

/** The value of the first declaration of the first rule. */
function declarationValue(document: Stylesheet): unknown {
  const rule = document.rules[0];
  return rule !== undefined && 'rules' in rule ? (rule.rules[0] as { value?: unknown } | undefined)?.value : undefined;
}

/** Each recovered problem as its code and the source it covers. */
function recovered(source: string): string[] {
  return parseRecovering(source).recovered.map(error => `${error.code} ${source.slice(error.offset, error.endOffset)}`);
}

/*
 * A `*` or `/` with nothing on its left is a punctuation-led value (ledger
 * P33): reported at the value it leads, the rest of the value kept as written,
 * the parse carrying on, as in Less.
 */
describe('a value led by a separator', () => {
  it.each([
    ['$t: * [.notice];\n.after { color: red; }', '* [.notice]'],
    ['.x { a: *[.a, .b]; }\n.after { color: red; }', '*[.a, .b]'],
    ['.x { a: * b; }\n.after { color: red; }', '* b'],
    ['.x { a: a, *[b]; }\n.after { color: red; }', '*[b]'],
    ['.x { background: /img/icon.svg; }\n.after { color: red; }', '/img/icon.svg']
  ])('%s', (source, at) => {
    expect(recovered(source)).toEqual([`parse/leading-separator-value ${at}`]);
    expect(parseRecovering(source).document.rules).toHaveLength(2);
    expect(() => parse(source)).toThrow(expect.objectContaining({ code: 'parse/leading-separator-value' }));
  });

  /* A `*` that opens a selector in a nested rule is the rule's, not a value's. */
  it.each([
    '.nav { a:hover, *:focus { color: red; } }',
    '.nav { li:hover, * { color: red; } }'
  ])('leaves a nested selector list a rule: %s', (source) => {
    expect(parseRecovering(source)).toMatchObject({ recovered: [], document: { rules: [{ rules: [{ type: 'Ruleset' }] }] } });
  });

  it('names the separator', () => {
    const [error] = parseRecovering('.x { a: / b; }').recovered;
    expect(error).toMatchObject({ message: 'A value cannot start with "/".' });
  });

  it('keeps a comment opener out of it', () => {
    expect(recovered('.x { a: /* c */ b; }')).toEqual([]);
  });
});

/*
 * What css builds for these, `.jess` builds too: a `*` between two values is
 * a delim outside `$( … )`, `type(<length>)` is a run of delims and an
 * identifier, and a paren group holds the run its padded `>`, `~` or `:` is in.
 */
describe('the css tree', () => {
  it.each([
    'a { x: a * b; }',
    'a { b: 2*[3]; }',
    'a { x: (2 * 3); }',
    'a { width: attr(data-w type(<length>), 0px); }',
    'a { width: attr(data-w type(<length>),0px); }',
    'a { x: (a ~ b); }',
    'a { x: (3px > 2px and 3px < 5px); }',
    'a { x: (a : b); }'
  ])('%s', (source) => {
    expect(bare(declarationValue(parse(source)))).toEqual(bare(declarationValue(parseCss(source))));
  });
});

/*
 * Between two numbers or variables a `*` is arithmetic, which `.jess` writes
 * only inside `$( … )` (ledger P17): the run css builds, and an error at the
 * `*` (P45). A paren group is not that (P18).
 */
describe('arithmetic outside $( … )', () => {
  it.each([
    ['a { x: 2 * 3; }', 'a { x: 2 * 3; }'],
    ['$w: 2px; a { x: $w * 2; }', null],
    ['$v: 1px * 2px;', null],
    ['$sizes: { gap: 2 * 4px };', null]
  ])('%s', (source, css) => {
    const { document, recovered } = parseRecovering(source);
    expect(recovered.map(error => `${error.code} ${source.slice(error.offset, error.endOffset)}`)).toEqual(['parse/arithmetic-outside-expression *']);
    if (css !== null) {
      expect(bare(declarationValue(document))).toEqual(bare(declarationValue(parseCss(css))));
    }
  });

  /* A function's arguments are not a value's top level (P18(a)), and css writes the same bytes. */
  it('leaves a function argument alone', () => {
    expect(parseRecovering('a { x: foo(2 * 3); }').recovered).toEqual([]);
  });
});

/* A padded `>`, `~` or `*` after a declaration value still opens a nested rule where no group is open. */
it.each([
  '.a { x: y > b { c: d } }',
  '.a {\n  color: red\n  * b { margin: 0 }\n}'
])('keeps a nested rule after an unterminated declaration: %j', (source) => {
  expect(parse(source).rules[0]).toMatchObject({
    rules: [{ type: 'Declaration' }, { type: 'Ruleset' }]
  });
});
