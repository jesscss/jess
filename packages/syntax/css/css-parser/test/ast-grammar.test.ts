import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import { createTriviaMapFromParseman, triviaMapOf, valueLayoutOf, withSourceSpan, withTriviaMap } from '@jesscss/core/ast';
import type { SelectorBranch, SelectorTerm, Stylesheet } from '@jesscss/core/ast';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { simpleTokenText } from '../../../../core/src/ast/nodes.js';
import { cssGrammar } from '../src/grammar.js';
import { parseCssCst } from '../src/cst.js';
import { commentTriviaLabels } from '../src/cst.js';
import { parse } from '../src/index.js';
import { wptAnbParsing } from './wpt-syntax-vectors.js';
import { bare } from '../../../../../test/provenance-free.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && Array.isArray(value.rules);
}

function parseAst(input: string): Stylesheet {
  const result = run(cssGrammar.Stylesheet, input, {
    trivia: cssGrammar.whitespace,
    rootTrivia: { select: commentTriviaLabels }
  });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    throw new Error(`CSS AST grammar did not consume the document: ${JSON.stringify(result)}`);
  }
  return withTriviaMap(
    withSourceSpan(result.value, result.span),
    createTriviaMapFromParseman(input, result.rootTrivia?.index)
  );
}

function cstIssueCount(input: string): number {
  const result = parseCssCst(input);
  return Number(!result.ok) + result.errors.length + Number(result.unconsumedFrom !== null);
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

function containsNode(value: unknown, predicate: (value: Record<string, unknown>) => boolean): boolean {
  if (Array.isArray(value)) {
    return value.some(child => containsNode(child, predicate));
  }
  if (!isRecord(value)) {
    return false;
  }
  return predicate(value) || Object.values(value).some(child => containsNode(child, predicate));
}

function termTexts(term: SelectorTerm): string[] {
  return term.type === 'CompoundSelector'
    ? term.value.map(simpleTokenText)
    : [simpleTokenText(term)];
}

function leadingSelectorTexts(selector: SelectorBranch): string[] {
  if (selector.type === 'ComplexSelector') {
    return termTexts(selector.value[0]);
  }
  if (selector.type === 'RelativeSelector') {
    return termTexts(selector.value[1]);
  }
  return termTexts(selector);
}

describe('CSS canonical-AST grammar', () => {
  it('keeps ordinary adjacency as a raw value array and reserves List for explicit separators', () => {
    const document = parseAst('.x { space: red blue; comma: red, blue; ratio: 1 / 2; }');
    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'space', value: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }] },
        { type: 'Declaration', name: 'comma', value: { type: 'List', sep: ',' } },
        { type: 'Declaration', name: 'ratio', value: [{ type: 'Dimension', src: '1' }, { type: 'Any', src: '/' }, { type: 'Dimension', src: '2' }] }
      ]
    });
    expectExplicitListSeparators(document);
  });

  /*
   * The nested-rule header is spelled `b:c`, not `b: c`. A pseudo-class is
   * `':' <ident-token>` with no whitespace token between (selectors-4 §3.5), so
   * `b: c` is not a selector — and it is not a declaration either, because
   * css-syntax-3 §5.4.6 returns nothing when a value holds a top-level `{}` block
   * plus other content. The spaced form is invalid CSS both ways and is now
   * rejected; `conditional-at-rule-value.test.ts` owns that decision. What this
   * case is actually for — a nested-rule header must not be swallowed by the
   * permissive declaration-value grammar — is unchanged by the spelling.
   */
  it('keeps declaration-only permissive component values out of calc and nested-rule headers', () => {
    const document = parseAst('.a { x: (foo); ratio: 1 / 2; filter: alpha(opacity=50); flag: foo|bar; color: red ! IMPORTANT; b:c { color: blue; } }');
    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'x', value: { type: 'Block', delimiter: 'paren', value: { type: 'Keyword', src: 'foo' } } },
        { type: 'Declaration', name: 'ratio' },
        { type: 'Declaration', name: 'filter', value: { type: 'FunctionCall', name: 'alpha' } },
        { type: 'Declaration', name: 'flag' },
        { type: 'Declaration', name: 'color', important: true },
        { type: 'Ruleset' }
      ]
    });
  });

  it('uses shared basic-selector recognition plus structural attribute and percentage simple selectors', () => {
    for (const input of ['* { color: red; }', '.c\\6f lor { color: red; }', '#hero { color: red; }', '[role=button] { color: red; }', '50% { color: red; }']) {
      expect(parseAst(input).rules[0]).toMatchObject({ type: 'Ruleset' });
    }
    for (const input of ['[role=] { color: red; }', '[role=button i extra] { color: red; }']) {
      expect(() => parseAst(input)).toThrow();
    }
  });

  it('constructs static pseudo classes and elements as direct canonical SimpleSelector nodes', () => {
    const document = parseAst('.card:hover::before { color: red; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: [{
          type: 'CompoundSelector',
          value: [
            { type: 'SimpleSelector', text: '.card' },
            { type: 'SimpleSelector', text: ':hover' },
            { type: 'SimpleSelector', text: '::before' }
          ]
        }]
      }
    });
    expect(serialize(document)).toEqual({
      css: '.card:hover::before {\n  color: red;\n}\n'
    });
    expect(parseAst('.card:nth-child(2) { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset', selector: { selectors: [{ value: [{ text: '.card' }, { text: ':nth-child(2)' }] }] }
    });
  });

  it('constructs a namespaced type selector as ONE SimpleSelector, not two compounds split on `|`', () => {
    /*
     * The defect this pins (task #41): `svg|circle` used to parse as two
     * compound selectors joined by a `|` combinator, which serialized to the
     * SAME bytes — so only the NODE SHAPE catches a regression. `ns|E`/`*|E`/`|E`
     * are ONE type selector with a namespace prefix (css-namespaces-3 §5). The
     * column combinator `||` is unrelated and stays a combinator.
     */
    expect(parseAst('svg|circle { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: { selectors: [{ type: 'SimpleSelector', text: 'svg|circle' }] }
    });
    expect(parseAst('*|a { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset', selector: { selectors: [{ type: 'SimpleSelector', text: '*|a' }] }
    });
    expect(parseAst('|a { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset', selector: { selectors: [{ type: 'SimpleSelector', text: '|a' }] }
    });
    expect(parseAst('a[svg|href="x"] { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset', selector: { selectors: [{
        type: 'CompoundSelector',
        value: [{ type: 'SimpleSelector', text: 'a' }, { type: 'SimpleSelector', text: '[svg|href="x"]' }]
      }] }
    });

    // The column combinator is preserved: `a||b` is two compounds, not one selector.
    expect(parseAst('a||b { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset', selector: { selectors: [{
        type: 'ComplexSelector',
        value: [{ type: 'SimpleSelector', text: 'a' }, '||', { type: 'SimpleSelector', text: 'b' }]
      }] }
    });
    expect(serialize(parseAst('svg|circle { color: red; }'))).toEqual({
      css: 'svg|circle {\n  color: red;\n}\n'
    });
  });

  it('requires pseudo function names to be glued to the opening paren', () => {
    for (const source of [
      '.card:not( .disabled ) { color: red; }',
      '.card:nth-child( 2n + 1 ) { color: red; }',
      '.card:lang( en ) { color: red; }'
    ]) {
      expect(parseCssCst(source).errors, source).toHaveLength(0);
      expect(() => parseAst(source), source).not.toThrow();
    }

    for (const source of [
      '.card:not (.disabled) { color: red; }',
      '.card:nth-child (2n + 1) { color: red; }',
      '.card:lang (en) { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('matches public CST selector acceptance for attributes, recursive pseudo-selector arguments, raw pseudo arguments, and percentage simples', () => {
    for (const source of [
      '[role="button" i].card { color: red; }',
      ':is(.card, [data-kind=primary]) { color: red; }',
      ':nth-child(2n+1 of .item) { color: red; }',
      ':nth-child(-n+2 of .item) { color: red; }',
      ':lang(en-US) { color: red; }',
      ':lang(")") { color: red; }',
      ':unknown([data-state=")"]) { color: red; }',
      ':unknown(foo(bar[qux])) { color: red; }',
      '50% { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(() => parseAst(source), source).not.toThrow();
    }

    const document = parseAst(':is(.card, [data-kind=primary]) { color: red; }');

    /*
     * Structured pseudo: parser keeps `args` (pieces), `text` is null; the inline
     * join is core serialization's job (spaced).
     */
    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset', selector: {
        selectors: [{ type: 'PseudoSelector', name: ':is', text: null }]
      }
    });
    expect(serialize(document).css).toEqual(':is(.card, [data-kind=primary]) {\n  color: red;\n}\n');

    for (const source of ['[role=] { color: red; }', ':is(.card { color: red; }', ':nth-child(-n+) { color: red; }']) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('retains the parsed SelectorList as structured PseudoSelector args for whitelisted selector-function pseudos', () => {
    const document = parseAst('.x:is(.a, .b) { color: red; }');
    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: {
        selectors: [{
          type: 'CompoundSelector',
          value: [
            { type: 'SimpleSelector', text: '.x' },
            {
              type: 'PseudoSelector',
              name: ':is',
              text: null,
              crossable: true,
              interp: null,
              args: {
                type: 'SelectorList',
                selectors: [
                  { type: 'SimpleSelector', text: '.a' },
                  { type: 'SimpleSelector', text: '.b' }
                ]
              }
            }
          ]
        }]
      }
    });

    // `:not` structures too, but is sealed (crossable:false).
    const sealed = parseAst('.x:not(.a, .b) { color: red; }');
    expect(sealed.rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: { selectors: [{ value: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'PseudoSelector', name: ':not', text: null, crossable: false }
      ] }] }
    });

    // Non-whitelist pseudos (`::before`, `:hover`) stay opaque SimpleSelector text.
    const opaque = parseAst('.x::before:hover { color: red; }');
    expect(opaque.rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: { selectors: [{ value: [
        { type: 'SimpleSelector', text: '.x' },
        { type: 'SimpleSelector', text: '::before' },
        { type: 'SimpleSelector', text: ':hover' }
      ] }] }
    });

    /*
     * Serialization gate: authored `:is`/`:where`/`:not` selector-arg pseudos
     * render on ONE line with normalized WS (`:is(a, b)`, spaced) via the
     * core-owned join, REGARDLESS of authored spacing. The parser stores no
     * joined `text` — structure lives in `args`; core serialize owns the rule.
     */
    for (const [source, expected] of [
      ['.x:is(.a,.b) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n'],
      ['.x:is(.a, .b) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n'],
      ['.x:is(.a ,.b ) { color: red; }', '.x:is(.a, .b) {\n  color: red;\n}\n'],
      ['.x:where(.a, .b) { color: red; }', '.x:where(.a, .b) {\n  color: red;\n}\n'],
      ['.x:not(.a, .b) { color: red; }', '.x:not(.a, .b) {\n  color: red;\n}\n']
    ] as const) {
      expect(serialize(parseAst(source)).css, source).toEqual(expected);
    }
  });

  it('does not turn malformed numeric pseudo arguments into raw direct-AST selector text', () => {
    for (const source of [
      ':nth-child(2n +) { color: red; }',
      ':nth-child(1.5) { color: red; }',
      ':nth-child(2n+x) { color: red; }',
      ':nth-child(2n+1x) { color: red; }',

      /* WPT css/css-syntax/anb-parsing.html @ a95401e4: token whitespace
       * cannot split an An+B sign, coefficient, or `n` identifier. */
      ':nth-child(+ n) { color: red; }',
      ':nth-child(+ n-5) { color: red; }',
      ':nth-child(1 - n) { color: red; }',
      ':nth-child(2 n + 2) { color: red; }',
      ':nth-child(- 2n) { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }

    for (const source of [
      ':nth-child(2n + 1) { color: red; }',
      ':nth-child(2n+1 of .item) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).not.toThrow();
    }
  });

  it(`matches adapted WPT An+B selector acceptance at ${wptAnbParsing.source}`, () => {
    for (const argument of wptAnbParsing.accepts) {
      const source = `:nth-child(${argument}) { color: red; }`;
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(() => parseAst(source), source).not.toThrow();
    }

    for (const argument of wptAnbParsing.rejects) {
      const source = `:nth-child(${argument}) { color: red; }`;
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('keeps malformed-An+B rejection scoped to nth pseudo families', () => {
    for (const source of [
      ':lang(1.5) { color: red; }',
      ':custom-state(2n+x) { color: red; }',
      '::-vendor-part(2n +) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).not.toThrow();
    }

    for (const source of [
      ':nth-child(1.5) { color: red; }',
      ':nth-of-type(2n+x) { color: red; }',
      ':nth-last-child(2n +) { color: red; }',
      ':nth-last-of-type(2n+1x) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('restricts `of <selector>` to nth-child/nth-last-child and rejects it on nth-of-type (Selectors-4 §6.6.2)', () => {
    /*
     * `<An+B> of <complex-selector-list>` is valid ONLY for :nth-child()/
     * :nth-last-child(); :nth-of-type()/:nth-last-of-type() take a bare <An+B>
     * (https://www.w3.org/TR/selectors-4/#the-nth-child-pseudo). The of-type
     * `of` forms are not valid CSS, so the AST grammar must REJECT them rather
     * than silently capture the `<An+B> of …` tail as opaque raw / selector text.
     * This guards the CSS-aligned tightening (§7.1) against regressing to the
     * prior over-permissive acceptance across every An+B-prefix spelling.
     */
    for (const source of [
      ':nth-of-type(2n of .a) { color: red; }',
      ':nth-of-type(n of .a) { color: red; }',
      ':nth-of-type(2n + 1 of .a) { color: red; }',
      ':nth-last-of-type(-n+3 of .a) { color: red; }',
      ':nth-last-of-type(even of .a) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).toThrow();
    }

    // nth-child/last-child still accept `of`; bare of-type An+B is unaffected.
    for (const source of [
      'a:nth-child(2n of .a) { color: red; }',
      'a:nth-child(2n OF .a) { color: red; }',
      'a:nth-last-child(-n+3 of .a) { color: red; }',
      'a:nth-child(n of .a) { color: red; }',
      'a:nth-of-type(2n+1) { color: red; }',
      'a:nth-of-type(-n+3) { color: red; }',
      'a:nth-last-of-type(odd) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).not.toThrow();
    }
  });

  it('makes selector-argument pseudos selector-only and rejects paren-less nth names (cross-dialect divergence unification)', () => {
    /*
     * Two tracked css/jess/less divergences close here (design §7). (1) The
     * selector-argument pseudos (`:is`/`:where`/`:not`/`:has`/`:matches`) take a
     * selector-ONLY argument with no general-any fallback, so a non-selector
     * argument such as `:not(2n+1)` rejects the whole pseudo (less/jess already
     * reject). (2) A bare, paren-less nth name is not a keyword pseudo — it must
     * reach the structured nth arms with an immediate `(` or be rejected, matching
     * Less's identifier-boundary guard.
     */
    for (const source of [
      '.x:not(2n+1) { color: red; }',
      '.x:is(2n+1) { color: red; }',
      '.x:where(2n+1) { color: red; }',
      '.x:has(2n+1) { color: red; }',
      '.x:matches(2n+1) { color: red; }',
      '.x:nth-child { color: red; }',
      '.x:nth-of-type { color: red; }',
      '.x:nth-last-child { color: red; }',
      '.x:nth-last-of-type { color: red; }'
    ]) {
      expect(() => parseAst(source), source).toThrow();
    }

    /*
     * Valid selector arguments (including `:has()` relative selectors), the
     * general-any pseudos (`:lang`/`:dir`/unknown — verbatim any-value, unchanged),
     * and parenthesized nth still parse.
     */
    for (const source of [
      '.x:not(.a) { color: red; }',
      '.x:is(.a, .b) { color: red; }',
      '.x:where(.a, .b) { color: red; }',
      '.x:matches(.a) { color: red; }',
      '.x:has(> .b) { color: red; }',
      '.x:has(.card > .icon) { color: red; }',
      '.x:not(::before) { color: red; }',
      '.x:is(:not(.a)) { color: red; }',
      '.x:nth-child(2n+1) { color: red; }',
      '.x:lang(en) { color: red; }',
      '.x:dir(rtl) { color: red; }',
      '.x:unknown(2n+1) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).not.toThrow();
    }

    // `:has()` relative selectors are structured and serialize back byte-identically.
    for (const [source, expected] of [
      ['.x:has(> .b) { color: red; }', '.x:has(> .b) {\n  color: red;\n}\n'],
      ['.x:has(+ .b) { color: red; }', '.x:has(+ .b) {\n  color: red;\n}\n'],
      ['.x:has(~ .b) { color: red; }', '.x:has(~ .b) {\n  color: red;\n}\n']
    ] as const) {
      expect(serialize(parseAst(source)).css, source).toEqual(expected);
    }
  });

  it('accepts An+B whitespace around the sign and normalizes surrounding argument space', () => {
    /*
     * Selectors-4 §6.6.2 permits OPTIONAL whitespace around the `+`/`-` sign in
     * the `<An+B>` microsyntax (https://www.w3.org/TR/selectors-4/#anb-microsyntax);
     * the sign whitespace is preserved verbatim, while insignificant whitespace
     * surrounding the argument inside the parens is normalized away — matching
     * the existing `2n+1` handling, which emits the An+B expression as authored.
     */
    for (const [source, expected] of [
      ['a:nth-child(2n + 1) { color: red; }', 'a:nth-child(2n + 1) {\n  color: red;\n}\n'],
      ['a:nth-last-child(n - 3) { color: red; }', 'a:nth-last-child(n - 3) {\n  color: red;\n}\n'],
      ['a:nth-child(n + 3) { color: red; }', 'a:nth-child(n + 3) {\n  color: red;\n}\n'],
      ['a:nth-child(2n+1) { color: red; }', 'a:nth-child(2n+1) {\n  color: red;\n}\n'],
      ['a:nth-child( 2n+1 ) { color: red; }', 'a:nth-child(2n+1) {\n  color: red;\n}\n'],
      ['a:nth-child(2n + 1 of .item) { color: red; }', 'a:nth-child(2n + 1 of .item) {\n  color: red;\n}\n']
    ] as const) {
      expect(serialize(parseAst(source)).css, source).toEqual(expected);
    }
  });

  it('treats public selector and declaration-internal comments as trivia without creating comment statements', () => {
    const source = '/* root */ a/* compound */.card /* descendant */ > /* combinator */ [data-kind /* attribute */ = /* value */ primary i]:/* pseudo */hover { /* body */ color /* colon */ : /* value */ red/* tail */; }';
    const cst = parseCssCst(source);
    const document = parse(source);
    const trivia = triviaMapOf(document);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(bare(document)).toEqual(bare(parseAst(source)));
    expect(trivia?.commentRuns().map(run => source.slice(run.start, run.end))).toEqual([
      '/* root */ ',
      '/* compound */',
      ' /* descendant */ ',
      ' /* combinator */ ',
      ' /* attribute */ ',
      ' /* value */ ',
      '/* pseudo */',
      ' /* body */ ',
      ' /* colon */ ',
      ' /* value */ ',
      '/* tail */'
    ]);
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [{
              value: [
                { value: [{ text: 'a' }, { text: '.card' }] },
                '>',
                { value: [{ text: '[data-kind=primary i]' }, { text: ':hover' }] }
              ]
            }]
          },
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }
          ]
        }
      ]
    });
  });

  it('treats a selector-to-block comment as boundary trivia without turning it into a statement', () => {
    const source = 'a/**/{ color: red; }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(bare(parse(source))).toEqual(bare(parseAst(source)));
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'Ruleset',
        selector: { selectors: [{ type: 'SimpleSelector', text: 'a' }] },
        rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
      }]
    });

    /*
     * This boundary-only rule must not change the existing selector-internal
     * comment treatment into a lexical concatenation rule.
     */
    expect(parseAst('a/**/.card { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: { selectors: [{ value: [{ text: 'a' }, { text: '.card' }] }] }
    });
  });

  it('does not let a comment glue separate lexical value tokens together', () => {
    const source = 'a { width: 10/* token */px; }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(bare(parse(source))).toEqual(bare(parseAst(source)));
    expect(parse(source).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Declaration',
        name: 'width',
        value: [
          { type: 'Dimension', number: 10, unit: '', src: '10' },
          { type: 'Keyword', src: 'px' }
        ]
      }]
    });
  });

  it('keeps focused public-CST/direct-AST selector closure parity across attribute operators, recursive pseudos, raw balanced args, and percentage simples', () => {
    const cases: readonly [string, readonly string[]][] = [
      ['[data-role] { color: red; }', ['[data-role]']],
      ['[data-role="button" i] { color: red; }', ['[data-role="button"i]']],
      ['[lang|=en][data^=pre][data$="end" s] { color: red; }', ['[lang|=en]', '[data^=pre]', '[data$="end"s]']],
      [':is(.card, :not(.disabled), :has(.icon > svg)) { color: red; }', [':is(.card, :not(.disabled), :has(.icon > svg))']],
      [':has(.card > .icon, :is(.badge, .label)) { color: red; }', [':has(.card > .icon, :is(.badge, .label))']],
      [':nth-child(2n + 1 of :is(.card, .tile)) { color: red; }', [':nth-child(2n + 1 of :is(.card, .tile))']],
      [':nth-child(-n+2 of .item) { color: red; }', [':nth-child(-n+2 of .item)']],
      [':nth-last-of-type(-5n) { color: red; }', [':nth-last-of-type(-5n)']],
      [':nth-child(-n+2/* preserve */ of .item) { color: red; }', [':nth-child(-n+2 of .item)']],
      [':nth-child(-) { color: red; }', [':nth-child(-)']],
      ['50% { color: red; }', ['50%']]
    ];

    for (const [source, expectedSimples] of cases) {
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const document = parseAst(source);
      const first = document.rules[0];
      expect(first, source).toMatchObject({ type: 'Ruleset' });
      if (first?.type !== 'Ruleset') {
        throw new Error(`Expected a rule for ${source}`);
      }

      /*
       * A structured pseudo has `text: null` (structure in `args`); its canonical
       * inline spelling is produced by core serialization (`simpleTokenText`), not
       * the parser. Opaque simples/nth pseudos still carry verbatim `text`.
       */
      const selector = first.selector.selectors[0];
      expect(selector ? leadingSelectorTexts(selector) : [], source).toEqual(expectedSimples);
    }

    for (const source of [
      '[data=] { color: red; }',
      '[data="x" ii] { color: red; }',
      ':is(.card, ) { color: red; }',
      ':has(.card { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('constructs CSS nesting selectors as direct canonical SimpleSelector nodes', () => {
    const document = parseAst('.card { &.featured { color: red; } }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Ruleset',
        selector: {
          type: 'SelectorList',
          selectors: [{
            type: 'CompoundSelector',
            value: [{ type: 'SimpleSelector', text: '&' }, { type: 'SimpleSelector', text: '.featured' }]
          }]
        }
      }]
    });
    expect(serialize(document)).toEqual({
      css: '.card.featured {\n  color: red;\n}\n'
    });
  });

  it('accepts a top-level CSS nesting selector (ledger P30)', () => {
    /*
     * A top-level `&` is valid CSS — CSS Nesting L1 §4 says `&` outside a
     * nesting context represents `:scope`, so `&.featured {}` at the stylesheet
     * root is the scoping root, not a parse error. css shares ONE
     * `CompoundSelector` with less/scss/jess, so the root `&` reduces to the
     * SAME canonical shape as the nested case above.
     */
    const source = '&.featured { color: red; }';
    const cst = parseCssCst(source);

    expect(cst.errors, source).toHaveLength(0);
    expect(cst.unconsumedFrom, source).toBeNull();
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: [{
          type: 'CompoundSelector',
          value: [{ type: 'SimpleSelector', text: '&' }, { type: 'SimpleSelector', text: '.featured' }]
        }]
      }
    });
  });

  it('shares the strict CSS hex-color terminal with the other direct dialect grammars', () => {
    expect(parseAst('.card { color: #0a1B2c; }').rules[0]).toMatchObject({ type: 'Ruleset' });
    for (const input of ['.card { color: #fffff; }', '.card { color: #1234567; }']) {
      expect(() => parseAst(input)).toThrow();
    }
  });

  it('shares the public numeric grammar for exponent dimensions in declarations and calc', () => {
    const source = '.values { a: 1e3; b: -2.5E-1px; c: +.5e+2%; d: calc(1e2px + .5E1px); loose: 1 px; }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'a', value: { type: 'Dimension', number: 1000, unit: '' } },
        { type: 'Declaration', name: 'b', value: { type: 'Dimension', number: -0.25, unit: 'px' } },
        { type: 'Declaration', name: 'c', value: { type: 'Dimension', number: 50, unit: '%' } },
        {
          type: 'Declaration',
          name: 'd',
          value: {
            type: 'FunctionCall',
            name: 'calc',
            args: [{
              value: {
                type: 'Operation',
                operator: '+',
                left: { type: 'Dimension', number: 100, unit: 'px' },
                right: { type: 'Dimension', number: 5, unit: 'px' }
              }
            }]
          }
        },
        {
          type: 'Declaration',
          name: 'loose',
          value: [
            { type: 'Dimension', number: 1, unit: '' },
            { type: 'Keyword', src: 'px' }
          ]
        }
      ]
    });
  });

  it('constructs selector lists, compounds, declarations, and value lists directly from grammar reductions', () => {
    const document = parseAst('/* top */ .card.featured > #hero, main .card { color: red; margin: 12px 0; font-family: system-ui, sans-serif !important; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'ComplexSelector',
                value: [
                  { type: 'CompoundSelector', value: [{ type: 'SimpleSelector', text: '.card' }, { type: 'SimpleSelector', text: '.featured' }] },
                  '>',
                  { type: 'SimpleSelector', text: '#hero' }
                ]
              },
              {
                type: 'ComplexSelector',
                value: [
                  { type: 'SimpleSelector', text: 'main' },
                  ' ',
                  { type: 'SimpleSelector', text: '.card' }
                ]
              }
            ]
          },
          rules: [
            { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' }, merge: null, important: false },
            { type: 'Declaration', name: 'margin', value: [{ type: 'Dimension', number: 12, unit: 'px', src: '12px' }, { type: 'Dimension', number: 0, unit: '', src: '0' }] },
            { type: 'Declaration', name: 'font-family', value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'system-ui' }, { type: 'Keyword', src: 'sans-serif' }] }, important: true }
          ]
        }
      ]
    });

    expect(serialize(document)).toEqual({
      css: '/* top */\n.card.featured > #hero,\nmain .card {\n  color: red;\n  margin: 12px 0;\n  font-family: system-ui, sans-serif !important;\n}\n'
    });
  });

  it('keeps nested CSS rules and @media bodies as grammar-built AST statements', () => {
    const document = parseAst('@media screen { .card { color: #abc; .title { width: 100%; } } }');

    expect(document.rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@media',
      prelude: { type: 'Keyword', src: 'screen' }
    });
    expect(serialize(document)).toEqual({
      css: '@media screen {\n  .card {\n    color: #abc;\n  }\n  .card .title {\n    width: 100%;\n  }\n}\n'
    });
  });

  it('uses `only` only before a media type', () => {
    expect(parseAst('@media only screen and (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media', prelude: { type: 'Sequence' } }]
    });
    expect(() => parseAst('@media only (min-width: 1px) { .card { color: red; } }')).toThrow();
    expect(() => parseAst('@media layer { .card { color: red; } }')).toThrow();
    expect(() => parseAst('@media only layer { .card { color: red; } }')).toThrow();
    expect(() => parseAst('@container only screen { .card { color: red; } }')).toThrow();
    expect(parseAst('@media not (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@media' }]
    });
  });

  it('uses a supports-condition branch rather than the media/container query fallback', () => {
    for (const source of [
      '@supports (display: grid) { .grid { display: grid; } }',
      '@supports (color) { .grid { color: red; } }',
      '@supports not (display: grid) { .grid { display: block; } }',
      '@SUPPORTS NOT (display: grid) { .grid { display: block; } }'
    ]) {
      expect(parseCssCst(source).errors).toHaveLength(0);
      expect(parseAst(source).rules[0]).toMatchObject({ type: 'AtRuleBlock' });
    }
    expect(parseAst('.card { @supports (display: grid) { display: grid; } }').rules[0]).toMatchObject({
      type: 'Ruleset', rules: [{ type: 'AtRuleBlock', name: '@supports' }]
    });
    for (const source of [
      '@supports (display: grid) { @font-face { font-family: A; src: url(a); } }',
      '@supports (display: grid) { @layer x { .grid { display: grid; } } }',
      '@supports (display: grid) { @starting-style { .grid { display: grid; } } }'
    ]) {
      expect(parseCssCst(source).errors).toHaveLength(0);
      expect(parseAst(source).rules[0]).toMatchObject({ type: 'AtRuleBlock', rules: [{ type: 'AtRuleBlock' }] });
    }

    const document = parseAst('@supports not ((display: grid) and (color: red)) { .grid { display: grid; } }');
    expect(document.rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      prelude: {
        type: 'Sequence',
        parts: [
          { type: 'Keyword', src: 'not' },
          { type: 'Block', delimiter: 'paren', value: { type: 'Sequence' } }
        ]
      }
    });
    expect(parseAst('@SUPPORTS NOT (display: grid) { .grid { display: grid; } }').rules[0]).toMatchObject({
      name: '@SUPPORTS', prelude: { type: 'Sequence', parts: [{ type: 'Keyword', src: 'NOT' }, { type: 'Block', delimiter: 'paren' }] }
    });

    for (const source of [
      '@supports color { .grid { display: grid; } }',
      '@supports { .grid { display: grid; } }'
    ]) {
      expect(cstIssueCount(source)).toBeGreaterThan(0);
      expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
    }

    /*
     * General-enclosed forms are an explicitly typed, syntax-preserving payload;
     * they are not FunctionCall(Any) or an opaque at-rule fallback.
     */
    for (const source of [
      '@supports selector(.grid > .item) { .grid { display: grid; } }',
      '@supports future-feature(foo(bar)) { .grid { display: grid; } }',
      '@supports (display: grid) and selector(.grid) { .grid { display: grid; } }'
    ]) {
      expect(parseCssCst(source).errors).toHaveLength(0);
      expect(parseAst(source)).toMatchObject({ type: 'Stylesheet' });
    }

    /*
     * The production grammar currently accepts a comma list here, despite the
     * spec's narrower supports-condition shape. Direct AST must not silently
     * narrow the public language during the cutover.
     */
    expect(parseAst('@supports (display: grid), (color: red) { .grid { display: grid; } }').rules[0]).toMatchObject({
      type: 'AtRuleBlock', prelude: { type: 'List', sep: ',', value: [{ type: 'Block', delimiter: 'paren' }, { type: 'Block', delimiter: 'paren' }] }
    });
  });

  it('constructs general-enclosed supports payloads structurally and rejects malformed delimiters', () => {
    const source = '@supports selector(  .grid /* keep */ [data-kind=")"] :is(.a, .b) ) { .grid { display: grid; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'FunctionCall', name: 'selector',
          args: [{ value: { type: 'Interpolation', parts: [{ lit: '  .grid /* keep */ [data-kind=")"] :is(.a, .b) ' }] } }]
        }
      }]
    });

    const paren = '@supports (future-feature "quoted ) byte" [x]) { .grid { display: grid; } }';
    expect(parseCssCst(paren).errors).toHaveLength(0);
    expect(parseAst(paren)).toMatchObject({
      rules: [{
        prelude: {
          type: 'Block', delimiter: 'paren',
          value: { type: 'Interpolation', parts: [{ lit: 'future-feature "quoted ) byte" [x]' }] }
        }
      }]
    });

    for (const malformed of [
      '@supports selector(.grid { .grid { display: grid; } }',
      '@supports selector(".grid) { .grid { display: grid; } }'
    ]) {
      expect(() => parseAst(malformed), malformed).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('keeps public supports-condition comments local to the typed condition grammar', () => {
    const source = '@supports/* keyword */ (display/* property */:/* value */grid/* close */)/* before-and */ and/* after-and */ (color: red)/* before-comma */,/* after-comma */ not/* after-not */ (width: 1px)/* before-brace */ { /* body */ .grid { display: grid; } }';
    const nested = '.card { @supports/* keyword */ (display/* property */: grid)/* before-brace */ { color: red; } }';

    for (const input of [source, nested]) {
      const cst = parseCssCst(input);
      expect(cst.errors, input).toHaveLength(0);
      expect(cst.unconsumedFrom, input).toBeNull();
      expect(bare(parse(input), input)).toEqual(bare(parseAst(input)));
    }
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      rules: [{ type: 'Ruleset' }]
    });
  });

  it('does not unglue public-invalid supports function tokens while adding supports comment trivia', () => {
    for (const source of [
      '@supports selector/* glue */(.grid) { .grid { display: grid; } }',
      '@supports style/* glue */(--theme: dark) { .grid { display: grid; } }'
    ]) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('directly constructs conditional, descriptor, and scope at-rule blocks accepted by the public CST grammar', () => {
    const source = `
      @SUPPORTS (display: grid) { .grid { display: grid; } }
      @container sidebar (width > 30rem) { .card { padding: 1rem; } }
      @FONT-FACE { font-family: Demo; src: url(demo.woff2); }
      @property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
      @scope (.card) to (.edge) { color: red; .item { color: blue; } }
    `;
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const document = parseAst(source);
    expect(document.rules).toMatchObject([
      { type: 'AtRuleBlock', name: '@SUPPORTS', prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } }, rules: [{ type: 'Ruleset' }] },
      { type: 'AtRuleBlock', name: '@container', prelude: { type: 'Sequence', parts: [{ type: 'Keyword', src: 'sidebar' }, { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '>' } }] }, rules: [{ type: 'Ruleset' }] },
      { type: 'AtRuleBlock', name: '@FONT-FACE', prelude: null, rules: [{ type: 'Declaration', name: 'font-family' }, { type: 'Declaration', name: 'src' }] },
      { type: 'AtRuleBlock', name: '@property', prelude: { type: 'Any', src: '--angle' }, rules: [{ type: 'Declaration', name: 'syntax' }, { type: 'Declaration', name: 'inherits' }, { type: 'Declaration', name: 'initial-value' }] },
      { type: 'AtRuleBlock', name: '@scope', prelude: { type: 'Any', src: '(.card) to (.edge)' }, rules: [{ type: 'Declaration', name: 'color' }, { type: 'Ruleset' }] }
    ]);
  });

  it('constructs public media range queries without falling back to raw prelude bytes', () => {
    const source = '@media (100em < width < 200em) { .card { color: red; } }';

    for (const range of [
      source,
      '@media (100em < width) { .card { color: red; } }',
      '@media (width >= 100em < 200em) { .card { color: red; } }'
    ]) {
      expect(parseCssCst(range).errors, range).toHaveLength(0);
      expect(parseAst(range).rules[0], range).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren' }
      });
    }
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@media',
      prelude: {
        type: 'Block', delimiter: 'paren',
        value: {
          type: 'Operation',
          operator: '<',
          left: {
            type: 'Operation',
            operator: '<',
            left: { type: 'Dimension', src: '100em' },
            right: { type: 'Keyword', src: 'width' }
          },
          right: { type: 'Dimension', src: '200em' }
        }
      }
    });
  });

  it('constructs a media feature <ratio> value in every feature form', () => {
    const ratio = {
      type: 'Operation',
      operator: '/',
      left: { type: 'Dimension', src: '16' },
      right: { type: 'Dimension', src: '9' }
    };

    for (const source of [
      '@media (aspect-ratio: 16/9) { .card { color: red; } }',
      '@media (aspect-ratio: 16 / 9) { .card { color: red; } }',
      '@media (min-aspect-ratio: 16/9) { .card { color: red; } }',
      '@container (aspect-ratio: 16/9) { .card { color: red; } }'
    ]) {
      expect(parseCssCst(source).errors, source).toHaveLength(0);
      expect(parseAst(source).rules[0], source).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', right: ratio } }
      });
    }

    expect(parseAst('@media (aspect-ratio >= 16/9) { .card { color: red; } }').rules[0]).toMatchObject({
      prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: '>=', right: ratio } }
    });

    expect(parseAst('@media (16/9 < aspect-ratio < 2/1) { .card { color: red; } }').rules[0]).toMatchObject({
      prelude: {
        type: 'Block', delimiter: 'paren',
        value: {
          type: 'Operation', operator: '<',
          left: { type: 'Operation', operator: '<', left: ratio, right: { type: 'Keyword', src: 'aspect-ratio' } },
          right: { type: 'Operation', operator: '/', left: { type: 'Dimension', src: '2' }, right: { type: 'Dimension', src: '1' } }
        }
      }
    });

    /*
     * A single `<number>` is still a whole ratio, and a non-ratio feature value
     * keeps its plain component value: the slash tail is optional, not implied.
     */
    for (const [source, inner] of [
      ['@media (aspect-ratio: 1) { .card { color: red; } }', { type: 'Dimension', src: '1' }],
      ['@media (min-width: 100px) { .card { color: red; } }', { type: 'Dimension', src: '100px' }]
    ] as const) {
      expect(parseAst(source).rules[0], source).toMatchObject({
        prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':', right: inner } }
      });
    }

    /*
     * A slash between multi-part operands is not a ratio: `@supports` still
     * hands the whole payload to general-enclosed instead of hard-failing.
     */
    expect(parseAst('@supports (a b / c) { .card { color: red; } }').rules[0]).toMatchObject({
      prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Interpolation' } }
    });
  });

  it('uses declaration-list bodies for nested conditional blocks, like the public CST grammar', () => {
    const source = 'a { @media (width: 1px) { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors, JSON.stringify(cst.errors)).toHaveLength(0);
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'AtRuleBlock',
        name: '@media',
        prelude: { type: 'Block', delimiter: 'paren', value: { type: 'Operation', operator: ':' } },
        rules: [{ type: 'Declaration', name: 'color' }]
      }]
    });
  });

  it('constructs arbitrary public query-function payloads without reparsing their balanced bytes', () => {
    const source = '@container sidebar style(--theme: dark) and scroll-state(stuck: block-start) { .card { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@container',
      prelude: {
        type: 'Sequence',
        parts: [
          { type: 'Keyword', src: 'sidebar' },
          { type: 'FunctionCall', name: 'style', args: [{ value: { type: 'Any', src: '--theme: dark' } }] },
          { type: 'Keyword', src: 'and' },
          { type: 'FunctionCall', name: 'scroll-state', args: [{ value: { type: 'Any', src: 'stuck: block-start' } }] }
        ]
      },
      rules: [{ type: 'Ruleset' }]
    });
  });

  it('constructs @page and each public page-margin box with declarations-only bodies', () => {
    const source = `
      @PAGE report:left {
        size: A4;
        margin: 2cm;
        @TOP-LEFT-CORNER { content: "tlc"; }
        @top-left { content: "tl"; }
        @top-center { content: "tc"; }
        @top-right { content: "tr"; }
        @top-right-corner { content: "trc"; }
        @bottom-left-corner { content: "blc"; }
        @bottom-left { content: "bl"; }
        @bottom-center { content: "bc"; }
        @bottom-right { content: "br"; }
        @bottom-right-corner { content: "brc"; }
        @left-top { content: "lt"; }
        @left-middle { content: "lm"; }
        @left-bottom { content: "lb"; }
        @right-top { content: "rt"; }
        @right-middle { content: "rm"; }
        @right-bottom { content: "rb"; }
      }
    `;
    expect(parseCssCst(source).errors).toHaveLength(0);
    const document = parseAst(source);
    expect(document.rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@PAGE',
      prelude: { type: 'Any', src: 'report:left' },
      rules: [
        { type: 'Declaration', name: 'size' },
        { type: 'Declaration', name: 'margin' },
        { type: 'AtRuleBlock', name: '@TOP-LEFT-CORNER', prelude: null, rules: [{ type: 'Declaration', name: 'content' }] },
        { type: 'AtRuleBlock', name: '@top-left' },
        { type: 'AtRuleBlock', name: '@top-center' },
        { type: 'AtRuleBlock', name: '@top-right' },
        { type: 'AtRuleBlock', name: '@top-right-corner' },
        { type: 'AtRuleBlock', name: '@bottom-left-corner' },
        { type: 'AtRuleBlock', name: '@bottom-left' },
        { type: 'AtRuleBlock', name: '@bottom-center' },
        { type: 'AtRuleBlock', name: '@bottom-right' },
        { type: 'AtRuleBlock', name: '@bottom-right-corner' },
        { type: 'AtRuleBlock', name: '@left-top' },
        { type: 'AtRuleBlock', name: '@left-middle' },
        { type: 'AtRuleBlock', name: '@left-bottom' },
        { type: 'AtRuleBlock', name: '@right-top' },
        { type: 'AtRuleBlock', name: '@right-middle' },
        { type: 'AtRuleBlock', name: '@right-bottom' }
      ]
    });
  });

  it('keeps public comment trivia local to all sixteen named page-margin box headers', () => {
    const names = [
      'top-left-corner', 'top-left', 'top-center', 'top-right', 'top-right-corner',
      'bottom-left-corner', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-right-corner',
      'left-top', 'left-middle', 'left-bottom', 'right-top', 'right-middle', 'right-bottom'
    ];
    const source = `@page report { ${names.map((name, index) => `@${name}/* header ${index} */ { ${index === 0 ? '/* body */' : ''} content: "${name}"; }`).join(' ')} }`;
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(bare(parse(source))).toEqual(bare(parseAst(source)));
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@page',
      rules: [
        { type: 'AtRuleBlock', name: '@top-left-corner', prelude: null, rules: [{ type: 'Declaration', name: 'content' }] },
        ...names.slice(1).map(name => ({ type: 'AtRuleBlock', name: `@${name}`, prelude: null, rules: [{ type: 'Declaration', name: 'content' }] }))
      ]
    });
  });

  it('does not split public-invalid page-margin at-keywords while adding header comments', () => {
    const source = '@page report { @top/* split */-left { content: "x"; } }';
    const cst = parseCssCst(source);

    expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null)).toBeGreaterThan(0);
    expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
    expect(() => parse(source)).toThrow(SyntaxError);
  });

  /*
   * DESIGN-DECISIONS.md P20: an at-keyword ends only at a NON-ident code
   * point, and css-syntax-3 §4.3.11 makes every code point >= U+0080 an ident
   * code point. So `@pageé` is ONE unknown at-keyword, not `@page` with a
   * prelude of `é`. This test previously asserted the ASCII-boundary split.
   */
  it('treats a known at-keyword followed by a Unicode ident code point as one unknown at-keyword', () => {
    for (const source of ['@pageé { size: A4; }']) {
      const cst = parseCssCst(source);
      expect(cst.errors).toHaveLength(0);
      expect(cst.unconsumedFrom).toBeNull();
      expect(parseAst(source).rules[0]).toMatchObject({
        type: 'OpaqueAtRuleBlock',
        name: '@pageé'
      });
    }
  });

  it('rejects rules and nested at-rules in page and margin-box declaration bodies', () => {
    for (const source of [
      '@page { .rule { color: red; } }',
      '@page { @media (width: 1px) { .rule { color: red; } } }',
      '@page { @top-center { .rule { color: red; } } }',
      '@page { @top-center { @media (width: 1px) { color: red; } } }'
    ]) {
      expect(cstIssueCount(source)).toBeGreaterThan(0);
      expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('constructs every @font-feature-values block family as direct AtRuleBlock nodes with public-CST parity', () => {
    const source = `
      @FONT-FEATURE-VALUES "Fira Code", Demo {
        /* family */
        @STYLISTIC { salt: 1; }
        @styleset { nice: 1 2; }
        @character-variant { cv01: 3; }
        @swash { swsh: 4; }
        @ornaments { orn: 5; }
        @annotation { note: 6; }
        @historical-forms { hist: 7; }
      }
    `;
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@FONT-FEATURE-VALUES',
      prelude: { type: 'Any', src: '"Fira Code", Demo' },
      rules: [
        { type: 'AtRuleBlock', name: '@STYLISTIC', prelude: null, rules: [{ type: 'Declaration', name: 'salt' }] },
        { type: 'AtRuleBlock', name: '@styleset', prelude: null, rules: [{ type: 'Declaration', name: 'nice' }] },
        { type: 'AtRuleBlock', name: '@character-variant', prelude: null, rules: [{ type: 'Declaration', name: 'cv01' }] },
        { type: 'AtRuleBlock', name: '@swash', prelude: null, rules: [{ type: 'Declaration', name: 'swsh' }] },
        { type: 'AtRuleBlock', name: '@ornaments', prelude: null, rules: [{ type: 'Declaration', name: 'orn' }] },
        { type: 'AtRuleBlock', name: '@annotation', prelude: null, rules: [{ type: 'Declaration', name: 'note' }] },
        { type: 'AtRuleBlock', name: '@historical-forms', prelude: null, rules: [{ type: 'Declaration', name: 'hist' }] }
      ]
    });
  });

  it('rejects non-feature blocks and bare declarations in @font-feature-values with public-CST parity', () => {
    for (const source of [
      '@font-feature-values Demo { color: red; }',
      '@font-feature-values Demo { .rule { color: red; } }',
      '@font-feature-values Demo { @unknown { value: 1; } }'
    ]) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
    }
  });

  /* DESIGN-DECISIONS.md P20 -- see the `@pageé` case above. */
  it('keeps a Unicode ident code point inside the font-feature at-keyword', () => {
    const source = '@font-feature-valuesé { @styleset /* header */ { nice: 1; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'OpaqueAtRuleBlock',
      name: '@font-feature-valuesé',
      prelude: null,
      rawBody: ' @styleset /* header */ { nice: 1; } '
    });
  });

  it('keeps the font-feature header-comment trivia behavior on the real keyword', () => {
    const source = '@font-feature-values Demo { @styleset /* header */ { nice: 1; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@font-feature-values',
      prelude: { type: 'Any', src: 'Demo' },
      rules: [{ type: 'AtRuleBlock', name: '@styleset', prelude: null, rules: [{ type: 'Declaration', name: 'nice' }] }]
    });
  });

  it('constructs non-import statement at-rule headers as grammar-owned public bytes', () => {
    const document = parseAst('@namespace svg url("https://example.test/ns"); @layer utilities; @layer; .card { color: red; }');

    expect(document.rules).toMatchObject([
      {
        type: 'AtRuleStatement',
        name: '@namespace',
        prelude: { type: 'Any', src: 'svg url("https://example.test/ns")' }
      },
      { type: 'AtRuleStatement', name: '@layer', prelude: { type: 'Any', src: 'utilities' } },
      { type: 'AtRuleStatement', name: '@layer', prelude: null },
      { type: 'Ruleset' }
    ]);
    expect(serialize(document)).toEqual({
      css: '@namespace svg url("https://example.test/ns");\n@layer utilities;\n@layer;\n.card {\n  color: red;\n}\n'
    });
  });

  it('constructs case-insensitive named and anonymous @layer blocks as structured AST subtrees', () => {
    const document = parseAst('@LAYER utilities.components { .card { color: red; } } @layer { .reset { margin: 0; } }');

    expect(document.rules).toMatchObject([
      {
        type: 'AtRuleBlock',
        name: '@LAYER',
        prelude: { type: 'Any', src: 'utilities.components' },
        rules: [{ type: 'Ruleset', selector: { type: 'SelectorList' } }]
      },
      {
        type: 'AtRuleBlock',
        name: '@layer',
        prelude: null,
        rules: [{ type: 'Ruleset', selector: { type: 'SelectorList' } }]
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@LAYER utilities.components {\n  .card {\n    color: red;\n  }\n}\n@layer {\n  .reset {\n    margin: 0;\n  }\n}\n'
    });
  });

  it('constructs keyframe selector blocks directly instead of treating keyframes as ordinary rulesets', () => {
    const document = parseAst('@KEYFRAMES fade { /* half-way */ from, 50% { opacity: 0; } to { opacity: 1; } } @-MOZ-KEYFRAMES zoom { from { opacity: 0; } }');

    expect(document.rules).toMatchObject([
      {
        type: 'AtRuleBlock',
        name: '@KEYFRAMES',
        prelude: { type: 'Any', src: 'fade' },
        rules: [
          {
            type: 'Ruleset',
            selector: {
              type: 'SelectorList',
              selectors: [
                { type: 'SimpleSelector', text: 'from' },
                { type: 'SimpleSelector', text: '50%' }
              ]
            },
            rules: [{ type: 'Declaration', name: 'opacity' }]
          },
          {
            type: 'Ruleset',
            selector: { type: 'SelectorList', selectors: [{ type: 'SimpleSelector', text: 'to' }] }
          }
        ]
      },
      {
        type: 'AtRuleBlock',
        name: '@-MOZ-KEYFRAMES',
        prelude: { type: 'Any', src: 'zoom' },
        rules: [{ type: 'Ruleset', selector: { type: 'SelectorList' } }]
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@KEYFRAMES fade {\n  /* half-way */\n  from,\n  50% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@-MOZ-KEYFRAMES zoom {\n  from {\n    opacity: 0;\n  }\n}\n'
    });
  });

  it('treats keyframe selector delimiter comments as trivia without swallowing keyframe-body comments', () => {
    const source = '@keyframes fade { /* body */ from /* after-from */, /* before-half */ 50% /* after-half */, to /* before-block */ { /* declaration */ opacity: 0; } }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(bare(parse(source))).toEqual(bare(parseAst(source)));
    expect(parseAst(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock',
        name: '@keyframes',
        rules: [
          {
            type: 'Ruleset',
            selector: {
              type: 'SelectorList',
              selectors: [
                { type: 'SimpleSelector', text: 'from' },
                { type: 'SimpleSelector', text: '50%' },
                { type: 'SimpleSelector', text: 'to' }
              ]
            },
            rules: [
              { type: 'Declaration', name: 'opacity', value: { type: 'Dimension', number: 0, unit: '' } }
            ]
          }
        ]
      }]
    });
  });

  it('rejects non-keyframe selectors and bare declarations in a keyframes body', () => {
    for (const input of ['@keyframes fade { .card { opacity: 0; } }', '@keyframes fade { opacity: 0; }', '@keyframes fade { 50px { opacity: 0; } }']) {
      expect(() => parseAst(input)).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('keeps public @layer block headers grammar-owned instead of narrowing them to a layer-name token', () => {
    const source = '@layer utilities, components /* keep */ { .card { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Any', src: 'utilities, components' }, rules: [{ type: 'Ruleset' }]
    });
  });

  it('matches public CST acceptance for serialized known headers and statements', () => {
    const source = `
      @STARTING-STYLE legacy header { .start { color: red; } }
      @SCOPE { color: red; .scoped { color: blue; } }
      @KEYFRAMES fade alternate { from { opacity: 0; } }
      @CHARSET custom (encoding);
      @namespace svg /* keep */ url("https://example.test/ns");
    `;
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source).rules).toMatchObject([
      { type: 'AtRuleBlock', name: '@STARTING-STYLE', prelude: { type: 'Any', src: 'legacy header' }, rules: [{ type: 'Ruleset' }] },
      { type: 'AtRuleBlock', name: '@SCOPE', prelude: null, rules: [{ type: 'Declaration' }, { type: 'Ruleset' }] },
      { type: 'AtRuleBlock', name: '@KEYFRAMES', prelude: { type: 'Any', src: 'fade alternate' }, rules: [{ type: 'Ruleset' }] },
      { type: 'AtRuleStatement', name: '@CHARSET', prelude: { type: 'Any', src: 'custom (encoding)' } },
      { type: 'AtRuleStatement', name: '@namespace', prelude: { type: 'Any', src: 'svg url("https://example.test/ns")' } }
    ]);
  });

  it('matches public top-level and nested bodies for layer, scope, and starting-style', () => {
    const source = `
      @layer x { @namespace svg url("u"); @keyframes k { from { opacity: 0; } } }
      @starting-style { @namespace svg url("u"); @keyframes k { from { opacity: 0; } } }
      .x { @layer x { color: red; @starting-style { color: green; } } @scope { color: blue; @namespace svg url("u"); } @starting-style { color: green; } }
    `;
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parseAst(source).rules).toMatchObject([
      { type: 'AtRuleBlock', name: '@layer', rules: [{ type: 'AtRuleStatement' }, { type: 'AtRuleBlock', name: '@keyframes' }] },
      { type: 'AtRuleBlock', name: '@starting-style', rules: [{ type: 'AtRuleStatement' }, { type: 'AtRuleBlock', name: '@keyframes' }] },
      { type: 'Ruleset', rules: [
        { type: 'AtRuleBlock', name: '@layer', rules: [{ type: 'Declaration', name: 'color' }, { type: 'AtRuleBlock', name: '@starting-style', rules: [{ type: 'Declaration', name: 'color' }] }] },
        { type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'Declaration', name: 'color' }, { type: 'AtRuleStatement', name: '@namespace' }] },
        { type: 'AtRuleBlock', name: '@starting-style', rules: [{ type: 'Declaration', name: 'color' }] }
      ] }
    ]);
  });

  it('keeps @charset in the public generic statement and unknown-block families', () => {
    for (const [source, expected] of [
      ['@charseté custom;', { type: 'AtRuleStatement', name: '@charseté', prelude: { type: 'Any', src: 'custom' } }],
      ['@charset { rules: raw; }', { type: 'OpaqueAtRuleBlock', name: '@charset', prelude: null, rawBody: ' rules: raw; ' }]
    ] as const) {
      const cst = parseCssCst(source);
      expect(cst.errors).toHaveLength(0);
      expect(cst.unconsumedFrom).toBeNull();
      expect(parseAst(source).rules[0]).toMatchObject(expected);
    }
  });

  it('constructs unknown block at-rules as opaque grammar-owned raw bodies', () => {
    const source = '@layered screen {\n  raw: fn("}", /* keep */ nested({ value: 1; }));\n  @nested { value: "{ }"; }\n}';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const document = parseAst(source);
    expect(document.rules).toMatchObject([{
      type: 'OpaqueAtRuleBlock',
      name: '@layered',
      prelude: 'screen',
      rawBody: '\n  raw: fn("}", /* keep */ nested({ value: 1; }));\n  @nested { value: "{ }"; }\n'
    }]);
    expect(serialize(document)).toEqual({ css: `${source}\n` });
  });

  it('does not lower malformed typed block at-rules to opaque blocks', () => {
    for (const source of ['@media { .card { color: red; } }', '@font-face { .card { color: red; } }']) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null)).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('constructs @document and @-moz-document frame-one bodies directly', () => {
    const source = '@-MOZ-DOCUMENT url-prefix("https://example.test/"), domain("example.test") {\n  @font-face { font-family: Demo; src: url(demo.woff2); }\n  .card { color: red; }\n}';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const document = parseAst(source);
    expect(document.rules).toMatchObject([{
      type: 'AtRuleBlock',
      name: '@-MOZ-DOCUMENT',
      prelude: { type: 'Any', src: 'url-prefix("https://example.test/"), domain("example.test")' },
      rules: [
        { type: 'AtRuleBlock', name: '@font-face' },
        { type: 'Ruleset' }
      ]
    }]);
  });

  /*
   * DESIGN-DECISIONS.md P20. Under the old ASCII boundary `@layeré` and
   * `@documenté` did not merely mis-name: the truncated keyword dispatched to a
   * TYPED route whose prelude grammar then rejected the leftover `é`, so the
   * AST parse THREW on well-formed CSS. Keeping the keyword whole routes them
   * to the unknown-at-rule branch, which is what an unknown at-rule is for.
   * @see https://drafts.csswg.org/css-syntax/#ident-token-diagram
   */
  it('keeps a Unicode ident code point inside a known at-keyword instead of splitting it', () => {
    for (const [source, name] of [
      ['@scopeé { .card { color: red; } }', '@scopeé'],
      ['@layeré { .card { color: red; } }', '@layeré'],
      ['@documenté { .card { color: red; } }', '@documenté'],
      ['@keyframesé { .card { color: red; } }', '@keyframesé'],
      ['@supportsé { .card { color: red; } }', '@supportsé'],
      ['@mediaé { .card { color: red; } }', '@mediaé'],
      ['@containeré { .card { color: red; } }', '@containeré']
    ] as const) {
      const cst = parseCssCst(source);
      expect(cst.errors).toHaveLength(0);
      expect(cst.unconsumedFrom).toBeNull();
      expect(parseAst(source).rules[0]).toMatchObject({ type: 'OpaqueAtRuleBlock', name });
    }
  });

  /*
   * The same boundary, in a PRELUDE keyword rather than an at-keyword. `only`
   * and `layer` are reserved media types and `none` a reserved container name;
   * under an ASCII-only boundary each matched inside a longer ident, so the
   * reserved-word rule fired on `onlyé`/`noneé` and the query grammar then
   * rejected the remainder — valid CSS refused. They are ordinary keywords.
   */
  it('ends a reserved query keyword at the full ident-continue boundary', () => {
    for (const [source, src] of [
      ['@media onlyé { .card { color: red; } }', 'onlyé'],
      ['@media layeré { .card { color: red; } }', 'layeré'],
      ['@container noneé { .card { color: red; } }', 'noneé']
    ] as const) {
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(parseAst(source).rules[0], source).toMatchObject({
        prelude: { type: 'Keyword', src }
      });
    }
  });

  it('constructs CSS imports as ordinary statement at-rules with grammar-owned preludes', () => {
    const document = parseAst('@IMPORT "theme.css" layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem); @import url(icons.css) print; @import url("quoted.css"); @import url();');

    expect(document.rules).toMatchObject([
      {
        type: 'AtRuleStatement',
        name: '@IMPORT',
        prelude: { type: 'Any', src: '"theme.css" layer(theme) supports(display: grid) screen and (min-width: 40rem)' }
      },
      {
        type: 'AtRuleStatement',
        name: '@import',
        prelude: { type: 'Any', src: 'url(icons.css) print' }
      },
      {
        type: 'AtRuleStatement',
        prelude: { type: 'Any', src: 'url("quoted.css")' }
      },
      {
        type: 'AtRuleStatement',
        prelude: { type: 'Any', src: 'url()' }
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@IMPORT "theme.css" layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem);\n@import url(icons.css) print;\n@import url("quoted.css");\n@import url();\n'
    });
  });

  it('admits top-level @imports only in the CSS import phase', () => {
    expect(parseAst('@layer reset, theme; @import "theme.css"; @layer components; @import "components.css"; .card { color: red; }')).toMatchObject({
      rules: [
        { type: 'AtRuleStatement', name: '@layer' },
        { type: 'AtRuleStatement', name: '@import' },
        { type: 'AtRuleStatement', name: '@layer' },
        { type: 'AtRuleStatement', name: '@import' },
        { type: 'Ruleset' }
      ]
    });

    for (const source of [
      '.card { color: red; } @import "late.css";',
      '@media screen { .card { color: red; } } @import "late.css";',
      '@layer reset { .card { color: red; } } @import "late.css";',
      '@font-face { font-family: F; } @import "late.css";'
    ]) {
      const cst = parseCssCst(source);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('normalizes import-local target trivia while preserving post-target tail bytes in its prelude', () => {
    const source = '@import/* keyword */ "theme.css"; @import /* target */ url( /* body */ icons.css /* close */ ); @import url(/* empty */); @import "tail.css"/* tail */screen;';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(bare(parse(source))).toEqual(bare(parseAst(source)));
    expect(parse(source).rules).toMatchObject([
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: '"theme.css"' } },
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: 'url(icons.css)' } },
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: 'url()' } },
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: '"tail.css" screen' } }
    ]);
  });

  it('does not lower comment-delimited url identifiers to Url or FunctionCall values', () => {
    const source = '.asset { background: url/* name-open */(icon.svg); }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    const document = parseAst(source);
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [{
        type: 'Declaration', name: 'background'
      }] }]
    });
    expect(containsNode(document, value => value.type === 'Url')).toBe(false);
    expect(containsNode(document, value => value.type === 'FunctionCall' && value.name === 'url')).toBe(false);
    expect(bare(parse(source))).toEqual(bare(parseAst(source)));

    const invalid = '.asset { background: url(foo bar); }';
    expect(() => parseAst(invalid), invalid).toThrow('CSS AST grammar did not consume the document');
    expect(() => parse(invalid), invalid).toThrow(SyntaxError);
  });

  it('keeps at-rule prelude comments out of semantic bytes while preserving them for rendering', () => {
    const document = parseAst('@namespace svg/* comment */url("https://example.test/ns");');

    expect(document.rules[0]).toMatchObject({
      type: 'AtRuleStatement',
      name: '@namespace',
      prelude: { type: 'Any', src: 'svg url("https://example.test/ns")' }
    });
    expect(serialize(document)).toEqual({
      css: '@namespace svg/* comment */url("https://example.test/ns");\n'
    });
  });

  /*
   * A custom-property value is one opaque token, so a comment the balanced-group
   * scanner steps over inside it is already part of the value bytes. Without the
   * value's opaque root-capture scope the renderer replays it a second time at
   * block level.
   */
  it('does not replay a comment inside an opaque custom value at block level', () => {
    for (const source of [':root{--x: (a /*c*/ b);}', ':root{--x: [a /*c*/ b];}']) {
      expect(serialize(parseAst(source)).css).not.toContain('\n  /*c*/');
    }
    expect(serialize(parseAst(':root{--x: (a /*c*/ b);}')).css)
      .toBe(':root {\n  --x: (a /*c*/ b);\n}\n');
  });

  /*
   * One comment only exercises the first per-node trivia entry, which reads
   * correctly at any stride. Three separated tokens are what distinguishes the
   * labeled stride from the unlabeled one: at the wrong stride the later
   * entries decode source offsets as child indices and their gaps vanish.
   */
  it('keeps every prelude gap when several comments separate the tokens', () => {
    const document = parseAst('@unknown a/* 1 */b/* 2 */c/* 3 */d;');

    expect(document.rules[0]).toMatchObject({
      type: 'AtRuleStatement',
      name: '@unknown',
      prelude: { type: 'Any', src: 'a b c d' }
    });
  });

  it('keeps @import outside the generic statement family and rejects malformed typed boundaries', () => {
    const result = run(cssGrammar.AtRuleStatement, '@import "theme.css";', { trivia: cssGrammar.whitespace });

    expect(result.ok).toBe(false);
    for (const input of [
      '@import;',
      '@import "theme.css" supports(display: grid;',
      '@import url(foo bar);'
    ]) {
      expect(() => parseAst(input)).toThrow();
    }
    expect(run(cssGrammar.ImportStatement, '@imported "theme.css";', { trivia: cssGrammar.whitespace }).ok).toBe(false);
  });

  it('constructs quoted, url, and function values without a value re-parser', () => {
    const document = parseAst('.asset { content: "hello\\\"world"; background: url("icons\\\"logo.svg"); color: rgb(255, 0, 128); }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'content', value: { type: 'Quoted', src: '"hello\\\"world"', value: 'hello\\\"world', quote: '"', escaped: false } },
        { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Quoted', value: 'icons\\\"logo.svg' } } },
        { type: 'Declaration', name: 'color', value: { type: 'FunctionCall', name: 'rgb', args: [{ value: { type: 'Dimension', number: 255 } }, { value: { type: 'Dimension', number: 0 } }, { value: { type: 'Dimension', number: 128 } }] } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.asset {\n  content: "hello\\\"world";\n  background: url("icons\\\"logo.svg");\n  color: rgb(255, 0, 128);\n}\n'
    });
  });

  it('captures custom declarations as one grammar-owned opaque value through balanced groups and quoted terminators', () => {
    const document = parseAst('.theme { --palette: { primary: rgb(1; 2); nested: ["}"; /* ; } */]; }; color: red; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        {
          type: 'Declaration',
          name: '--palette',
          value: { type: 'Any', src: '{ primary: rgb(1; 2); nested: ["}"; /* ; } */]; }' },
          important: false
        },
        { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.theme {\n  --palette: { primary: rgb(1; 2); nested: ["}"; /* ; } */]; };\n  color: red;\n}\n'
    });
  });

  it('strips a trailing custom-property priority marker into the declaration flag', () => {
    /*
     * css-syntax-3 §5.5.6 removes a trailing `!important` and sets the priority
     * flag before the custom-property original-text step, so the preserved value
     * excludes the marker *and* the whitespace in front of it. css-variables-1
     * §2.1 confirms the `<declaration-value>` top-level `!` ban does not apply.
     */
    const document = parseAst('.theme { --a: red !important; --b: red    !important; --c: red!important; --d: red ! important; --e: red !IMPORTANT; --f: red ! /*c*/ important; --g: !important; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: '--a', value: { type: 'Any', src: 'red' }, important: true },
        { type: 'Declaration', name: '--b', value: { type: 'Any', src: 'red' }, important: true },
        { type: 'Declaration', name: '--c', value: { type: 'Any', src: 'red' }, important: true },
        { type: 'Declaration', name: '--d', value: { type: 'Any', src: 'red' }, important: true },
        { type: 'Declaration', name: '--e', value: { type: 'Any', src: 'red' }, important: true },
        { type: 'Declaration', name: '--f', value: { type: 'Any', src: 'red' }, important: true },
        { type: 'Declaration', name: '--g', value: { type: 'Any', src: '' }, important: true }
      ]
    });
  });

  it('keeps a custom-property priority marker that is not the declaration trailer inside the value', () => {
    const document = parseAst('.theme { --a: red !importantx; --b: a !important b; --c: "a !important"; --d: f(a !important); --e: [a !important]; --f: red; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: '--a', value: { type: 'Any', src: 'red !importantx' }, important: false },
        { type: 'Declaration', name: '--b', value: { type: 'Any', src: 'a !important b' }, important: false },
        { type: 'Declaration', name: '--c', value: { type: 'Any', src: '"a !important"' }, important: false },
        { type: 'Declaration', name: '--d', value: { type: 'Any', src: 'f(a !important)' }, important: false },
        { type: 'Declaration', name: '--e', value: { type: 'Any', src: '[a !important]' }, important: false },
        { type: 'Declaration', name: '--f', value: { type: 'Any', src: 'red' }, important: false }
      ]
    });

    // Only the final marker is priority; the earlier one stays value text.
    expect(parseAst('.theme { --a: a !important !important; }').rules[0]).toMatchObject({
      rules: [{ type: 'Declaration', name: '--a', value: { type: 'Any', src: 'a !important' }, important: true }]
    });
  });

  it('round-trips a custom-property priority marker through serialization', () => {
    const document = parseAst('.theme { --accent: red !important; color: blue !important; }');

    expect(serialize(document)).toEqual({
      css: '.theme {\n  --accent: red !important;\n  color: blue !important;\n}\n'
    });
  });

  it('does not classify an ordinary declaration or a malformed custom-property boundary as a custom declaration', () => {
    expect(parseAst('.theme { color: red; }').rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
    });
    expect(() => parseAst('.theme { --palette: { primary: red; }')).toThrow('CSS AST grammar did not consume the document');
    expect(() => parseAst('.theme { --: red; }')).toThrow('CSS AST grammar did not consume the document');
  });

  it('keeps escaped declaration terminators and an empty custom value inside the custom-property grammar', () => {
    const document = parseAst('.theme { --escaped: before\\;after\\}still-value; --empty: ; color: red; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: '--escaped', value: { type: 'Any', src: 'before\\;after\\}still-value' } },
        { type: 'Declaration', name: '--empty', value: { type: 'Any', src: '' } },
        { type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.theme {\n  --escaped: before\\;after\\}still-value;\n  --empty: ;\n  color: red;\n}\n'
    });
  });

  it('accepts an escaped identifier start after the custom-property prefix', () => {
    const document = parseAst('.theme { --\\31 accent: red; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'Declaration', name: '--\\31 accent', value: { type: 'Any', src: 'red' } }]
    });
    expect(serialize(document)).toEqual({ css: '.theme {\n  --\\31 accent: red;\n}\n' });
  });

  it('commits url() after its opener instead of falling back to a generic call', () => {
    const result = run(cssGrammar.Value, 'url(foo bar)', { trivia: cssGrammar.whitespace });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ expected: [')'] });
    expect(result.value).toMatchObject({ type: 'Url', value: { type: 'Any', src: 'foo' } });
  });

  it('routes identifier-shaped value starts before the punctuation fallback', () => {
    for (const [source, expected] of [
      ['-foo', { type: 'Keyword', src: '-foo' }],
      ['--foo', { type: 'Keyword', src: '--foo' }],
      ['\\\\foo', { type: 'Keyword', src: '\\\\foo' }],
      ['-', { type: 'Any', src: '-' }]
    ] as const) {
      const result = run(cssGrammar.Value, source, { trivia: cssGrammar.whitespace });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
      expect(result.value, source).toMatchObject(expected);
    }
  });

  it('keeps unquoted url payload bytes when building ordinary declarations', () => {
    const document = parseAst('.asset { background: url(icon.svg); }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon.svg' } } }]
    });
    expect(serialize(document)).toEqual({ css: '.asset {\n  background: url(icon.svg);\n}\n' });
  });

  it('recognizes escaped url-token payloads through fused grammar syntax leaves', () => {
    const document = parseAst('.asset { background: url(icon\\41 svg); content: \'it\\\\\\\'s\'; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon\\41 svg' } } },
        { type: 'Declaration', name: 'content', value: { type: 'Quoted', src: '\'it\\\\\\\'s\'', value: 'it\\\\\\\'s', quote: '\'' } }
      ]
    });
    expect(serialize(document)).toEqual({ css: '.asset {\n  background: url(icon\\41 svg);\n  content: \'it\\\\\\\'s\';\n}\n' });
  });

  it('constructs an empty generic function call without inventing an argument', () => {
    const document = parseAst('.a { transform: translate(); }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'Declaration', name: 'transform', value: { type: 'FunctionCall', name: 'translate', args: [] } }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  transform: translate();\n}\n' });
  });

  it('builds calc arithmetic, modulo, and parentheses directly as canonical value nodes', () => {
    const document = parseAst('.a { width: calc(1px + 2px * (3 - 4)); remainder: calc(5px % 2); }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Declaration',
        name: 'width',
        value: {
          type: 'FunctionCall',
          name: 'calc',
          args: [{
            value: {
              type: 'Operation',
              operator: '+',
              left: { type: 'Dimension', number: 1, unit: 'px' },
              right: {
                type: 'Operation',
                operator: '*',
                left: { type: 'Dimension', number: 2, unit: 'px' },
                right: {
                  type: 'Block', delimiter: 'paren',
                  value: {
                    type: 'Operation',
                    operator: '-',
                    left: { type: 'Dimension', number: 3, unit: '' },
                    right: { type: 'Dimension', number: 4, unit: '' }
                  }
                }
              }
            }
          }]
        }
      }, {
        type: 'Declaration',
        name: 'remainder',
        value: {
          type: 'FunctionCall',
          name: 'calc',
          args: [{
            value: {
              type: 'Operation',
              operator: '%',
              left: { type: 'Dimension', number: 5, unit: 'px' },
              right: { type: 'Dimension', number: 2, unit: '' }
            }
          }]
        }
      }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  width: calc(1px + 2px * (3 - 4));\n  remainder: calc(5px % 2);\n}\n' });
  });

  it('composes structured function components in public declaration values without relaxing calc', () => {
    const source = '.a { a: url(x) / cover; b: var(--x) solid; c: rgb(1,2,3) / .5; d: foo(bar) baz; e: calc(1px + var(--x)); f: calc(var(--x, 1px + 2px) + 2px); g: calc(var(--x, red blue) + 2px); h: 0 calc(-1 * var(--x)); }';

    expect(parseCssCst(source).errors).toHaveLength(0);
    const directVar = run(cssGrammar.VarCall, 'var(--x, 1px + 2px)', { trivia: cssGrammar.whitespace });
    expect(directVar.ok, JSON.stringify(directVar)).toBe(true);
    expect(directVar.unconsumedFrom).toBeNull();
    const document = parseAst(source);
    expect(bare(parse(source))).toEqual(bare(document));
    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'Declaration', name: 'a', value: [{ type: 'Url' }, { type: 'Any', src: '/' }, { type: 'Keyword', src: 'cover' }] },
        { type: 'Declaration', name: 'b', value: [{ type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }] }, { type: 'Keyword', src: 'solid' }] },
        { type: 'Declaration', name: 'c', value: [{ type: 'FunctionCall', name: 'rgb', args: [{ value: { type: 'Dimension', number: 1 } }, { value: { type: 'Dimension', number: 2 } }, { value: { type: 'Dimension', number: 3 } }] }, { type: 'Any', src: '/' }, { type: 'Dimension', number: 0.5 }] },
        { type: 'Declaration', name: 'd', value: [{ type: 'FunctionCall', name: 'foo', args: [{ value: { type: 'Keyword', src: 'bar' } }] }, { type: 'Keyword', src: 'baz' }] },
        { type: 'Declaration', name: 'e', value: { type: 'FunctionCall', name: 'calc', args: [{ value: { type: 'Operation', operator: '+', right: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }] } } }] } },
        { type: 'Declaration', name: 'f', value: { type: 'FunctionCall', name: 'calc', args: [{ value: { type: 'Operation', operator: '+', left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: [{ type: 'Dimension', number: 1, unit: 'px' }, { type: 'Any', src: '+' }, { type: 'Dimension', number: 2, unit: 'px' }] }] }, right: { type: 'Dimension', number: 2, unit: 'px' } } }] } },
        { type: 'Declaration', name: 'g', value: { type: 'FunctionCall', name: 'calc', args: [{ value: { type: 'Operation', operator: '+', left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }] }] }, right: { type: 'Dimension', number: 2, unit: 'px' } } }] } },
        { type: 'Declaration', name: 'h', value: [{ type: 'Dimension', number: 0, unit: '' }, { type: 'FunctionCall', name: 'calc', args: [{ value: { type: 'Operation', operator: '*', left: { type: 'Dimension', number: -1, unit: '' }, right: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }] } } }] }] }
      ]
    });

    for (const malformed of ['.a { h: 0 calc(); }', '.a { h: 0 calc(+); }', '.a { h: 0 calc(1px +2px); }']) {
      const cst = parseCssCst(malformed);
      expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null), malformed).toBeGreaterThan(0);
      expect(() => parseAst(malformed), malformed).toThrow();
      expect(() => parse(malformed), malformed).toThrow(SyntaxError);
    }

    const nestedFallback = '.a { h: calc(var(--x, (foo) [foo]) + 2px); i: calc(var(--x, foo, bar) + 2px); j: calc(var(--x, foo([bar])) + 2px); k: calc(var(--x, {foo}) + 2px); l: calc(var(--x, var(--y, a, b)) + 2px); m: calc(var(--x,) + 2px); n: calc(var(--x, foo,) + 2px); o: calc(var(--x, foo(a,)) + 2px); p: calc(var(--x, foo(,a)) + 2px); q: calc(var(--x, a,,b) + 2px); }';
    const nestedDocument = parseAst(nestedFallback);
    expect(bare(parse(nestedFallback))).toEqual(bare(nestedDocument));
    expect(nestedDocument.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{
        type: 'Declaration', name: 'h', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: [{ type: 'Block', delimiter: 'paren', value: { type: 'Keyword', src: 'foo' } }, { type: 'Any', src: '[foo]' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'i', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'foo' }, { type: 'Keyword', src: 'bar' }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'j', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'FunctionCall', name: 'foo', args: [{ value: { type: 'Any', src: '[bar]' } }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'k', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'Any', src: '{foo}' } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'l', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--y' } }, { value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'a' }, { type: 'Keyword', src: 'b' }] } }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'm', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'Any', src: '' } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'n', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'foo' }, { type: 'Any', src: '' }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'o', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'FunctionCall', name: 'foo', args: [{ value: { type: 'Keyword', src: 'a' } }, { value: { type: 'Any', src: '' } }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'p', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'FunctionCall', name: 'foo', args: [{ value: { type: 'Any', src: '' } }, { value: { type: 'Keyword', src: 'a' } }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }, {
        type: 'Declaration', name: 'q', value: {
          type: 'FunctionCall', name: 'calc', args: [{ value: {
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ value: { type: 'Keyword', src: '--x' } }, { value: { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'a' }, { type: 'Any', src: '' }, { type: 'Keyword', src: 'b' }] } }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          } }]
        }
      }]
    });

    for (const invalid of [
      '.a { x: calc(var(--x, [a(b]c)]) + 2px); }',
      '.a { x: calc(var(--x, {a[b}c]}) + 2px); }',
      '.a { x: calc(var(--x, [a(b]) + 2px); }',
      '.a { x: calc(var(--x, {a[b}) + 2px); }',
      '.a { x: calc(var(--x, ([a)]) + 2px); }',
      '.a { x: calc(var(--x, ({a)}) + 2px); }',
      '.a { x: calc(var(--x, [(a]) + 2px); }',
      '.a { x: calc(var(--x, [{a]}) + 2px); }',
      '.a { x: calc(var(--x, {(a}) + 2px); }',
      '.a { x: calc(var(--x, {[a}]}) + 2px); }',
      '.a { x: calc(var(--x, ([a]) + 2px); }',
      '.a { x: calc(var(--x, [(a)) + 2px); }',
      '.a { x: calc(var(--x, {[a]) + 2px); }'
    ]) {
      const direct = run(cssGrammar.Stylesheet, invalid, { trivia: cssGrammar.whitespace });
      expect(direct.ok && direct.unconsumedFrom === null, invalid).toBe(false);
      expect(() => parse(invalid), invalid).toThrow();
    }
    for (const valid of [
      '.a { x: calc(var(--x, [a(b)c]) + 2px); }',
      '.a { x: calc(var(--x, {a[b]c}) + 2px); }',
      '.a { x: calc(var(--x, ([a])) + 2px); }',
      '.a { x: calc(var(--x, ({a})) + 2px); }',
      '.a { x: calc(var(--x, [(a)]) + 2px); }',
      '.a { x: calc(var(--x, [{a}]) + 2px); }',
      '.a { x: calc(var(--x, {(a)}) + 2px); }',
      '.a { x: calc(var(--x, {[a]}) + 2px); }',
      '.a { x: calc(var(--x, [a(b)]) + 2px); }',
      '.a { x: calc(var(--x, {a[b]}) + 2px); }'
    ]) {
      expect(() => parse(valid), valid).not.toThrow();
      expect(bare(parse(valid)), valid).toEqual(bare(parseAst(valid)));
    }
  });

  it('rejects malformed calc syntax at recognition without a reduction fallback', () => {
    for (const input of [
      '.a { width: calc(); }',
      '.a { width: calc(+); }',
      '.a { width: calc(1px +2px); }',
      '.a { width: calc(1px+ 2px); }',
      '.a { width: calc(1px -2px); }'
    ]) {
      try {
        const result = run(cssGrammar.Stylesheet, input, {
          trivia: cssGrammar.whitespace,
          rootTrivia: { select: commentTriviaLabels }
        });
        expect(result.ok && result.unconsumedFrom === null).toBe(false);
      } catch (error) {
        throw new Error(`${input}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  it('recognizes CSS importance as a declaration flag with case and trivia permitted by grammar', () => {
    const document = parseAst('.a { color: red ! IMPORTANT; }');

    expect(document.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'Declaration', name: 'color', important: true, value: { type: 'Keyword', src: 'red' } }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  color: red !important;\n}\n' });
  });

  it('keeps public declaration component comments out of values and priority markers', () => {
    const source = '.a { color: /* opening */ a/* ; */ b; background: foo, /* next term */ bar; padding: 1px/* separator */!important; width: 100px ! /*! marker */ important; }';

    expect(parseCssCst(source).errors).toHaveLength(0);
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        {
          type: 'Declaration',
          name: 'color',
          value: [{ type: 'Keyword', src: 'a' }, { type: 'Keyword', src: 'b' }],
          important: false
        },
        {
          type: 'Declaration',
          name: 'background',
          value: {
            type: 'List', sep: ',',
            value: [{ type: 'Keyword', src: 'foo' }, { type: 'Keyword', src: 'bar' }]
          }
        },
        { type: 'Declaration', name: 'padding', value: { type: 'Dimension', src: '1px' }, important: true },
        { type: 'Declaration', name: 'width', value: { type: 'Dimension', src: '100px' }, important: true }
      ]
    });
  });

  it('matches public declaration-list acceptance for empty statements across direct AST body families', () => {
    const source = `
      .host {
        ;; color: red;;
        @media screen { ;; width: 1px;; }
        @scope (.scope) { ;; height: 2px;; }
        @layer inner { ;; z-index: 1;; }
        @starting-style { ;; opacity: 0;; }
      }
      @font-face { ;; font-family: Demo;; }
      @page { ;; size: A4; @top-left { ;; content: "head";; } ;; }
      @font-feature-values Demo { @styleset { ;; nice: 1;; } }
      @keyframes fade { from { ;; opacity: 0;; } }
    `;

    expect(parseCssCst(source).errors).toHaveLength(0);
    const document = parseAst(source);

    expect(document.rules).toMatchObject([
      {
        type: 'Ruleset',
        rules: [
          { type: 'Declaration', name: 'color' },
          { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'Declaration', name: 'width' }] },
          { type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'Declaration', name: 'height' }] },
          { type: 'AtRuleBlock', name: '@layer', rules: [{ type: 'Declaration', name: 'z-index' }] },
          { type: 'AtRuleBlock', name: '@starting-style', rules: [{ type: 'Declaration', name: 'opacity' }] }
        ]
      },
      { type: 'AtRuleBlock', name: '@font-face', rules: [{ type: 'Declaration', name: 'font-family' }] },
      {
        type: 'AtRuleBlock', name: '@page', rules: [
          { type: 'Declaration', name: 'size' },
          { type: 'AtRuleBlock', name: '@top-left', rules: [{ type: 'Declaration', name: 'content' }] }
        ]
      },
      { type: 'AtRuleBlock', name: '@font-feature-values', rules: [{ type: 'AtRuleBlock', name: '@styleset', rules: [{ type: 'Declaration', name: 'nice' }] }] },
      { type: 'AtRuleBlock', name: '@keyframes', rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'opacity' }] }] }
    ]);
  });

  it('constructs valid non-import nested at-rule statements from declaration-list grammar', () => {
    const source = `
      .host {
        @unknown "theme.css";
        @media screen { @custom-state active; color: red; }
        @layer nested { @vendor feature(1); width: 1px; }
        @scope (.scope) { @custom-state ready; height: 2px; }
        @starting-style { @vendor state; opacity: 0; }
      }
    `;

    expect(parseCssCst(source).errors).toHaveLength(0);
    expect(parseAst(source).rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [
        { type: 'AtRuleStatement', name: '@unknown', prelude: { type: 'Any', src: '"theme.css"' } },
        { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'AtRuleStatement', name: '@custom-state' }, { type: 'Declaration', name: 'color' }] },
        { type: 'AtRuleBlock', name: '@layer', rules: [{ type: 'AtRuleStatement', name: '@vendor' }, { type: 'Declaration', name: 'width' }] },
        { type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'AtRuleStatement', name: '@custom-state' }, { type: 'Declaration', name: 'height' }] },
        { type: 'AtRuleBlock', name: '@starting-style', rules: [{ type: 'AtRuleStatement', name: '@vendor' }, { type: 'Declaration', name: 'opacity' }] }
      ]
    });
  });

  it('rejects nested @import statements in both CST and AST modes', () => {
    const source = '.host { @import "theme.css"; }';
    const cst = parseCssCst(source);

    /*
     * CSS imports are stylesheet-level only. The single grammar keeps @import
     * as a typed root fact and rejects it here rather than quietly lowering it
     * to a generic nested statement in CST mode.
     */
    expect(Number(!cst.ok) + cst.errors.length + Number(cst.unconsumedFrom !== null)).toBeGreaterThan(0);
    expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
  });

  it('admits CSS imports only in the stylesheet document body', () => {
    expect(parse('@import "top.css";')).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Any', src: '"top.css"' } }]
    });

    for (const source of [
      '.host { @import "nested.css"; }',
      '@media screen { @import "nested.css"; }',
      '@layer utilities { @import "nested.css"; }',
      '@scope (.host) { @import "nested.css"; }',
      '@starting-style { @import "nested.css"; }',
      '@document url("https://example.test/") { @import "nested.css"; }'
    ]) {
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('lowers nested scope bodies through existing AtRuleBlock nodes and renders them', () => {
    const source = '@scope (.outer) { @scope (.inner) { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const document = parseAst(source);
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [{
        type: 'AtRuleBlock', name: '@scope', rules: [{
          type: 'AtRuleBlock', name: '@scope', rules: [{ type: 'Declaration', name: 'color' }]
        }]
      }]
    });
    expect(serialize(document)).toEqual({
      css: '@scope (.outer) {\n  @scope (.inner) {\n    color: red;\n  }\n}\n'
    });
  });

  it('retains authored comments and multiline indentation on raw ValueSlot boundaries', () => {
    const document = parseAst('.a { color: red /* keep */\n  blue; shadow: a,\n  b; fn: foo(red /* keep fn */\n  blue); }');
    const body = document.rules[0];
    if (body?.type !== 'Ruleset') {
      throw new Error('expected a CSS rule');
    }
    const adjacent = body.rules[0]?.type === 'Declaration' ? body.rules[0].value : null;
    const comma = body.rules[1]?.type === 'Declaration' ? body.rules[1].value : null;
    const call = body.rules[2]?.type === 'Declaration' ? body.rules[2].value : null;
    expect(Array.isArray(adjacent)).toBe(true);
    expect(comma).toMatchObject({ type: 'List' });
    if (typeof adjacent !== 'object' || adjacent === null || typeof comma !== 'object' || comma === null) {
      throw new Error('expected structured declaration values');
    }
    expect(valueLayoutOf(adjacent)).toEqual([' /* keep */\n  ']);
    expect(valueLayoutOf(comma)).toEqual([',\n  ']);
    expect(call).toMatchObject({ type: 'FunctionCall', name: 'foo' });
    if (typeof call === 'object' && call !== null && !Array.isArray(call) && call.type === 'FunctionCall') {
      /* An argument is a `CallArg`; the authored layout belongs to its value
       * slot, which is the array the grammar recorded it against. */
      const firstArg = call.args[0]?.value;
      if (typeof firstArg !== 'object' || firstArg === null) {
        throw new Error('expected a structured function argument');
      }
      expect(valueLayoutOf(firstArg)).toEqual([' /* keep fn */\n  ']);
    }
    expect(serialize(document).css).toContain('color: red /* keep */\n    blue;');
    expect(serialize(document).css).toContain('shadow: a,\n    b;');
    expect(serialize(document).css).toContain('fn: foo(red /* keep fn */\n    blue);');
  });
});
