import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import { valueLayoutOf } from '@jesscss/core/ast';
import type { Stylesheet } from '@jesscss/core/ast';
import { serialize } from '../../core/src/ast/serialize.js';
import { cssAstGrammar } from '../src/ast/grammar.js';
import { parseCssCst } from '../src/cst-css.js';
import { parse } from '../src/index.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

function parseAst(input: string): Stylesheet {
  const result = run(cssAstGrammar.CssAstDocument, input, { trivia: cssAstGrammar.whitespace });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    throw new Error(`CSS AST grammar did not consume the document: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function valueLayout(value: unknown): ReturnType<typeof valueLayoutOf> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected a value object with provenance layout.');
  }
  return valueLayoutOf(value);
}

describe('CSS canonical-AST grammar', () => {
  it('keeps declaration-only permissive component values out of calc and nested-rule headers', () => {
    const document = parseAst('.a { x: (foo); ratio: 1 / 2; filter: alpha(opacity=50); flag: foo|bar; color: red ! IMPORTANT; b: c { color: blue; } }');
    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: 'x', value: { type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'foo' } } },
        { type: 'Declaration', name: 'ratio' },
        { type: 'Declaration', name: 'filter', value: { type: 'FunctionCall', name: 'alpha' } },
        { type: 'Declaration', name: 'flag' },
        { type: 'Declaration', name: 'color', important: true },
        { type: 'Rule' }
      ]
    });
  });

  it('uses shared basic-selector recognition plus structural attribute and percentage simple selectors', () => {
    for (const input of ['* { color: red; }', '.c\\6f lor { color: red; }', '#hero { color: red; }', '[role=button] { color: red; }', '50% { color: red; }']) {
      expect(parseAst(input).children[0]).toMatchObject({ type: 'Rule' });
    }
    for (const input of ['[role=] { color: red; }', '[role=button i extra] { color: red; }']) {
      expect(() => parseAst(input)).toThrow();
    }
  });

  it('constructs static pseudo classes and elements as direct canonical SimpleSelector nodes', () => {
    const document = parseAst('.card:hover::before { color: red; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      selector: {
        type: 'SelectorList',
        selectors: [{
          type: 'ComplexSelector',
          head: {
            type: 'CompoundSelector',
            simples: [
              { type: 'SimpleSelector', text: '.card' },
              { type: 'SimpleSelector', text: ':hover' },
              { type: 'SimpleSelector', text: '::before' }
            ]
          }
        }]
      }
    });
    expect(serialize(document)).toEqual({
      css: '.card:hover::before {\n  color: red;\n}\n'
    });
    expect(parseAst('.card:nth-child(2) { color: red; }').children[0]).toMatchObject({
      type: 'Rule', selector: { selectors: [{ head: { simples: [{ text: '.card' }, { text: ':nth-child(2)' }] } }] }
    });
  });

  it('matches public CST selector acceptance for attributes, recursive pseudo-selector arguments, raw pseudo arguments, and percentage simples', () => {
    for (const source of [
      '[role="button" i].card { color: red; }',
      ':is(.card, [data-kind=primary]) { color: red; }',
      ':nth-child(2n+1 of .item) { color: red; }',
      ':nth-child(-n+2 of .item) { color: red; }',
      ':lang(en-US) { color: red; }',
      '50% { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      expect(() => parseAst(source), source).not.toThrow();
    }

    const document = parseAst(':is(.card, [data-kind=primary]) { color: red; }');
    expect(document.children[0]).toMatchObject({
      type: 'Rule', selector: {
        selectors: [{ head: { simples: [{ text: ':is(.card,[data-kind=primary])' }] } }]
      }
    });

    for (const source of ['[role=] { color: red; }', ':is(.card { color: red; }', ':nth-child(-n+) { color: red; }']) {
      const cst = parseCssCst(source);
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('does not turn malformed numeric pseudo arguments into raw direct-AST selector text', () => {
    for (const source of [
      ':nth-child(2n +) { color: red; }',
      ':nth-child(1.5) { color: red; }',
      ':nth-child(2n+x) { color: red; }',
      ':nth-child(2n+1x) { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }

    for (const source of [
      ':nth-child(2n + 1) { color: red; }',
      ':nth-child(2n+1 of .item) { color: red; }'
    ]) {
      expect(() => parseAst(source), source).not.toThrow();
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

  it('treats public selector and declaration-internal comments as trivia without swallowing comment statements', () => {
    const source = '/* root */ a/* compound */.card /* descendant */ > /* combinator */ [data-kind /* attribute */ = /* value */ primary i]:/* pseudo */hover { /* body */ color /* colon */ : /* value */ red/* tail */; }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parse(source)).toEqual(parseAst(source));
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [
        { type: 'Comment', text: '/* root */' },
        {
          type: 'Rule',
          selector: {
            selectors: [{
              head: { simples: [{ text: 'a' }, { text: '.card' }] },
              tail: [{ comb: '>', compound: { simples: [{ text: '[data-kind=primaryi]' }, { text: ':hover' }] } }]
            }]
          },
          body: [
            { type: 'Comment', text: '/* body */' },
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
    expect(parse(source)).toEqual(parseAst(source));
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'Rule',
        selector: { selectors: [{ head: { simples: [{ text: 'a' }] } }] },
        body: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
      }]
    });

    // This boundary-only rule must not change the existing selector-internal
    // comment treatment into a lexical concatenation rule.
    expect(parseAst('a/**/.card { color: red; }').children[0]).toMatchObject({
      type: 'Rule',
      selector: { selectors: [{ head: { simples: [{ text: 'a' }, { text: '.card' }] } }] }
    });
  });

  it('does not let a comment glue separate lexical value tokens together', () => {
    const source = 'a { width: 10/* token */px; }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parse(source)).toEqual(parseAst(source));
    expect(parse(source).children[0]).toMatchObject({
      type: 'Rule',
      body: [{
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
      [':is(.card, :not(.disabled), :has(.icon > svg)) { color: red; }', [':is(.card,:not(.disabled),:has(.icon > svg))']],
      [':has(.card > .icon, :is(.badge, .label)) { color: red; }', [':has(.card > .icon,:is(.badge,.label))']],
      [':nth-child(2n + 1 of :is(.card, .tile)) { color: red; }', [':nth-child(2n + 1 of :is(.card, .tile))']],
      [':nth-child(-n+2 of .item) { color: red; }', [':nth-child(-n+2 of .item)']],
      [':nth-last-of-type(-5n) { color: red; }', [':nth-last-of-type(-5n)']],
      [':nth-child(- n+2) { color: red; }', [':nth-child(- n+2)']],
      [':nth-child(-n+2/* preserve */ of .item) { color: red; }', [':nth-child(-n+2/* preserve */ of .item)']],
      [':nth-child(-) { color: red; }', [':nth-child(-)']],
      ['50% { color: red; }', ['50%']]
    ];

    for (const [source, expectedSimples] of cases) {
      const cst = parseCssCst(source);
      expect(cst.errors, source).toHaveLength(0);
      expect(cst.unconsumedFrom, source).toBeNull();
      const document = parseAst(source);
      const first = document.children[0];
      expect(first, source).toMatchObject({ type: 'Rule' });
      if (first?.type !== 'Rule') {
        throw new Error(`Expected a rule for ${source}`);
      }
      expect(first.selector.selectors[0]?.head.simples.map(simple => simple.text), source).toEqual(expectedSimples);
    }

    for (const source of [
      '[data=] { color: red; }',
      '[data="x" ii] { color: red; }',
      ':is(.card, ) { color: red; }',
      ':has(.card { color: red; }'
    ]) {
      const cst = parseCssCst(source);
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow();
    }
  });

  it('constructs CSS nesting selectors as direct canonical SimpleSelector nodes', () => {
    const document = parseAst('.card { &.featured { color: red; } }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'Rule',
        selector: {
          type: 'SelectorList',
          selectors: [{
            type: 'ComplexSelector',
            head: {
              type: 'CompoundSelector',
              simples: [{ type: 'SimpleSelector', text: '&' }, { type: 'SimpleSelector', text: '.featured' }]
            }
          }]
        }
      }]
    });
    expect(serialize(document)).toEqual({
      css: '.card.featured {\n  color: red;\n}\n'
    });
  });

  it('shares the strict CSS hex-color terminal with the other direct dialect grammars', () => {
    expect(parseAst('.card { color: #0a1B2c; }').children[0]).toMatchObject({ type: 'Rule' });
    for (const input of ['.card { color: #fffff; }', '.card { color: #1234567; }']) {
      expect(() => parseAst(input)).toThrow();
    }
  });

  it('shares the public numeric grammar for exponent dimensions in declarations and calc', () => {
    const source = '.values { a: 1e3; b: -2.5E-1px; c: +.5e+2%; d: calc(1e2px + .5E1px); loose: 1 px; }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source).children[0]).toMatchObject({
      type: 'Rule',
      body: [
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
              type: 'Operation',
              operator: '+',
              left: { type: 'Dimension', number: 100, unit: 'px' },
              right: { type: 'Dimension', number: 5, unit: 'px' }
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
      children: [
        { type: 'Comment', text: '/* top */' },
        {
          type: 'Rule',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'ComplexSelector',
                head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card' }, { type: 'SimpleSelector', text: '.featured' }] },
                tail: [{ comb: '>', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '#hero' }] } }]
              },
              {
                type: 'ComplexSelector',
                head: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: 'main' }] },
                tail: [{ comb: ' ', compound: { type: 'CompoundSelector', simples: [{ type: 'SimpleSelector', text: '.card' }] } }]
              }
            ]
          },
          body: [
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

    expect(document.children[0]).toMatchObject({
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
      children: [{ type: 'AtRuleBlock', name: '@media', prelude: { type: 'SpacedValue' } }]
    });
    expect(() => parseAst('@media only (min-width: 1px) { .card { color: red; } }')).toThrow();
    expect(() => parseAst('@container only screen { .card { color: red; } }')).toThrow();
    expect(parseAst('@media not (min-width: 1px) { .card { color: red; } }')).toMatchObject({
      children: [{ type: 'AtRuleBlock', name: '@media' }]
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
      expect(parseAst(source).children[0]).toMatchObject({ type: 'AtRuleBlock' });
    }
    expect(parseAst('.card { @supports (display: grid) { display: grid; } }').children[0]).toMatchObject({
      type: 'Rule', body: [{ type: 'AtRuleBlock', name: '@supports' }]
    });
    for (const source of [
      '@supports (display: grid) { @font-face { font-family: A; src: url(a); } }',
      '@supports (display: grid) { @layer x { .grid { display: grid; } } }',
      '@supports (display: grid) { @starting-style { .grid { display: grid; } } }'
    ]) {
      expect(parseCssCst(source).errors).toHaveLength(0);
      expect(parseAst(source).children[0]).toMatchObject({ type: 'AtRuleBlock', body: [{ type: 'AtRuleBlock' }] });
    }

    const document = parseAst('@supports not ((display: grid) and (color: red)) { .grid { display: grid; } }');
    expect(document.children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      prelude: {
        type: 'SpacedValue',
        parts: [
          { type: 'Keyword', src: 'not' },
          { type: 'Block', delimiter: 'paren', inner: { type: 'SpacedValue' } }
        ]
      }
    });
    expect(parseAst('@SUPPORTS NOT (display: grid) { .grid { display: grid; } }').children[0]).toMatchObject({
      name: '@SUPPORTS', prelude: { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'NOT' }, { type: 'Block', delimiter: 'paren' }] }
    });

    for (const source of [
      '@supports color { .grid { display: grid; } }',
      '@supports { .grid { display: grid; } }'
    ]) {
      expect(parseCssCst(source).errors.length).toBeGreaterThan(0);
      expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
    }
    // General-enclosed forms are an explicitly typed, syntax-preserving payload;
    // they are not FunctionCall(Any) or an opaque at-rule fallback.
    for (const source of [
      '@supports selector(.grid > .item) { .grid { display: grid; } }',
      '@supports future-feature(foo(bar)) { .grid { display: grid; } }',
      '@supports (display: grid) and selector(.grid) { .grid { display: grid; } }'
    ]) {
      expect(parseCssCst(source).errors).toHaveLength(0);
      expect(parseAst(source)).toMatchObject({ type: 'Stylesheet' });
    }
    // The production grammar currently accepts a comma list here, despite the
    // spec's narrower supports-condition shape. Direct AST must not silently
    // narrow the public language during the cutover.
    expect(parseAst('@supports (display: grid), (color: red) { .grid { display: grid; } }').children[0]).toMatchObject({
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
      children: [{
        type: 'AtRuleBlock', name: '@supports', prelude: {
          type: 'GeneralEnclosed', form: 'function', name: 'selector',
          content: { type: 'Interpolation', parts: [{ lit: '  .grid /* keep */ [data-kind=")"] :is(.a, .b) ' }] }
        }
      }]
    });

    const paren = '@supports (future-feature "quoted ) byte" [x]) { .grid { display: grid; } }';
    expect(parseCssCst(paren).errors).toHaveLength(0);
    expect(parseAst(paren)).toMatchObject({
      children: [{
        prelude: {
          type: 'GeneralEnclosed', form: 'paren', name: null,
          content: { type: 'Interpolation', parts: [{ lit: 'future-feature "quoted ) byte" [x]' }] }
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
      expect(parse(input), input).toEqual(parseAst(input));
    }
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      body: [{ type: 'Comment', text: '/* body */' }, { type: 'Rule' }]
    });
  });

  it('does not unglue public-invalid supports function tokens while adding supports comment trivia', () => {
    for (const source of [
      '@supports selector/* glue */(.grid) { .grid { display: grid; } }',
      '@supports style/* glue */(--theme: dark) { .grid { display: grid; } }'
    ]) {
      const cst = parseCssCst(source);
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
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
    expect(document.children).toMatchObject([
      { type: 'AtRuleBlock', name: '@SUPPORTS', prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } }, body: [{ type: 'Rule' }] },
      { type: 'AtRuleBlock', name: '@container', prelude: { type: 'SpacedValue', parts: [{ type: 'Keyword', src: 'sidebar' }, { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: '>' } }] }, body: [{ type: 'Rule' }] },
      { type: 'AtRuleBlock', name: '@FONT-FACE', prelude: null, body: [{ type: 'Declaration', name: 'font-family' }, { type: 'Declaration', name: 'src' }] },
      { type: 'AtRuleBlock', name: '@property', prelude: { type: 'Any', src: '--angle' }, body: [{ type: 'Declaration', name: 'syntax' }, { type: 'Declaration', name: 'inherits' }, { type: 'Declaration', name: 'initial-value' }] },
      { type: 'AtRuleBlock', name: '@scope', prelude: { type: 'Any', src: '(.card) to (.edge)' }, body: [{ type: 'Declaration', name: 'color' }, { type: 'Rule' }] }
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
      expect(parseAst(range).children[0], range).toMatchObject({
        type: 'AtRuleBlock',
        prelude: { type: 'Block', delimiter: 'paren' }
      });
    }
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@media',
      prelude: {
        type: 'Block', delimiter: 'paren',
        inner: {
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

  it('uses declaration-list bodies for nested conditional blocks, like the public CST grammar', () => {
    const source = 'a { @media (width: 1px) { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors, JSON.stringify(cst.errors)).toHaveLength(0);
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'AtRuleBlock',
        name: '@media',
        prelude: { type: 'Block', delimiter: 'paren', inner: { type: 'Operation', operator: ':' } },
        body: [{ type: 'Declaration', name: 'color' }]
      }]
    });
  });

  it('constructs arbitrary public query-function payloads without reparsing their balanced bytes', () => {
    const source = '@container sidebar style(--theme: dark) and scroll-state(stuck: block-start) { .card { color: red; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@container',
      prelude: {
        type: 'SpacedValue',
        parts: [
          { type: 'Keyword', src: 'sidebar' },
          { type: 'FunctionCall', name: 'style', args: [{ type: 'Any', src: '--theme: dark' }] },
          { type: 'Keyword', src: 'and' },
          { type: 'FunctionCall', name: 'scroll-state', args: [{ type: 'Any', src: 'stuck: block-start' }] }
        ]
      },
      body: [{ type: 'Rule' }]
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
    expect(document.children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@PAGE',
      prelude: { type: 'Any', src: 'report:left' },
      body: [
        { type: 'Declaration', name: 'size' },
        { type: 'Declaration', name: 'margin' },
        { type: 'AtRuleBlock', name: '@TOP-LEFT-CORNER', prelude: null, body: [{ type: 'Declaration', name: 'content' }] },
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
    expect(parse(source)).toEqual(parseAst(source));
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@page',
      body: [
        { type: 'AtRuleBlock', name: '@top-left-corner', prelude: null, body: [{ type: 'Comment', text: '/* body */' }, { type: 'Declaration', name: 'content' }] },
        ...names.slice(1).map(name => ({ type: 'AtRuleBlock', name: `@${name}`, prelude: null, body: [{ type: 'Declaration', name: 'content' }] }))
      ]
    });
  });

  it('does not split public-invalid page-margin at-keywords while adding header comments', () => {
    const source = '@page report { @top/* split */-left { content: "x"; } }';
    const cst = parseCssCst(source);

    expect(cst.errors.length + Number(cst.unconsumedFrom !== null)).toBeGreaterThan(0);
    expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
    expect(() => parse(source)).toThrow(SyntaxError);
  });

  it('retains the public CST page-keyword boundary behavior', () => {
    for (const source of ['@pageé { size: A4; }']) {
      expect(parseCssCst(source).errors).toHaveLength(0);
      expect(parseAst(source).children[0]).toMatchObject({ type: 'AtRuleBlock' });
    }
  });

  it('rejects rules and nested at-rules in page and margin-box declaration bodies', () => {
    for (const source of [
      '@page { .rule { color: red; } }',
      '@page { @media (width: 1px) { .rule { color: red; } } }',
      '@page { @top-center { .rule { color: red; } } }',
      '@page { @top-center { @media (width: 1px) { color: red; } } }'
    ]) {
      expect(parseCssCst(source).errors.length).toBeGreaterThan(0);
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

    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@FONT-FEATURE-VALUES',
      prelude: { type: 'Any', src: '"Fira Code", Demo' },
      body: [
        { type: 'Comment', text: '/* family */' },
        { type: 'AtRuleBlock', name: '@STYLISTIC', prelude: null, body: [{ type: 'Declaration', name: 'salt' }] },
        { type: 'AtRuleBlock', name: '@styleset', prelude: null, body: [{ type: 'Declaration', name: 'nice' }] },
        { type: 'AtRuleBlock', name: '@character-variant', prelude: null, body: [{ type: 'Declaration', name: 'cv01' }] },
        { type: 'AtRuleBlock', name: '@swash', prelude: null, body: [{ type: 'Declaration', name: 'swsh' }] },
        { type: 'AtRuleBlock', name: '@ornaments', prelude: null, body: [{ type: 'Declaration', name: 'orn' }] },
        { type: 'AtRuleBlock', name: '@annotation', prelude: null, body: [{ type: 'Declaration', name: 'note' }] },
        { type: 'AtRuleBlock', name: '@historical-forms', prelude: null, body: [{ type: 'Declaration', name: 'hist' }] }
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
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), source).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('keeps the public font-feature keyword boundary and header-comment trivia behavior', () => {
    const source = '@font-feature-valuesé { @styleset /* header */ { nice: 1; } }';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@font-feature-values',
      prelude: { type: 'Any', src: 'é' },
      body: [{ type: 'AtRuleBlock', name: '@styleset', prelude: null, body: [{ type: 'Declaration', name: 'nice' }] }]
    });
  });

  it('constructs non-import statement at-rule headers as grammar-owned public bytes', () => {
    const document = parseAst('@namespace svg url("https://example.test/ns"); @layer utilities; @layer; .card { color: red; }');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleStatement',
        name: '@namespace',
        prelude: { type: 'Any', src: 'svg url("https://example.test/ns")' }
      },
      { type: 'AtRuleStatement', name: '@layer', prelude: { type: 'Any', src: 'utilities' } },
      { type: 'AtRuleStatement', name: '@layer', prelude: null },
      { type: 'Rule' }
    ]);
    expect(serialize(document)).toEqual({
      css: '@namespace svg url("https://example.test/ns");\n@layer utilities;\n@layer;\n.card {\n  color: red;\n}\n'
    });
  });

  it('constructs case-insensitive named and anonymous @layer blocks as structured AST subtrees', () => {
    const document = parseAst('@LAYER utilities.components { .card { color: red; } } @layer { .reset { margin: 0; } }');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleBlock',
        name: '@LAYER',
        prelude: { type: 'Any', src: 'utilities.components' },
        body: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
      },
      {
        type: 'AtRuleBlock',
        name: '@layer',
        prelude: null,
        body: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
      }
    ]);
    expect(serialize(document)).toEqual({
      css: '@LAYER utilities.components {\n  .card {\n    color: red;\n  }\n}\n@layer {\n  .reset {\n    margin: 0;\n  }\n}\n'
    });
  });

  it('constructs keyframe selector blocks directly instead of treating keyframes as ordinary rulesets', () => {
    const document = parseAst('@KEYFRAMES fade { /* half-way */ from, 50% { opacity: 0; } to { opacity: 1; } } @-MOZ-KEYFRAMES zoom { from { opacity: 0; } }');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleBlock',
        name: '@KEYFRAMES',
        prelude: { type: 'Any', src: 'fade' },
        body: [
          { type: 'Comment', text: '/* half-way */' },
          {
            type: 'Rule',
            selector: {
              type: 'SelectorList',
              selectors: [
                { type: 'ComplexSelector', head: { simples: [{ type: 'SimpleSelector', text: 'from' }] } },
                { type: 'ComplexSelector', head: { simples: [{ type: 'SimpleSelector', text: '50%' }] } }
              ]
            },
            body: [{ type: 'Declaration', name: 'opacity' }]
          },
          {
            type: 'Rule',
            selector: { type: 'SelectorList', selectors: [{ type: 'ComplexSelector', head: { simples: [{ type: 'SimpleSelector', text: 'to' }] } }] }
          }
        ]
      },
      {
        type: 'AtRuleBlock',
        name: '@-MOZ-KEYFRAMES',
        prelude: { type: 'Any', src: 'zoom' },
        body: [{ type: 'Rule', selector: { type: 'SelectorList' } }]
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
    expect(parse(source)).toEqual(parseAst(source));
    expect(parseAst(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{
        type: 'AtRuleBlock',
        name: '@keyframes',
        body: [
          { type: 'Comment', text: '/* body */' },
          {
            type: 'Rule',
            selector: {
              type: 'SelectorList',
              selectors: [
                { type: 'ComplexSelector', head: { simples: [{ type: 'SimpleSelector', text: 'from' }] } },
                { type: 'ComplexSelector', head: { simples: [{ type: 'SimpleSelector', text: '50%' }] } },
                { type: 'ComplexSelector', head: { simples: [{ type: 'SimpleSelector', text: 'to' }] } }
              ]
            },
            body: [
              { type: 'Comment', text: '/* declaration */' },
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
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'AtRuleBlock', name: '@layer', prelude: { type: 'Any', src: 'utilities, components /* keep */' }, body: [{ type: 'Rule' }]
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

    expect(parseAst(source).children).toMatchObject([
      { type: 'AtRuleBlock', name: '@STARTING-STYLE', prelude: { type: 'Any', src: 'legacy header' }, body: [{ type: 'Rule' }] },
      { type: 'AtRuleBlock', name: '@SCOPE', prelude: null, body: [{ type: 'Declaration' }, { type: 'Rule' }] },
      { type: 'AtRuleBlock', name: '@KEYFRAMES', prelude: { type: 'Any', src: 'fade alternate' }, body: [{ type: 'Rule' }] },
      { type: 'AtRuleStatement', name: '@CHARSET', prelude: { type: 'Any', src: 'custom (encoding)' } },
      { type: 'AtRuleStatement', name: '@namespace', prelude: { type: 'Any', src: 'svg /* keep */ url("https://example.test/ns")' } }
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
    expect(parseAst(source).children).toMatchObject([
      { type: 'AtRuleBlock', name: '@layer', body: [{ type: 'AtRuleStatement' }, { type: 'AtRuleBlock', name: '@keyframes' }] },
      { type: 'AtRuleBlock', name: '@starting-style', body: [{ type: 'AtRuleStatement' }, { type: 'AtRuleBlock', name: '@keyframes' }] },
      { type: 'Rule', body: [
        { type: 'AtRuleBlock', name: '@layer', body: [{ type: 'Declaration', name: 'color' }, { type: 'AtRuleBlock', name: '@starting-style', body: [{ type: 'Declaration', name: 'color' }] }] },
        { type: 'AtRuleBlock', name: '@scope', body: [{ type: 'Declaration', name: 'color' }, { type: 'AtRuleStatement', name: '@namespace' }] },
        { type: 'AtRuleBlock', name: '@starting-style', body: [{ type: 'Declaration', name: 'color' }] }
      ] }
    ]);
  });

  it('keeps @charset in the public generic statement and unknown-block families', () => {
    for (const [source, expected] of [
      ['@charseté custom;', { type: 'AtRuleStatement', name: '@charseté', prelude: { type: 'Any', src: 'custom' } }],
      ['@charset { body: raw; }', { type: 'OpaqueAtRuleBlock', name: '@charset', prelude: null, rawBody: ' body: raw; ' }]
    ] as const) {
      const cst = parseCssCst(source);
      expect(cst.errors).toHaveLength(0);
      expect(cst.unconsumedFrom).toBeNull();
      expect(parseAst(source).children[0]).toMatchObject(expected);
    }
  });

  it('constructs unknown block at-rules as opaque grammar-owned raw bodies', () => {
    const source = '@layered screen {\n  raw: fn("}", /* keep */ nested({ value: 1; }));\n  @nested { value: "{ }"; }\n}';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const document = parseAst(source);
    expect(document.children).toMatchObject([{
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
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null)).toBeGreaterThan(0);
      expect(() => parseAst(source), source).toThrow('CSS AST grammar did not consume the document');
    }
  });

  it('constructs @document and @-moz-document frame-one bodies directly', () => {
    const source = '@-MOZ-DOCUMENT url-prefix("https://example.test/"), domain("example.test") {\n  @font-face { font-family: Demo; src: url(demo.woff2); }\n  .card { color: red; }\n}';
    const cst = parseCssCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    const document = parseAst(source);
    expect(document.children).toMatchObject([{
      type: 'AtRuleBlock',
      name: '@-MOZ-DOCUMENT',
      prelude: { type: 'Any', src: 'url-prefix("https://example.test/"), domain("example.test")' },
      body: [
        { type: 'AtRuleBlock', name: '@font-face' },
        { type: 'Rule' }
      ]
    }]);
  });

  it('keeps the public ASCII known-at-keyword boundary before a Unicode prelude', () => {
    for (const [source, name] of [
      ['@scopeé { .card { color: red; } }', '@scope'],
      ['@layeré { .card { color: red; } }', '@layer'],
      ['@documenté { .card { color: red; } }', '@document']
    ] as const) {
      const cst = parseCssCst(source);
      expect(cst.errors).toHaveLength(0);
      expect(cst.unconsumedFrom).toBeNull();
      expect(parseAst(source).children[0]).toMatchObject({ type: 'AtRuleBlock', name });
    }
  });

  it('constructs CSS imports as ordinary statement at-rules with grammar-owned preludes', () => {
    const document = parseAst('@IMPORT "theme.css" layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem); @import url(icons.css) print; @import url("quoted.css"); @import url();');

    expect(document.children).toMatchObject([
      {
        type: 'AtRuleStatement',
        name: '@IMPORT',
        prelude: { type: 'Any', src: '"theme.css" layer(theme) /* keep */ supports(display: grid) screen and (min-width: 40rem)' }
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

  it('normalizes import-local target trivia while preserving post-target tail bytes in its prelude', () => {
    const source = '@import/* keyword */ "theme.css"; @import /* target */ url /* open */ ( /* body */ icons.css /* close */ ); @import url(/* empty */); @import "tail.css"/* tail */screen;';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parse(source)).toEqual(parseAst(source));
    expect(parse(source).children).toMatchObject([
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: '"theme.css"' } },
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: 'url(icons.css)' } },
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: 'url()' } },
      { type: 'AtRuleStatement', prelude: { type: 'Any', src: '"tail.css" /* tail */screen' } }
    ]);
  });

  it('keeps ordinary declaration url-name delimiter comments structured without widening url payloads', () => {
    const source = '.asset { background: url/* name-open */(icon.svg); }';
    const cst = parseCssCst(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(parseAst(source)).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'Rule', body: [{
        type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon.svg' } }
      }] }]
    });
    expect(parse(source)).toEqual(parseAst(source));

    for (const invalid of [
      '.asset { background: url(foo bar); }',
      '.asset { background: url/* name-open */(foo bar); }'
    ]) {
      expect(() => parseAst(invalid), invalid).toThrow('CSS AST grammar did not consume the document');
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('preserves whitespace and comments outside CSS import tail groups', () => {
    const document = parseAst('@import "x.css" /* comment */  screen and ( color : red );');

    expect(document.children[0]).toMatchObject({
      type: 'AtRuleStatement',
      name: '@import',
      prelude: { type: 'Any', src: '"x.css" /* comment */  screen and ( color : red )' }
    });
    expect(serialize(document)).toEqual({
      css: '@import "x.css" /* comment */  screen and ( color : red );\n'
    });
  });

  it('keeps @import outside the generic statement family and rejects malformed typed boundaries', () => {
    const result = run(cssAstGrammar.CssAstAtRuleStatement, '@import "theme.css";', { trivia: cssAstGrammar.whitespace });

    expect(result.ok).toBe(false);
    for (const input of [
      '@import;',
      '@import "theme.css" supports(display: grid;',
      '@import url(foo bar);'
    ]) {
      expect(() => parseAst(input)).toThrow();
    }
    expect(run(cssAstGrammar.CssAstImport, '@imported "theme.css";', { trivia: cssAstGrammar.whitespace }).ok).toBe(false);
  });

  it('constructs quoted, url, and function values without a value re-parser', () => {
    const document = parseAst('.asset { content: "hello\\\"world"; background: url("icons\\\"logo.svg"); color: rgb(255, 0, 128); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: 'content', value: { type: 'Quoted', src: '"hello\\\"world"', value: 'hello\\\"world', quote: '"', escaped: false } },
        { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Quoted', value: 'icons\\\"logo.svg' } } },
        { type: 'Declaration', name: 'color', value: { type: 'FunctionCall', name: 'rgb', args: [{ type: 'Dimension', number: 255 }, { type: 'Dimension', number: 0 }, { type: 'Dimension', number: 128 }] } }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.asset {\n  content: "hello\\\"world";\n  background: url("icons\\\"logo.svg");\n  color: rgb(255, 0, 128);\n}\n'
    });
  });

  it('captures custom declarations as one grammar-owned opaque value through balanced groups and quoted terminators', () => {
    const document = parseAst('.theme { --palette: { primary: rgb(1; 2); nested: ["}"; /* ; } */]; }; color: red; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
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

  it('does not classify an ordinary declaration or a malformed custom-property boundary as a custom declaration', () => {
    expect(parseAst('.theme { color: red; }').children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'color', value: { type: 'Keyword', src: 'red' } }]
    });
    expect(() => parseAst('.theme { --palette: { primary: red; }')).toThrow('CSS AST grammar did not consume the document');
    expect(() => parseAst('.theme { --: red; }')).toThrow('CSS AST grammar did not consume the document');
  });

  it('keeps escaped declaration terminators and an empty custom value inside the custom-property grammar', () => {
    const document = parseAst('.theme { --escaped: before\\;after\\}still-value; --empty: ; color: red; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
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

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: '--\\31 accent', value: { type: 'Any', src: 'red' } }]
    });
    expect(serialize(document)).toEqual({ css: '.theme {\n  --\\31 accent: red;\n}\n' });
  });

  it('commits url() after its opener instead of falling back to a generic call', () => {
    const result = run(cssAstGrammar.CssAstDocument, '.a { background: url(foo bar); }', { trivia: cssAstGrammar.whitespace });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ expected: [')'] });
  });

  it('keeps unquoted url payload bytes when building ordinary declarations', () => {
    const document = parseAst('.asset { background: url(icon.svg); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon.svg' } } }]
    });
    expect(serialize(document)).toEqual({ css: '.asset {\n  background: url(icon.svg);\n}\n' });
  });

  it('recognizes escaped url-token payloads through fused grammar syntax leaves', () => {
    const document = parseAst('.asset { background: url(icon\\41 svg); content: \'it\\\\\\\'s\'; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: 'background', value: { type: 'Url', value: { type: 'Any', src: 'icon\\41 svg' } } },
        { type: 'Declaration', name: 'content', value: { type: 'Quoted', src: '\'it\\\\\\\'s\'', value: 'it\\\\\\\'s', quote: '\'' } }
      ]
    });
    expect(serialize(document)).toEqual({ css: '.asset {\n  background: url(icon\\41 svg);\n  content: \'it\\\\\\\'s\';\n}\n' });
  });

  it('constructs an empty generic function call without inventing an argument', () => {
    const document = parseAst('.a { transform: translate(); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'transform', value: { type: 'FunctionCall', name: 'translate', args: [] } }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  transform: translate();\n}\n' });
  });

  it('builds calc arithmetic, modulo, and parentheses directly as canonical value nodes', () => {
    const document = parseAst('.a { width: calc(1px + 2px * (3 - 4)); remainder: calc(5px % 2); }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'Declaration',
        name: 'width',
        value: {
          type: 'FunctionCall',
          name: 'calc',
          args: [{
            type: 'Operation',
            operator: '+',
            left: { type: 'Dimension', number: 1, unit: 'px' },
            right: {
              type: 'Operation',
              operator: '*',
              left: { type: 'Dimension', number: 2, unit: 'px' },
              right: {
                type: 'Block', delimiter: 'paren',
                inner: {
                  type: 'Operation',
                  operator: '-',
                  left: { type: 'Dimension', number: 3, unit: '' },
                  right: { type: 'Dimension', number: 4, unit: '' }
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
            type: 'Operation',
            operator: '%',
            left: { type: 'Dimension', number: 5, unit: 'px' },
            right: { type: 'Dimension', number: 2, unit: '' }
          }]
        }
      }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  width: calc(1px + 2px * (3 - 4));\n  remainder: calc(5px % 2);\n}\n' });
  });

  it('composes structured function components in public declaration values without relaxing calc', () => {
    const source = '.a { a: url(x) / cover; b: var(--x) solid; c: rgb(1,2,3) / .5; d: foo(bar) baz; e: calc(1px + var(--x)); f: calc(var(--x, 1px + 2px) + 2px); g: calc(var(--x, red blue) + 2px); h: 0 calc(-1 * var(--x)); }';

    expect(parseCssCst(source).errors).toHaveLength(0);
    const directVar = run(cssAstGrammar.CssAstCalcVarCall, 'var(--x, 1px + 2px)', { trivia: cssAstGrammar.whitespace });
    expect(directVar.ok, JSON.stringify(directVar)).toBe(true);
    expect(directVar.unconsumedFrom).toBeNull();
    const document = parseAst(source);
    expect(parse(source)).toEqual(document);
    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'Declaration', name: 'a', value: [{ type: 'Url' }, { type: 'Any', src: '/' }, { type: 'Keyword', src: 'cover' }] },
        { type: 'Declaration', name: 'b', value: [{ type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }] }, { type: 'Keyword', src: 'solid' }] },
        { type: 'Declaration', name: 'c', value: [{ type: 'FunctionCall', name: 'rgb', args: [{ type: 'Dimension', number: 1 }, { type: 'Dimension', number: 2 }, { type: 'Dimension', number: 3 }] }, { type: 'Any', src: '/' }, { type: 'Dimension', number: 0.5 }] },
        { type: 'Declaration', name: 'd', value: [{ type: 'FunctionCall', name: 'foo', args: [{ type: 'Keyword', src: 'bar' }] }, { type: 'Keyword', src: 'baz' }] },
        { type: 'Declaration', name: 'e', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '+', right: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }] } }] } },
        { type: 'Declaration', name: 'f', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '+', left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, [{ type: 'Dimension', number: 1, unit: 'px' }, { type: 'Any', src: '+' }, { type: 'Dimension', number: 2, unit: 'px' }]] }, right: { type: 'Dimension', number: 2, unit: 'px' } }] } },
        { type: 'Declaration', name: 'g', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '+', left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, [{ type: 'Keyword', src: 'red' }, { type: 'Keyword', src: 'blue' }]] }, right: { type: 'Dimension', number: 2, unit: 'px' } }] } },
        { type: 'Declaration', name: 'h', value: [{ type: 'Dimension', number: 0, unit: '' }, { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '*', left: { type: 'Dimension', number: -1, unit: '' }, right: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }] } }] }] }
      ]
    });

    for (const malformed of ['.a { h: 0 calc(); }', '.a { h: 0 calc(+); }', '.a { h: 0 calc(1px +2px); }']) {
      const cst = parseCssCst(malformed);
      expect(cst.errors.length + Number(cst.unconsumedFrom !== null), malformed).toBeGreaterThan(0);
      expect(() => parseAst(malformed), malformed).toThrow();
      expect(() => parse(malformed), malformed).toThrow(SyntaxError);
    }

    const nestedFallback = '.a { h: calc(var(--x, (foo) [foo]) + 2px); i: calc(var(--x, foo, bar) + 2px); j: calc(var(--x, foo([bar])) + 2px); k: calc(var(--x, {foo}) + 2px); l: calc(var(--x, var(--y, a, b)) + 2px); m: calc(var(--x,) + 2px); n: calc(var(--x, foo,) + 2px); o: calc(var(--x, foo(a,)) + 2px); p: calc(var(--x, foo(,a)) + 2px); q: calc(var(--x, a,,b) + 2px); }';
    const nestedDocument = parseAst(nestedFallback);
    expect(parse(nestedFallback)).toEqual(nestedDocument);
    expect(nestedDocument.children[0]).toMatchObject({
      type: 'Rule',
      body: [{
        type: 'Declaration', name: 'h', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, [{ type: 'Block', delimiter: 'paren', inner: { type: 'Keyword', src: 'foo' } }, { type: 'Any', src: '[foo]' }]] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'i', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'foo' }, { type: 'Keyword', src: 'bar' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'j', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'FunctionCall', name: 'foo', args: [{ type: 'Any', src: '[bar]' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'k', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'Any', src: '{foo}' }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'l', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--y' }, { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'a' }, { type: 'Keyword', src: 'b' }] }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'm', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'Any', src: '' }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'n', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'foo' }, { type: 'Any', src: '' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'o', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'FunctionCall', name: 'foo', args: [{ type: 'Keyword', src: 'a' }, { type: 'Any', src: '' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'p', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'FunctionCall', name: 'foo', args: [{ type: 'Any', src: '' }, { type: 'Keyword', src: 'a' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
        }
      }, {
        type: 'Declaration', name: 'q', value: {
          type: 'FunctionCall', name: 'calc', args: [{
            type: 'Operation', operator: '+',
            left: { type: 'FunctionCall', name: 'var', args: [{ type: 'Keyword', src: '--x' }, { type: 'List', sep: ',', value: [{ type: 'Keyword', src: 'a' }, { type: 'Any', src: '' }, { type: 'Keyword', src: 'b' }] }] },
            right: { type: 'Dimension', number: 2, unit: 'px' }
          }]
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
      const direct = run(cssAstGrammar.CssAstDocument, invalid, { trivia: cssAstGrammar.whitespace });
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
      expect(parse(valid), valid).toEqual(parseAst(valid));
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
        const result = run(cssAstGrammar.CssAstDocument, input, { trivia: cssAstGrammar.whitespace });
        expect(result.ok && result.unconsumedFrom === null).toBe(false);
      } catch (error) {
        throw new Error(`${input}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  it('recognizes CSS importance as a declaration flag with case and trivia permitted by grammar', () => {
    const document = parseAst('.a { color: red ! IMPORTANT; }');

    expect(document.children[0]).toMatchObject({
      type: 'Rule',
      body: [{ type: 'Declaration', name: 'color', important: true, value: { type: 'Keyword', src: 'red' } }]
    });
    expect(serialize(document)).toEqual({ css: '.a {\n  color: red !important;\n}\n' });
  });

  it('keeps public declaration component comments out of values and priority markers', () => {
    const source = '.a { color: /* opening */ a/* ; */ b; background: foo, /* next term */ bar; padding: 1px/* separator */!important; width: 100px ! /*! marker */ important; }';

    expect(parseCssCst(source).errors).toHaveLength(0);
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'Rule',
      body: [
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

    expect(document.children).toMatchObject([
      {
        type: 'Rule',
        body: [
          { type: 'Declaration', name: 'color' },
          { type: 'AtRuleBlock', name: '@media', body: [{ type: 'Declaration', name: 'width' }] },
          { type: 'AtRuleBlock', name: '@scope', body: [{ type: 'Declaration', name: 'height' }] },
          { type: 'AtRuleBlock', name: '@layer', body: [{ type: 'Declaration', name: 'z-index' }] },
          { type: 'AtRuleBlock', name: '@starting-style', body: [{ type: 'Declaration', name: 'opacity' }] }
        ]
      },
      { type: 'AtRuleBlock', name: '@font-face', body: [{ type: 'Declaration', name: 'font-family' }] },
      {
        type: 'AtRuleBlock', name: '@page', body: [
          { type: 'Declaration', name: 'size' },
          { type: 'AtRuleBlock', name: '@top-left', body: [{ type: 'Declaration', name: 'content' }] }
        ]
      },
      { type: 'AtRuleBlock', name: '@font-feature-values', body: [{ type: 'AtRuleBlock', name: '@styleset', body: [{ type: 'Declaration', name: 'nice' }] }] },
      { type: 'AtRuleBlock', name: '@keyframes', body: [{ type: 'Rule', body: [{ type: 'Declaration', name: 'opacity' }] }] }
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
    expect(parseAst(source).children[0]).toMatchObject({
      type: 'Rule',
      body: [
        { type: 'AtRuleStatement', name: '@unknown', prelude: { type: 'Any', src: '"theme.css"' } },
        { type: 'AtRuleBlock', name: '@media', body: [{ type: 'AtRuleStatement', name: '@custom-state' }, { type: 'Declaration', name: 'color' }] },
        { type: 'AtRuleBlock', name: '@layer', body: [{ type: 'AtRuleStatement', name: '@vendor' }, { type: 'Declaration', name: 'width' }] },
        { type: 'AtRuleBlock', name: '@scope', body: [{ type: 'AtRuleStatement', name: '@custom-state' }, { type: 'Declaration', name: 'height' }] },
        { type: 'AtRuleBlock', name: '@starting-style', body: [{ type: 'AtRuleStatement', name: '@vendor' }, { type: 'Declaration', name: 'opacity' }] }
      ]
    });
  });

  it('does not inherit the legacy CST grammar\'s invalid nested @import statement acceptance', () => {
    const source = '.host { @import "theme.css"; }';

    // The historic CST declarationList uses the broad generic at-keyword and
    // therefore accepts this shape. CSS imports are stylesheet-level only;
    // the direct grammar keeps @import as a typed root fact and rejects it
    // here rather than quietly lowering it to a generic statement.
    expect(parseCssCst(source).errors).toHaveLength(0);
    expect(() => parseAst(source)).toThrow('CSS AST grammar did not consume the document');
  });

  it('admits CSS imports only in the stylesheet document body', () => {
    expect(parse('@import "top.css";')).toMatchObject({
      type: 'Stylesheet',
      children: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Any', src: '"top.css"' } }]
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
      children: [{
        type: 'AtRuleBlock', name: '@scope', body: [{
          type: 'AtRuleBlock', name: '@scope', body: [{ type: 'Declaration', name: 'color' }]
        }]
      }]
    });
    expect(serialize(document)).toEqual({
      css: '@scope (.outer) {\n  @scope (.inner) {\n    color: red;\n  }\n}\n'
    });
  });

  it('retains authored comments and multiline indentation on raw ValueSlot boundaries', () => {
    const document = parseAst('.a { color: red /* keep */\n  blue; shadow: a,\n  b; fn: foo(red /* keep fn */\n  blue); }');
    const body = document.children[0];
    if (body?.type !== 'Rule') {
      throw new Error('expected a CSS rule');
    }
    const adjacent = body.body[0]?.type === 'Declaration' ? body.body[0].value : null;
    const comma = body.body[1]?.type === 'Declaration' ? body.body[1].value : null;
    const call = body.body[2]?.type === 'Declaration' ? body.body[2].value : null;
    expect(Array.isArray(adjacent)).toBe(true);
    expect(comma).toMatchObject({ type: 'List' });
    expect(valueLayout(adjacent)).toEqual([' /* keep */\n  ']);
    expect(valueLayout(comma)).toEqual([',\n  ']);
    expect(call).toMatchObject({ type: 'FunctionCall', name: 'foo' });
    if (call && !Array.isArray(call) && call.type === 'FunctionCall') {
      expect(valueLayout(call.args[0])).toEqual([' /* keep fn */\n  ']);
    }
    expect(serialize(document).css).toContain('color: red /* keep */\n    blue;');
    expect(serialize(document).css).toContain('shadow: a,\n    b;');
    expect(serialize(document).css).toContain('fn: foo(red /* keep fn */\n    blue);');
  });
});
