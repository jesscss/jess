import { describe, expect, it } from 'vitest';
import type { Stylesheet } from '@jesscss/core/ast';
import { parse as parseCss } from '@jesscss/css-parser';
import { run } from 'parseman';
import { scssGrammar } from '../src/grammar.js';
import { parse, parseRecovering } from '../src/index.js';
import { bare } from '../../../../../test/provenance-free.js';

/*
 * Well-formed values SCSS used to stop on (ledger P45, owner 2026-10-09: what
 * a dialect rejects or cannot give meaning to is a diagnostic at its span, and
 * the parse carries on).
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
    const [error] = parseRecovering('.x { a: * b; }').recovered;
    expect(error).toMatchObject({ message: 'A value cannot start with "*".' });
  });
});

/* Sass reads `&` in a value as the parent selector: the lookup the evaluator answers (owner 2026-10-19). */
describe('the parent selector in a value', () => {
  const parent = { type: 'Lookup', kind: 'parent', raw: '&' };

  it('in a declaration', () => {
    const source = '.btn { content: &; }\n.after { color: red; }';
    expect(recovered(source)).toEqual([]);
    expect(declarationValue(parse(source))).toMatchObject(parent);
  });

  it('as a call argument', () => {
    const source = '.btn { content: selector-append(&, "-b"); }\n.after { color: red; }';
    expect(recovered(source)).toEqual([]);
    expect(declarationValue(parse(source))).toMatchObject({ type: 'FunctionCall', args: [{ value: parent }, {}] });
  });

  it('leaves `&` in a selector a selector', () => {
    const source = '.a { div:hover & { c: d; } }';
    expect(parse(source).rules[0]).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'c' }] }]
    });

    /* The raw grammar reads it the same. */
    expect(run(scssGrammar.Stylesheet, source, { trivia: scssGrammar.whitespace })).toMatchObject({ ok: true, unconsumedFrom: null });
  });
});

/* What css builds for these, SCSS builds too. */
describe('the css tree', () => {
  it.each([
    'a { x: var(--x, a:b); }',
    'a { width: attr(data-w type(<length>), 0px); }',
    'a { width: attr(data-w type(<length>),0px); }',
    'a { margin: env(x, a:b); }',
    'a { margin: attr(foo, a:b); }'
  ])('%s', (source) => {
    expect(bare(declarationValue(parse(source)))).toEqual(bare(declarationValue(parseCss(source))));
  });
});
