import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import {
  bodySpanOf,
  sourceSpanOf,
  triviaMapOf,
  valueLayoutOf
} from '../../../../core/src/ast/provenance.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import {
  LessBareVariableInterpolationError,
  LessImportPostludeError,
  LessParseError,
  LessUnsupportedVariableNameError,
  parse
} from '@jesscss/less-parser';
import { parseLessCst, parseLessDoc } from '@jesscss/less-parser/cst';

/*
 * Relative source imports, not the `/positions` package subpaths: vitest aliases
 * only the BARE package name to `src`, so a subpath import would resolve to
 * `lib` and put a second `LessParseError` class in the run — which is exactly
 * what `toBeInstanceOf` below would then fail on.
 */
import { parse as parseWithLines } from '../src/positions.js';
import { parseLessCst as parseLessCstWithLines } from '../src/cst/positions.js';
import { bare } from '../../../../../test/provenance-free.js';

const simpleSelector = (text: string | null, extra: object = {}) => ({
  type: 'SimpleSelector',
  text,
  interp: null,
  ...extra
});
const compoundSelector = (...value: object[]) => ({
  type: 'CompoundSelector',
  value
});
const simpleComplex = (text: string) => simpleSelector(text);
const compoundComplex = (...value: object[]) => compoundSelector(...value);

describe('public Less parse()', () => {
  it('attaches line facts when parse() comes from the line-aware entry', () => {
    try {
      parseWithLines('.card {}\n@media');
      throw new Error('expected parse() to reject an incomplete at-rule');
    } catch (error) {
      expect(error).toBeInstanceOf(LessParseError);
      expect(error).toMatchObject({ line: 2 });
    }
  });

  it('attaches line facts to CST spans when parseLessCst() comes from the line-aware entry', () => {
    const result = parseLessCstWithLines('.card {\n  width: 1px;\n}', 'Stylesheet');

    expect(result.span.startLine).toBe(1);
    expect(result.span.endLine).toBe(3);
  });

  it('keeps provenance for composite math without storing it on standalone dimensions', () => {
    const source = '.x { plain: 10px; math: (1px * 1em / 1cm); }';
    const document = parse(source);
    const rule = document.rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new Error('expected a ruleset');
    }
    const plain = rule.rules[0];
    const math = rule.rules[1];
    if (plain?.type !== 'Declaration' || math?.type !== 'Declaration') {
      throw new Error('expected two declarations');
    }
    if (
      math.value.type !== 'Block'
      || Array.isArray(math.value.value)
      || math.value.value.type !== 'Operation'
    ) {
      throw new Error('expected parenthesized arithmetic');
    }

    expect(sourceSpanOf(plain.value)).toBeUndefined();
    const outer = math.value.value;
    if (outer.left.type !== 'Operation') {
      throw new Error('expected the left folded operation');
    }
    expect(sourceSpanOf(outer.left)).toEqual({
      start: source.indexOf('1px'),
      end: source.indexOf('/') - 1
    });
    expect(sourceSpanOf(outer)).toEqual({
      start: source.indexOf('1px'),
      end: source.indexOf(')')
    });
  });

  it('keeps trivia through a silent ruleset optional-semicolon tail', () => {
    const source = '.a{}/*between-close-and-semicolon*/;.b{color:blue;}';

    expect(
      serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.b {\n  color: blue;\n}\n'
    );
  });

  it('keeps selector and body provenance without a duplicate ruleset span', () => {
    const source = '.a{color:red;}';
    const document = parse(source);
    const rule = document.rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new Error('expected a ruleset');
    }

    expect(sourceSpanOf(rule)).toBeUndefined();
    expect(sourceSpanOf(rule.selector)).toEqual({ start: 0, end: 2 });
    expect(bodySpanOf(rule)).toEqual({ start: 3, end: 13 });
  });

  it('keeps a ruleset span only when an optional semicolon owns tail trivia', () => {
    const source = '.outer{.inner{}/*between-close-and-semicolon*/;}';
    const document = parse(source);
    const outer = document.rules[0];
    const inner = outer?.type === 'Ruleset' ? outer.rules[0] : undefined;
    if (outer?.type !== 'Ruleset' || inner?.type !== 'Ruleset') {
      throw new Error('expected nested rulesets');
    }

    expect(sourceSpanOf(outer)).toBeUndefined();
    expect(sourceSpanOf(inner)).toEqual({
      start: source.indexOf('.inner'),
      end: source.lastIndexOf(';') + 1
    });
  });

  it('parses CSS named colors as Keyword values, materialized to Color only when operated on', () => {
    const document = parse(
      '@tone: ReD; .card { color: lighten(@tone, 10%); enabled: iscolor(blue); plain: redder; current: currentColor; }'
    );

    expect(document).toMatchObject({
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'tone',
          value: { type: 'Keyword', src: 'ReD' }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: {
                type: 'FunctionCall',
                name: 'lighten',
                args: [
                  { value: { type: 'Lookup', kind: 'var', name: 'tone', raw: '@tone', scope: 'scoped' } },
                  { value: { type: 'Dimension', src: '10%' } }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'enabled',
              value: {
                type: 'FunctionCall',
                name: 'iscolor',
                args: [{ value: { type: 'Keyword', src: 'blue' } }]
              }
            },
            {
              type: 'Declaration',
              name: 'plain',
              value: { type: 'Keyword', src: 'redder' }
            },
            {
              type: 'Declaration',
              name: 'current',
              value: { type: 'Keyword', src: 'currentColor' }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card {\n  color: #ff3333;\n  enabled: true;\n  plain: redder;\n  current: currentColor;\n}\n'
    );
    expect(parse('.x { color: redder; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Keyword', src: 'redder' } }] }]
    });
    expect(parse('.x { color: red-2; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Keyword', src: 'red-2' } }] }]
    });
    expect(parse('.x { color: red(foo); }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'FunctionCall', name: 'red' } }] }]
    });
  });

  it('retains parser provenance for direct function calls without changing their AST shape', () => {
    const source = '.x { color: rgb(50%,0,0); }';
    const document = parse(source);
    const rule = document.rules[0];
    const declaration = rule?.type === 'Ruleset' ? rule.rules[0] : undefined;
    if (
      declaration?.type !== 'Declaration'
      || typeof declaration.value !== 'object'
      || declaration.value === null
    ) {
      throw new Error('expected a declaration with a structured value');
    }

    expect(sourceSpanOf(declaration.value)).toEqual({
      start: source.indexOf('rgb'),
      end: source.indexOf(')') + 1
    });
  });

  it('reduces generic Less function delimiters into flat typed arguments', () => {
    const document = parse('.card { value: fn(red; 10px); emit(red; 10px); }');
    const rule = document.rules[0];
    if (rule?.type !== 'Ruleset') {
      throw new Error('expected a rule');
    }
    const declaration = rule.rules[0];
    const statement = rule.rules[1];
    if (
      declaration?.type !== 'Declaration'
      || declaration.value.type !== 'FunctionCall'
    ) {
      throw new Error('expected a function-valued declaration');
    }
    if (statement?.type !== 'FunctionCall') {
      throw new Error('expected a function statement');
    }

    expect(declaration.value).toMatchObject({
      type: 'FunctionCall',
      name: 'fn',
      args: [
        { value: { type: 'Keyword', src: 'red' } },
        { value: { type: 'Dimension', src: '10px' } }
      ]
    });
    expect(statement).toMatchObject({
      type: 'FunctionCall',
      name: 'emit',
      args: [
        { value: { type: 'Keyword', src: 'red' } },
        { value: { type: 'Dimension', src: '10px' } }
      ]
    });

    /*
     * `;` is authored layout, while the AST remains a flat typed positional
     * argument vector. Rendering canonicalizes generic call delimiters to `,`.
     */
    expect(valueLayoutOf(declaration.value.args)).toEqual(['; ']);
    expect(valueLayoutOf(statement.args)).toEqual(['; ']);

    const mixed = parse(
      '.card { first: fn(red, 10px; blue); second: fn(red; 10px, blue); final: fn(red;); }'
    );
    const mixedRule = mixed.rules[0];
    if (mixedRule?.type !== 'Ruleset') {
      throw new Error('expected a mixed-delimiter rule');
    }
    const [first, second, final] = mixedRule.rules;
    if (
      first?.type !== 'Declaration'
      || second?.type !== 'Declaration'
      || final?.type !== 'Declaration'
      || first.value.type !== 'FunctionCall'
      || second.value.type !== 'FunctionCall'
      || final.value.type !== 'FunctionCall'
    ) {
      throw new Error('expected mixed-delimiter function declarations');
    }
    expect(first.value.args).toMatchObject([
      { value: { type: 'Keyword', src: 'red' } },
      { value: { type: 'Dimension', src: '10px' } },
      { value: { type: 'Keyword', src: 'blue' } }
    ]);
    expect(second.value.args).toMatchObject([
      { value: { type: 'Keyword', src: 'red' } },
      { value: { type: 'Dimension', src: '10px' } },
      { value: { type: 'Keyword', src: 'blue' } }
    ]);
    expect(final.value.args).toMatchObject([{ value: { type: 'Keyword', src: 'red' } }]);
    expect(valueLayoutOf(first.value.args)).toEqual([', ', '; ']);
    expect(valueLayoutOf(second.value.args)).toEqual(['; ', ', ']);

    /*
     * A final delimiter is valid Less syntax but has no following argument, so
     * the flat argument vector has no separator boundary to record.
     */
    expect(valueLayoutOf(final.value.args)).toEqual([]);
    expect(serialize(mixed).css).toBe(
      '.card {\n'
      + '  first: fn(red, 10px, blue);\n'
      + '  second: fn(red, 10px, blue);\n'
      + '  final: fn(red);\n'
      + '}\n'
    );

    const nested = parse(
      '.m(@x) { result: @x; } .card { .m(fn(red, 10px; blue)); }'
    );
    const nestedRule = nested.rules[1];
    if (
      nestedRule?.type !== 'Ruleset'
      || nestedRule.rules[0]?.type !== 'MixinCall'
    ) {
      throw new Error('expected a mixin call with a nested function argument');
    }
    const nestedFunction = nestedRule.rules[0].args[0]?.value;
    if (nestedFunction?.type !== 'FunctionCall') {
      throw new Error('expected a nested FunctionCall');
    }
    expect(nestedFunction.args).toMatchObject([
      { value: { type: 'Keyword', src: 'red' } },
      { value: { type: 'Dimension', src: '10px' } },
      { value: { type: 'Keyword', src: 'blue' } }
    ]);
    expect(valueLayoutOf(nestedFunction.args)).toEqual([', ', '; ']);
    expect(() => parse('.card { value: fn(red;;blue); }')).toThrow(SyntaxError);
  });

  it('keeps direct parse error messages free of raw Parseman expected tokens', () => {
    const source =
      '.theme(){foo:bar;} .val { @alias: .theme; foo: @alias[foo]; }';
    let thrown: unknown;

    try {
      parse(source);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LessParseError);
    if (!(thrown instanceof LessParseError)) {
      throw new Error('expected a LessParseError');
    }

    /*
     * The failure lands on the `:` in `@alias:`. Under parseman 0.48.1's honest
     * narrowing the deepest frame is a rule/selector position — a block,
     * combinator, class/id selector, or mixin call could continue — not a value
     * position; it only reported "Expected a Less value" while the 0.46.0
     * OP_CHOICE union bug widened the expected set into the value-atom
     * signature. The direct-parse message summary has no selector-context
     * branch, so it falls to the bare-generic form. That is clean (the point of
     * this test); a nicer selector summary lives on the core-classifier path and
     * is a consistency follow-up, not a regression.
     */
    expect(thrown.message).toBe(
      'Unexpected Less syntax. Expected valid Less syntax here.'
    );
    expect(thrown.message).not.toContain('NumberToken');
    expect(thrown.message).not.toContain('not(regex)');
    expect(thrown.message).not.toContain('/(?!');
    expect(thrown.message).not.toContain('[.#]');
    expect(thrown.message).not.toContain('u0080');

    /*
     * The raw recognition facts stay available on `.expected`, just never in the
     * user-facing message. The narrowed frame carries the selector-context set.
     */
    expect(thrown.expected).toContain('"{"');
    expect(thrown.expected).toContain('"("');
  });

  it('summarizes direct structural parse errors without hiding raw expected facts', () => {
    const cases = [
      {
        source: '.entry { color: rgb(1,2; }',
        message: 'Missing closing parenthesis.',
        expected: '")"'
      },
      {
        source: '@namespace svg url(http://www.w3.org/2000/svg) .x {}',
        message: 'Missing semicolon.',
        expected: '";"'
      }
    ] as const;

    for (const testCase of cases) {
      let thrown: unknown;

      try {
        parse(testCase.source);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(LessParseError);
      if (!(thrown instanceof LessParseError)) {
        throw new Error('expected a LessParseError');
      }
      expect(thrown.message).toBe(testCase.message);
      expect(thrown.message).not.toContain('Expected:');
      expect(thrown.message).not.toContain('/(?!');
      expect(thrown.expected).toContain(testCase.expected);
    }
  });

  it('returns the canonical Stylesheet directly while named CST/document APIs remain available', () => {
    const source = '@tone: red;\n.card { color: @tone; }';
    const cst = parseLessCst(source);
    const doc = parseLessDoc(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(doc.tree).not.toBeNull();
    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'tone',
          value: { type: 'Keyword', src: 'red' }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Lookup', kind: 'var', name: 'tone', raw: '@tone' }
            }
          ]
        }
      ]
    });
  });

  it('preserves structured rest arguments through the public parse and render route', () => {
    const source = `
.collect(@values...) {
  count: length(@values);
  first: extract(@values, 1);
  third: extract(@values, 3);
  args: @arguments;
}
.space { .collect(a b c); }
.comma { .collect(a, b, c); }
.semi { .collect(1; 2; 3); }
`;
    const document = parse(source);

    expect(document).toMatchObject({ type: 'Stylesheet' });
    expect(document.rules[0]).toMatchObject({
      type: 'MixinDefinition',
      params: [{ name: 'values', rest: true }]
    });
    expect(document.rules[1]).toMatchObject({
      type: 'Ruleset',
      rules: [
        {
          type: 'MixinCall',
          args: [
            {
              value: [
                { type: 'Keyword', src: 'a' },
                { type: 'Keyword', src: 'b' },
                { type: 'Keyword', src: 'c' }
              ]
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.space {\n  count: 1;\n  first: a b c;\n  third: extract(a b c, 3);\n  args: a b c;\n}\n'
      + '.comma {\n  count: 3;\n  first: a;\n  third: c;\n  args: a b c;\n}\n'
      + '.semi {\n  count: 3;\n  first: 1;\n  third: 3;\n  args: 1 2 3;\n}\n'
    );
  });

  it('parses and renders attribute-targeted extends through the canonical AST', () => {
    const document = parse(`
.attributes {
  [data="test"] { extend: attributes; }
  .attribute-test { &:extend([data="test"] all); }
}
`);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset', rules: [{ type: 'Ruleset' }, { type: 'Ruleset' }] }]
    });
    expect(
      serialize(document, {
        evaluator: buildEvaluator(makeLessRegistry()),
        collapseNesting: false
      }).css
    ).toBe(
      '.attributes {\n'
      + '  [data="test"],\n'
      + '  .attribute-test {\n'
      + '    extend: attributes;\n'
      + '  }\n'
      + '}\n'
    );
  });

  it('preserves declaration and nested-rule source order when collapsing nesting', () => {
    const document = parse(
      '.parent { before: one; .child { inside: two; } after: three; }'
    );

    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.parent {\n'
      + '  before: one;\n'
      + '}\n'
      + '.parent .child {\n'
      + '  inside: two;\n'
      + '}\n'

      // Moving `after` ahead of the child would change cascade order.
      + '.parent {\n'
      + '  after: three;\n'
      + '}\n'
    );
  });

  it('does not expose a CST-to-AST compatibility route through parse()', () => {
    expect(() => parse('.card { color: red;')).toThrow(SyntaxError);
  });

  it('constructs standalone Plugin facts with grammar-owned targets and option segments', () => {
    const document = parse(
      '@plugin (mode=@{mode}, nested=(a b)) "./plugin-@{name}.js";'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Plugin',
          target: { type: 'Interpolation' },
          options: { type: 'Interpolation' }
        }
      ]
    });
    const directive = document.rules[0];
    expect(directive?.type).toBe('Plugin');
    if (directive?.type !== 'Plugin') {
      throw new Error('Expected Plugin AST fact.');
    }
    expect(directive.options?.parts).toEqual(
      expect.arrayContaining([{ lit: 'mode=' }, { lit: ', nested=(a b)' }])
    );
  });

  it('keeps explicit empty Less declaration values as canonical empty facts', () => {
    const document = parse('.card { margin: ; padding:; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'margin',
              value: { type: 'Any', src: '' }
            },
            {
              type: 'Declaration',
              name: 'padding',
              value: { type: 'Any', src: '' }
            }
          ]
        }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.card {\n  margin: ;\n  padding: ;\n}\n'
    });
  });

  it('recognizes spaced Less priority markers as typed importance', () => {
    const document = parse(
      '.card { color: red !important; width: 100%!important; height: 20px ! important; }'
    );

    expect(document).toMatchObject({
      rules: [
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: 'color', important: true },
            { type: 'Declaration', name: 'width', important: true },
            { type: 'Declaration', name: 'height', important: true }
          ]
        }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.card {\n  color: red !important;\n  width: 100% !important;\n  height: 20px !important;\n}\n'
    });
  });

  it('returns interpolated general-enclosed supports facts through public parse()', () => {
    const source =
      '@kind: card; @supports selector(.@{kind} /* keep */ :is(.a, .b)) { .card { color: red; } }';
    const cst = parseLessCst(source);
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();

    expect(parse(source)).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'kind' },
        {
          type: 'AtRuleBlock',
          name: '@supports',
          prelude: {
            type: 'FunctionCall',
            name: 'selector',
            args: [{ value: {
              type: 'Interpolation',
              parts: [
                { lit: '.' },
                {
                  ref: {
                    type: 'Lookup', kind: 'var',
                    name: 'kind',
                    raw: '@kind',
                    scope: 'scoped'
                  },
                  unquote: true
                },
                { lit: ' /* keep */ :is(.a, .b)' }
              ]
            } }]
          }
        }
      ]
    });
  });

  it('returns detached rulesets only through public Less call-argument and parameter-default routes', () => {
    const source =
      '@theme: { color: red; }; .m(@default: { width: 1px; }) { } .m({ color: blue; }); .m(@named: { color: green; }); fn({ display: block; });';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: { type: 'AnonymousMixin' }
        },
        {
          type: 'MixinDefinition',
          name: '.m',
          params: [{ name: 'default', default: { type: 'AnonymousMixin' } }]
        },
        {
          type: 'MixinCall',
          name: '.m',
          args: [{ value: { type: 'AnonymousMixin' } }]
        },
        {
          type: 'MixinCall',
          name: '.m',
          args: [{ name: 'named', value: { type: 'AnonymousMixin' } }]
        },
        {
          type: 'FunctionCall',
          name: 'fn',
          args: [{ value: { type: 'AnonymousMixin' } }]
        }
      ]
    });

    /*
     * A detached ruleset is valid as a function argument (including in a
     * declaration value); only a bare value or percent-format argument is invalid.
     */
    for (const rejected of [
      'value: { color: red; };',
      'value: %({ color: red; });'
    ]) {
      const legacy = parseLessCst(rejected);
      expect(legacy.unconsumedFrom, rejected).not.toBeNull();
      expect(() => parse(rejected), rejected).toThrow(SyntaxError);
    }
  });

  it('keeps an existing CSS import fact at its nested rule placement through public parse and render', () => {
    const source = '.card { @import url("nested.css"); color: red; }';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'AtRuleStatement',
              name: '@import',
              prelude: { type: 'Url', value: { value: 'nested.css' } }
            },
            { type: 'Declaration', name: 'color' }
          ]
        }
      ]
    });
    expect(serialize(document)).toEqual({
      css: '.card {\n  @import url("nested.css");\n  color: red;\n}\n'
    });
  });

  it('uses a static Less selector capture through the public AST and render route', () => {
    const source =
      '@targets: *[.notice, .tail:nth-child(-n+2)]; @{targets} { color: red; }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'targets',
          value: {
            type: 'SelectorCapture',
            branches: ['.notice', '.tail:nth-child(-n+2)']
          }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.notice,\n.tail:nth-child(-n+2) {\n  color: red;\n}\n');

    for (const invalid of [
      '@targets: *[@{selector}];',
      '@targets: *[.card-@{tone}];',
      '@targets: *[.card:not(@{tone})];',
      '@targets: * [.notice];'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('retains top-level comments as public Stylesheet trivia', () => {
    const source = '/* before */ .card { color: red; } /* after */';
    const document = parse(source);
    const trivia = triviaMapOf(document);

    expect(
      trivia?.commentRuns().map(run => source.slice(run.start, run.end))
    ).toEqual(['/* before */ ', ' /* after */']);
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }
      ]
    });
  });

  it('retains block comments at typed function-argument boundaries on the public route', () => {
    const source =
      '.card { background: linear-gradient(#333 /* keep */, #111); }';
    const document = parse(source);
    const trivia = triviaMapOf(document);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'FunctionCall',
                name: 'linear-gradient',
                args: [
                  { value: { type: 'Color', src: '#333' } },
                  { value: { type: 'Color', src: '#111' } }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(
      trivia?.commentRuns().map(run => source.slice(run.start, run.end))
    ).toContain(' /* keep */');
    expect(serialize(document).css).toBe(
      '.card {\n  background: linear-gradient(#333 /* keep */, #111);\n}\n'
    );
  });

  it('retains comments in a mixin definition body after its signature closes', () => {
    const source =
      '.theme() { color: red; /* keep body trivia */ background: blue; } .card { .theme(); }';
    const document = parse(source);
    const trivia = triviaMapOf(document);

    expect(
      trivia?.commentRuns().map(run => source.slice(run.start, run.end))
    ).toContain(' /* keep body trivia */ ');
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  color: red;\n  /* keep body trivia */\n  background: blue;\n}\n');
  });

  it('serializes function-boundary block comments from public trivia, not value nodes', () => {
    const source =
      '.card { shadow: rgb(1, /* note */ 2); mixed: mix(blue, #FFF /* explanation */, 50%); }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'FunctionCall',
                name: 'rgb',
                args: [
                  { value: { type: 'Dimension', src: '1' } },
                  { value: { type: 'Dimension', src: '2' } }
                ]
              }
            },
            {
              type: 'Declaration',
              value: {
                type: 'FunctionCall',
                name: 'mix',
                args: [
                  { value: { type: 'Keyword', src: 'blue' } },
                  { value: { type: 'Color', src: '#FFF' } },
                  { value: { type: 'Dimension', src: '50%' } }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(serialize(document).css).toBe(
      '.card {\n  shadow: rgb(1, /* note */ 2);\n  mixed: mix(blue, #FFF /* explanation */, 50%);\n}\n'
    );
  });

  it('retains declaration-head block comments as trivia, not property-name bytes', () => {
    const document = parse('.card { color/* survive */ /* me too */: grey; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'grey' }
            }
          ]
        }
      ]
    });
    expect(serialize(document).css).toBe(
      '.card {\n  color/* survive */ /* me too */: grey;\n}\n'
    );
  });

  it('treats Less line comments as trivia', () => {
    expect(parse('// setup\n.card { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' }
            }
          ]
        }
      ]
    });
    expect(
      parse('.card { background: url(//cdn.example/icon.svg); }')
    ).toMatchObject({
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'background',
              value: {
                type: 'Url',
                value: { type: 'Any', src: '//cdn.example/icon.svg' }
              }
            }
          ]
        }
      ]
    });
  });

  it('preserves wrapped unquoted data URLs through the public parser boundary', () => {
    expect(
      parse(
        '.asset { image: url( data:image/png;base64,\n  kiVBORw0K\n  k//+l2Z/dA== ); }'
      )
    ).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'image',
              value: {
                type: 'Url',
                value: {
                  type: 'Any',
                  src: 'data:image/png;base64,\n  kiVBORw0K\n  k//+l2Z/dA=='
                }
              }
            }
          ]
        }
      ]
    });
  });

  it('keeps keyframes-header block comments as typed prelude facts on the public route', () => {
    const document = parse(
      '@-webkit-keyframes /* Safari */ hover /* and Chrome */ { 0% { color: red; } }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@-webkit-keyframes',
          prelude: { type: 'Keyword', src: 'hover' },
          rules: [
            { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }
          ]
        }
      ]
    });
  });

  it('accepts empty statements in an ordinary ruleset without inventing AST nodes', () => {
    expect(parse('.card { ; color: red; ; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' }
            }
          ]
        }
      ]
    });
  });

  it('requires a declaration-list separator before following nested Less body items', () => {
    for (const source of [
      '.card { color: red .child { color: blue; } }',
      '.card { color: red @media (min-width: 1px) { color: blue; } }'
    ]) {
      const cst = parseLessCst(source);

      expect(
        cst.errors.length + Number(cst.unconsumedFrom !== null),
        source
      ).toBeGreaterThan(0);
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('keeps CSS unicode-range tokens opaque and outside Less arithmetic on the public AST route', () => {
    const source =
      '@font-face { unicode-range: U+??????, U+0???, U+0-7F, U+A5; } .range { values: U+0-7F 1, U+A5; }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@font-face',
          rules: [
            {
              type: 'Declaration',
              name: 'unicode-range',
              value: {
                type: 'List',
                sep: ',',
                value: [
                  { type: 'Any', src: 'U+??????' },
                  { type: 'Any', src: 'U+0???' },
                  { type: 'Any', src: 'U+0-7F' },
                  { type: 'Any', src: 'U+A5' }
                ]
              }
            }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'values',
              value: {
                type: 'List',
                sep: ',',
                value: [
                  [
                    { type: 'Any', src: 'U+0-7F' },
                    { type: 'Dimension', src: '1' }
                  ],
                  { type: 'Any', src: 'U+A5' }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '@font-face {\n  unicode-range: U+??????, U+0???, U+0-7F, U+A5;\n}\n.range {\n  values: U+0-7F 1, U+A5;\n}\n'
    );

    expect(() => parse('.range { value: U+0-7F + 1; }')).toThrow(SyntaxError);
  });

  it('retains escaped ordinary declaration names and the Less star hack without widening other identifier positions', () => {
    const source = '.card { \\63 olor: red; *zoom: 1; }';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: '\\63 olor',
              value: { type: 'Keyword', src: 'red' }
            },
            {
              type: 'Declaration',
              name: '*zoom',
              value: { type: 'Dimension', src: '1' }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  \\63 olor: red;\n  *zoom: 1;\n}\n');

    for (const invalid of [
      'color: r\\65 d;',
      '@\\63 olor: red;',
      '\\\ncolor: red;',
      '*\\\ncolor: red;'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns a structural interpolated quoted import target directly', () => {
    const document = parse(
      '@import (less, multiple) "theme-@{name}.css";'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'StyleImport',
          target: {
            type: 'Interpolation',
            parts: [
              { lit: '"theme-' },
              {
                ref: { type: 'Lookup', kind: 'var', name: 'name', raw: '@name' },
                unquote: true
              },
              { lit: '.css"' }
            ]
          }
        }
      ]
    });
    expect(() => parse('@import "theme-@{name}.css;')).toThrow(SyntaxError);

    /*
     * The same target with a media postlude is a compile-time import carrying
     * a media query, which is rejected outright.
     */
    expect(() => parse('@import (less, multiple) "theme-@{name}.css" screen;'))
      .toThrow(LessImportPostludeError);
  });

  it('returns and renders one complete interpolated import tail directly', () => {
    const document = parse('@media: print; @import "theme.css" @{media};');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'media' },
        {
          type: 'AtRuleStatement',
          name: '@import',
          prelude: {
            type: 'Sequence',
            parts: [
              { type: 'Quoted', value: 'theme.css' },
              {
                type: 'Interpolation',
                parts: [
                  {
                    ref: {
                      type: 'Lookup', kind: 'var',
                      name: 'media',
                      raw: '@media',
                      scope: 'scoped'
                    },
                    unquote: true
                  }
                ]
              }
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('@import "theme.css" print;\n');

    // The identical tail on a compile-time import is a parse error.
    expect(() => parse('@import "theme.less" @{media};'))
      .toThrow(LessImportPostludeError);

    for (const invalid of [
      '@import "theme.css" @{media} screen;',
      '@import "theme.css" screen @{media};',
      '@import "theme.css" @{media}@{print};'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns and evaluates a variable-bearing import query tail directly', () => {
    const document = parse(
      '@var: 100px; @import url("//ha.com/file.css") (min-width:@var);'
    );

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'var' },
        {
          type: 'AtRuleStatement',
          name: '@import',
          prelude: {
            type: 'Sequence',
            parts: [
              {
                type: 'Url',
                value: { type: 'Quoted', value: '//ha.com/file.css' }
              },
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Operation', operator: ':' }
              }
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('@import url("//ha.com/file.css") (min-width: 100px);\n');
  });

  it('renders public typed interpolation in dynamic URL, import, and block-header positions', () => {
    const source =
      '@asset: icons; @theme: theme; @query: screen; @condition: "(display: grid)"; @animation: fade; .asset { image: url(@asset/path.svg); template: url(@{theme}/icon.svg); } @import url(@{theme}.css); @media @{query} { .media { color: red; } } @supports @{condition} { .supports { display: grid; } } @keyframes @{animation} { from { opacity: 0; } }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'asset' },
        { type: 'VariableDeclaration', name: 'theme' },
        { type: 'VariableDeclaration', name: 'query' },
        { type: 'VariableDeclaration', name: 'condition' },
        { type: 'VariableDeclaration', name: 'animation' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'image',
              value: { type: 'Url', value: { type: 'Interpolation' } }
            },
            {
              type: 'Declaration',
              name: 'template',
              value: { type: 'Url', value: { type: 'Interpolation' } }
            }
          ]
        },
        {
          type: 'AtRuleStatement',
          name: '@import',
          prelude: { type: 'Url', value: { type: 'Interpolation' } }
        },
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: { type: 'Interpolation' }
        },
        {
          type: 'AtRuleBlock',
          name: '@supports',
          prelude: { type: 'Interpolation' }
        },
        {
          type: 'AtRuleBlock',
          name: '@keyframes',
          prelude: { type: 'Interpolation' }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.asset {\n  image: url(icons/path.svg);\n  template: url(theme/icon.svg);\n}\n@import url(theme.css);\n@media screen {\n  .media {\n    color: red;\n  }\n}\n@supports (display: grid) {\n  .supports {\n    display: grid;\n  }\n}\n@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n'
    );

    for (const invalid of [
      '@media @{query} screen { .media { color: red; } }',
      '@container @{query} { .media { color: red; } }',
      '@custom @{query} { .media { color: red; } }',
      '@custom foo@{query} { .media { color: red; } }',
      '@custom foo @{query} { .media { color: red; } }',
      '@custom foo@{query};',
      '@custom foo @{query};'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('keeps invalid interpolation-shaped quoted import text literal', () => {
    for (const source of [
      '@import "theme-@{bad.path}.css";',
      '@import "theme-@{ x }.css";',
      '@import "theme-@{}.css";'
    ]) {
      expect(parse(source)).toMatchObject({
        rules: [{ type: 'AtRuleStatement', name: '@import', prelude: { type: 'Quoted' } }]
      });
    }
  });

  it('returns a structural custom-property interpolation and a final declaration without a semicolon', () => {
    const document = parse(
      '@name: accent; .card { --theme: pre-@{name}; color: red }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'name' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: '--theme',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: 'pre-' },
                  {
                    ref: { type: 'Lookup', kind: 'var', name: 'name', raw: '@name' },
                    unquote: true
                  }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' }
            }
          ]
        }
      ]
    });
  });

  it('renders a detached-ruleset binding and call from the public AST route', () => {
    const document = parse(
      '@theme: { ; @accent: blue; color: @accent; ; };\n.card { @theme(); }'
    );

    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  color: blue;\n}\n');
  });

  it('returns and renders full detached-ruleset and each callback bodies from the public AST route', () => {
    const document = parse(
      '@theme: { .nested { color: red; } @media screen { .media { color: blue; } } .tone() { color: green; } each(1 2, { .item { order: @value; } }); }; .card { @theme(); } each(3 4, .(@entry) { .entry { order: @entry; } });'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          value: {
            type: 'AnonymousMixin',
            rules: [
              { type: 'Ruleset' },
              { type: 'AtRuleBlock' },
              { type: 'MixinDefinition' },
              { type: 'For' }
            ]
          }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Reference',
              base: { type: 'Lookup', kind: 'var' },
              steps: [{ type: 'Call', args: [] }]
            }
          ]
        },
        { type: 'For', rules: [{ type: 'Ruleset' }] }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card .nested {\n  color: red;\n}\n@media screen {\n  .card .media {\n    color: blue;\n  }\n}\n.card .item {\n  order: 1;\n  order: 2;\n}\n.entry {\n  order: 3;\n}\n.entry {\n  order: 4;\n}\n'
    );
  });

  it('iterates a flat static mixin call through the existing public For evaluator path', () => {
    const source =
      '.values() { first: red; second: blue; } each(.values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.values' },
        {
          type: 'For',
          iterable: { type: 'MixinCall', name: '.values', args: [], path: [] },
          binding: { kind: 'comma', names: ['value', 'key', undefined] }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.item {\n  value: red;\n  key: first;\n}\n.item {\n  value: blue;\n  key: second;\n}\n'
    );
    for (const source of ['each(.@{name}(), { .item { value: @value; } });']) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('iterates a static namespaced mixin call through the existing MixinCall path evaluator', () => {
    const source =
      '.library { .values() { first: red; second: blue; } } each(.library > .values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Ruleset', rules: [{ type: 'MixinDefinition', name: '.values' }] },
        {
          type: 'For',
          iterable: {
            type: 'MixinCall',
            name: '.values',
            args: [],
            path: [{ combinator: ' ', selector: '.library' }]
          },
          binding: { kind: 'comma', names: ['value', 'key', undefined] }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.item {\n  value: red;\n  key: first;\n}\n.item {\n  value: blue;\n  key: second;\n}\n'
    );
    for (const invalid of [
      'each(.library > .@{name}(), { .item { value: @value; } });',
      'each(.library > .values() !important, { .item { value: @value; } });',
      'each(.library > .values();, { .item { value: @value; } });'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('binds a flat static mixin call as an existing callable declaration map', () => {
    const source =
      '.make-map() { tone: blue; } @map: .make-map(); .lookup { color: @map[tone]; } .call { @map(); }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.make-map' },
        {
          type: 'VariableDeclaration',
          name: 'map',
          value: {
            type: 'MixinCall',
            name: '.make-map',
            args: [],
            path: [],
            important: false
          }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'Reference',
                base: { type: 'Lookup', kind: 'var', name: 'map', raw: '@map' },
                steps: [{ type: 'LookupStep', kind: 'prop' }]
              }
            }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Reference',
              base: {
                type: 'Lookup', kind: 'var',
                name: 'map',
                raw: '@map',
                scope: 'scoped'
              },
              steps: [{ type: 'Call', args: [] }]
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.lookup {\n  color: blue;\n}\n.call {\n  tone: blue;\n}\n');

    /*
     * A namespaced mixin call is a valid Less value: it carries the same
     * callable declaration map as the flat form, with its namespace path.
     */
    const namespaced = parse(
      '.library { .make-map() { tone: blue; } } @map: .library > .make-map(); .lookup { color: @map[tone]; } .call { @map(); }'
    );
    expect(namespaced.rules[0]).toMatchObject({
      type: 'Ruleset',
      rules: [{ type: 'MixinDefinition', name: '.make-map' }]
    });
    expect(namespaced.rules[1]).toMatchObject({
      type: 'VariableDeclaration',
      name: 'map',
      value: {
        type: 'MixinCall',
        name: '.make-map',
        args: [],
        path: [{ combinator: ' ', selector: '.library' }],
        important: false
      }
    });
    expect(
      serialize(namespaced, { evaluator: buildEvaluator(makeLessRegistry()) })
        .css
    ).toBe('.lookup {\n  color: blue;\n}\n.call {\n  tone: blue;\n}\n');
    expect(() => parse('@map: .make-map() !important;')).toThrow(SyntaxError);
  });

  it('lowers empty Less namespace access to the existing final bracket index', () => {
    const document = parse(
      '.library { .answer() { value: blue; } } .out { value: .library.answer[]; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Ruleset' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'value',
              value: {
                type: 'Reference',
                base: {
                  type: 'MixinCall',
                  name: '.answer',
                  path: [{ combinator: ' ', selector: '.library' }],
                  args: []
                },
                steps: [{ type: 'LookupStep', kind: 'index', name: -1 }],
                raw: '.library .answer[-1]'
              }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.out {\n  value: blue;\n}\n');
  });

  it('retains and renders typed static keyframes from detached-ruleset and each callback bodies', () => {
    const source =
      '@theme: { @keyframes fade { from { opacity: 0; } } }; .host { @theme(); } each(1, { @-webkit-keyframes "slide" { 50% { opacity: @value; } } });';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          value: {
            type: 'AnonymousMixin',
            rules: [
              {
                type: 'AtRuleBlock',
                name: '@keyframes',
                rules: [{ type: 'Ruleset' }]
              }
            ]
          }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Reference',
              base: { type: 'Lookup', kind: 'var' },
              steps: [{ type: 'Call', args: [] }]
            }
          ]
        },
        {
          type: 'For',
          rules: [
            {
              type: 'AtRuleBlock',
              name: '@-webkit-keyframes',
              prelude: { type: 'Quoted', value: 'slide' },
              rules: [{ type: 'Ruleset' }]
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n@-webkit-keyframes "slide" {\n  50% {\n    opacity: 1;\n  }\n}\n'
    );
    expect(() =>
      parse('each(1, { @keyframes @name { from { opacity: 0; } } });')
    ).toThrow(SyntaxError);
  });

  it('retains a detached-ruleset call inside a parameterized keyframes body', () => {
    const document = parse(
      '.frames(@name) { @keyframes @{name} { @rules(); } @rules: { from { opacity: 1; } }; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          rules: [
            {
              type: 'AtRuleBlock',
              name: '@keyframes',
              prelude: { type: 'Interpolation' },
              rules: [{ type: 'Reference' }]
            },
            { type: 'VariableDeclaration', name: 'rules' }
          ]
        }
      ]
    });
  });

  it('unquotes a static escaped keyframe name through public parse', () => {
    const document = parse('@keyframes ~"spin" { from { opacity: 0; } }');
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@keyframes',
          prelude: {
            type: 'Quoted',
            src: '~"spin"',
            value: 'spin',
            escaped: true
          }
        }
      ]
    });
    expect(serialize(document).css).toBe(
      '@keyframes spin {\n  from {\n    opacity: 0;\n  }\n}\n'
    );
  });

  it('discards empty statements while retaining simple and named each callback bodies on the public route', () => {
    const document = parse(
      'each(1, { ; .simple { order: @value; } ; }); each(2, .(@entry) { ; .named { order: @entry; } ; });'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: [{ type: 'Ruleset' }]
        },
        {
          type: 'For',
          binding: { kind: 'single', name: 'entry' },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.simple {\n  order: 1;\n}\n.named {\n  order: 2;\n}\n');
  });

  it('returns and evaluates a typed indirect variable from the public Stylesheet route', () => {
    const document = parse('@name: tone; @tone: red; .card { color: @@name; }');

    expect(bare(document)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'name',
          value: { type: 'Keyword', src: 'tone' },
          write: { mode: 'declare' }
        },
        {
          type: 'VariableDeclaration',
          name: 'tone',
          value: { type: 'Keyword', src: 'red' },
          write: { mode: 'declare' }
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              simpleSelector('.card')
            ]
          },
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              merge: null,
              important: false,

              /*
               * `@@name` is one `Lookup` whose NAME is another `Lookup` — the
               * shape that retires the separate `VarIndirect` kind, which
               * existed only because a name could not be a node.
               */
              value: {
                type: 'Lookup', kind: 'var',
                name: {
                  type: 'Lookup', kind: 'var',
                  name: 'name',
                  raw: '@name',
                  scope: 'scoped'
                },
                raw: '@@name',
                scope: 'scoped'
              }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  color: red;\n}\n');
  });

  it('returns and renders interpolated selector tokens through the public Stylesheet route', () => {
    const document = parse(
      '@name: card; @state: active; .@{name}-item, #tone-@{state} { color: red; &.@{state} { color: blue; } }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'state' },
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              simpleSelector(null, { interp: { type: 'Interpolation' } }),
              simpleSelector(null, { interp: { type: 'Interpolation' } })
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card-item,\n#tone-active {\n  color: red;\n}\n:is(.card-item, #tone-active).active {\n  color: blue;\n}\n'
    );
    for (const invalid of [
      '. @{name}-item { color: red; }',
      '.@{name}:extend(.target) { color: red; }'
    ]) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }
  });

  it('returns and renders adjacent captured and quoted selector interpolation through the public route', () => {
    const source =
      '@cap-a: *[.a, .b]; @cap-b: *[.c, .d]; @quoted-a: ~".a, .b"; @quoted-b: ~".c, .d"; @{cap-a}@{cap-b}, @{quoted-a}@{quoted-b} { color: red; }';
    const document = parse(source);

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {},
        {},
        {},
        {},
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              simpleSelector(null, {
                interp: {
                  type: 'Interpolation',
                  parts: [
                    {
                      ref: { type: 'Lookup', kind: 'var', name: 'cap-a', raw: '@cap-a' },
                      unquote: true
                    },
                    {
                      ref: { type: 'Lookup', kind: 'var', name: 'cap-b', raw: '@cap-b' },
                      unquote: true
                    }
                  ]
                }
              }),
              simpleSelector(null, {
                interp: {
                  type: 'Interpolation',
                  parts: [
                    {
                      ref: {
                        type: 'Lookup', kind: 'var',
                        name: 'quoted-a'
                      },
                      unquote: true
                    },
                    {
                      ref: {
                        type: 'Lookup', kind: 'var',
                        name: 'quoted-b'
                      },
                      unquote: true
                    }
                  ]
                }
              })
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      ':is(.a, .b):is(.c, .d),\n:is(.a, .b):is(.c, .d) {\n  color: red;\n}\n'
    );
  });

  it('returns and renders glued parent-suffix selector interpolation through nesting', () => {
    const document = parse(
      '@suffix: active; @left: x; @right: y; .button { &-@{suffix}, &@{left}-@{right} { color: red; } }'
    );

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' },
        { type: 'VariableDeclaration' },
        { type: 'VariableDeclaration' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Ruleset',
              selector: {
                selectors: [
                  simpleSelector(null, { interp: { type: 'Interpolation' } }),
                  simpleSelector(null, { interp: { type: 'Interpolation' } })
                ]
              }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.button-active,\n.buttonx-y {\n  color: red;\n}\n');
    expect(() => parse('.button { &(1) { color: red; } }')).toThrow(
      SyntaxError
    );
  });

  it('returns and evaluates an ordinary typed property reference without treating it as an accessor', () => {
    const source = '.card { color: red; border-color: $color; }';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Keyword', src: 'red' }
            },
            {
              type: 'Declaration',
              name: 'border-color',
              value: {
                type: 'Lookup', kind: 'prop',
                name: 'color',
                raw: '$color'
              }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  color: red;\n  border-color: red;\n}\n');
  });

  it('keeps an ordinary property reference glued and does not widen it into map access', () => {
    for (const source of [
      '.card { border-color: $ color; }',
      '.card { border-color: $color[shade]; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('constructs a variable-keyed map accessor with a hyphenated Less variable name', () => {
    const document = parse(
      '@varToGet: default-color; .foo { color: @defaults[@default-color]; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'varToGet',
          value: { type: 'Keyword', src: 'default-color' }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'Reference',
                base: {
                  type: 'Lookup', kind: 'var',
                  name: 'defaults',
                  raw: '@defaults',
                  scope: 'scoped'
                },
                steps: [
                  {
                    type: 'LookupStep', name: {
                      type: 'Lookup', kind: 'var',
                      name: 'default-color',
                      raw: '@default-color',
                      scope: 'scoped' },
                    kind: 'var'
                  }
                ],
                raw: '@defaults[@default-color]'
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs an indirect-variable map key without reparsing its source spelling', () => {
    const document = parse(
      '@key: default-color; .foo { color: @defaults[@@key]; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'key' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'Reference',
                raw: '@defaults[@@key]',
                steps: [
                  {
                    type: 'LookupStep', kind: 'var',
                    name: {
                      type: 'Lookup', kind: 'var',
                      name: {
                        type: 'Lookup', kind: 'var',
                        name: 'key',
                        raw: '@key',
                        scope: 'scoped' }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('returns and evaluates typed Less arithmetic from the public Stylesheet route', () => {
    const document = parse(
      '@a: 2; .math { sum: 1 + 2 * 3; grouped: (1 + 2) * 3; neg: -(@a + 1); signed: -2px + 3px; unarySpace: - @a; ratio: 12px / 1.5; calc: calc(100% - (20px / 2)); }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'a' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'sum',
              value: { type: 'Operation', operator: '+' }
            },
            {
              type: 'Declaration',
              name: 'grouped',
              value: { type: 'Operation', operator: '*' }
            },
            {
              type: 'Declaration',
              name: 'neg',
              value: { type: 'Operation', operator: '*' }
            },
            {
              type: 'Declaration',
              name: 'signed',
              value: { type: 'Operation', operator: '+' }
            },
            {
              type: 'Declaration',
              name: 'unarySpace',
              value: [
                { type: 'Keyword', src: '-' },
                { type: 'Lookup', kind: 'var', name: 'a', raw: '@a', scope: 'scoped' }
              ]
            },
            {
              type: 'Declaration',
              name: 'ratio',
              value: [
                { type: 'Dimension', src: '12px' },
                { type: 'Keyword', src: '/' },
                { type: 'Dimension', src: '1.5' }
              ]
            },
            {
              type: 'Declaration',
              name: 'calc',
              value: { type: 'FunctionCall', name: 'calc' }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.math {\n  sum: 7;\n  grouped: 9;\n  neg: -3;\n  signed: 1px;\n  unarySpace: - 2;\n  ratio: 12px / 1.5;\n  calc: calc(100% - 10px);\n}\n'
    );
  });

  it('evaluates comment-aware Less product operators on the public Stylesheet route', () => {
    const document = parse(
      '.math { product: 2 * // factor\n 3; modulo: 7 // divisor\n % 3; }'
    );
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'product',
              value: { type: 'Operation', operator: '*' }
            },
            {
              type: 'Declaration',
              name: 'modulo',
              value: { type: 'Operation', operator: '%' }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.math {\n  product: 6;\n  modulo: 1;\n}\n');
    expect(() =>
      parse('.math { product: 2 * // missing operand\n; }')
    ).toThrow();
  });

  it('returns and evaluates deprecated Less percent-format calls through the public route', () => {
    const document = parse('.card { text: %("hello %s", "world"); }');
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: { type: 'FunctionCall', name: '%' }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  text: "hello world";\n}\n');

    const escaped = parse('.card { text: %(~"hello %s", "world"); }');
    expect(
      serialize(escaped, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card {\n  text: hello world;\n}\n');
  });

  it('returns static attribute selectors from the public Stylesheet route', () => {
    const document = parse(
      '.card[data-state][role=button][title="Save" i] { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                simpleSelector('[data-state]'),
                simpleSelector('[role=button]'),
                simpleSelector('[title="Save" i]')
              )
            ]
          }
        }
      ]
    });
  });

  it('returns static namespace attribute selectors from the public Stylesheet route', () => {
    const document = parse(
      '.card[svg|role=button][*|data-state][|title="Save" i] { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                simpleSelector('[svg|role=button]'),
                simpleSelector('[*|data-state]'),
                simpleSelector('[|title="Save" i]')
              )
            ]
          }
        }
      ]
    });
  });

  it('returns and evaluates interpolated attribute selectors through the public route', () => {
    const document = parse(
      '@field: state; @value: active; @name: role; @quoted: button; .card[data-@{field}=@{value}][svg|@{name}="@{quoted}"] { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'field' },
        { type: 'VariableDeclaration', name: 'value' },
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'quoted' },
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                simpleSelector(null, {
                  interp: {
                    type: 'Interpolation',
                    parts: [
                      { lit: '[data-' },
                      { ref: { type: 'Lookup', kind: 'var', name: 'field', raw: '@field' } },
                      { lit: '=' },
                      { ref: { type: 'Lookup', kind: 'var', name: 'value', raw: '@value' } },
                      { lit: ']' }
                    ]
                  }
                }),
                simpleSelector(null, {
                  interp: {
                    type: 'Interpolation',
                    parts: [
                      { lit: '[svg|' },
                      { ref: { type: 'Lookup', kind: 'var', name: 'name', raw: '@name' } },
                      { lit: '="' },
                      {
                        ref: { type: 'Lookup', kind: 'var', name: 'quoted', raw: '@quoted' }
                      },
                      { lit: '"]' }
                    ]
                  }
                })
              )
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card[data-state=active][svg|role="button"] {\n  color: red;\n}\n');

    for (const invalid of ['.card[@{ spaced }=button] { color: red; }']) {
      expect(() => parse(invalid), invalid).toThrow(SyntaxError);
    }

    // `${…}` property interpolation is admitted in attribute selectors just like `@{…}`.
    expect(() => parse('.card[${name}=button] { color: red; }')).not.toThrow();
  });

  it('returns static namespace type selectors as one SimpleSelector from the public Stylesheet route', () => {
    const document = parse('svg|a, *|a, |a, svg|* { color: red; }');

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              simpleComplex('svg|a'),
              simpleComplex('*|a'),
              simpleComplex('|a'),
              simpleComplex('svg|*')
            ]
          }
        }
      ]
    });
  });

  it('returns and renders static selector-valued functional pseudos from the public route', () => {
    const document = parse(
      '.card:not(.disabled):has(.child > .grandchild) { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                {
                  type: 'PseudoSelector',
                  name: ':not',
                  text: null,
                  crossable: false
                },
                {
                  type: 'PseudoSelector',
                  name: ':has',
                  text: null,
                  crossable: false
                }
              )
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card:not(.disabled):has(.child > .grandchild) {\n  color: red;\n}\n'
    );
  });

  it('returns and renders static non-selector functional pseudos from the public route', () => {
    const document = parse(
      '.card:lang(en-US)::part(icon):state(foo[bar]) { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                simpleSelector(':lang(en-US)'),
                simpleSelector('::part(icon)'),
                simpleSelector(':state(foo[bar])')
              )
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card:lang(en-US)::part(icon):state(foo[bar]) {\n  color: red;\n}\n'
    );
    for (const source of [
      /*
       * Less splices these as opaque text blobs; jess keeps pseudo arguments
       * structural and rejects them instead. Intentional divergence.
       */
      '.card:lang(@locale) { color: red; }',
      '.card:lang(@@locale) { color: red; }',
      '.card:nth-of-type(2n of .item) { color: red; }',
      '.card:nth-child { color: red; }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }

    /*
     * The nth-name boundary must span the FULL ident-continue set of
     * css-syntax-3 §4.3.11, which admits every code point >= U+0080. A boundary
     * narrower than that succeeds on `:nth-childé`, which reclassifies a plain
     * identifier as an nth name, excludes it from the keyword-pseudo arm and
     * then rejects it for lacking an immediate `(` — turning valid CSS into a
     * parse error. These are ordinary pseudos that merely share an nth prefix.
     */
    for (const source of [
      '.card:nth-childé(2n) { color: red; }',
      '.card:nth-child中(2n) { color: red; }',
      '.card:nth-of-typeé(2n) { color: red; }',
      '.card:nth-last-childé(2n) { color: red; }',
      '.card:nth-childé { color: red; }'
    ]) {
      expect(() => parse(source), source).not.toThrow();
    }

    /*
     * An `@{…}` argument is structural in Less too, so it round-trips as one
     * interpolation-backed selector token rather than being rejected.
     */
    expect(parse('.card:lang(@{locale}) { color: red; }')).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                simpleSelector(null, {
                  interp: {
                    parts: [
                      { lit: ':lang(' },
                      { ref: { name: 'locale' } },
                      { lit: ')' }
                    ]
                  }
                })
              )
            ]
          }
        }
      ]
    });
  });

  it('returns and renders bounded typed static @supports conditions from the public route', () => {
    const document = parse(
      '@supports ((display: grid) or (color: red)) and (hover) { .card { color: red; } }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@supports',
          prelude: {
            type: 'Sequence',
            parts: [
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Sequence' }
              },
              { type: 'Keyword', src: 'and' },
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Keyword', src: 'hover' }
              }
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '@supports ((display: grid) or (color: red)) and (hover) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('returns and renders structural media/container query preludes from the public route', () => {
    const document = parse(
      '@limit: 40rem; @media only screen and (min-width: @limit), print { .card { color: red; } } @container sidebar (400px < width < @limit) { .card { color: blue; } }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'limit' },
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'List',
            sep: ',',
            value: [
              {
                type: 'Sequence',
                parts: [
                  { type: 'Keyword', src: 'only' },
                  { type: 'Keyword', src: 'screen' },
                  { type: 'Keyword', src: 'and' },
                  {
                    type: 'Block',
                    delimiter: 'paren',
                    value: { type: 'Operation', operator: ':' }
                  }
                ]
              },
              { type: 'Keyword', src: 'print' }
            ]
          }
        },
        {
          type: 'AtRuleBlock',
          name: '@container',
          prelude: {
            type: 'Sequence',
            parts: [
              { type: 'Keyword', src: 'sidebar' },
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Operation', operator: '<' }
              }
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '@media only screen and (min-width: 40rem), print {\n  .card {\n    color: red;\n  }\n}\n@container sidebar (400px < width < 40rem) {\n  .card {\n    color: blue;\n  }\n}\n'
    );
    for (const source of [
      '@container selector(.card) { .card { color: red; } }',
      '@media screen (width > 10px) { .card { color: red; } }'
    ]) {
      expect(() => parse(source), source).toThrow(SyntaxError);
    }
  });

  it('accepts unknown CSS block at-rules as opaque blocks on the public Less route', () => {
    const source = '@future {!!:foo > ; > ?bar}';
    const cst = parseLessCst(source);
    const document = parse(source);

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'OpaqueAtRuleBlock',
          name: '@future',
          prelude: null,
          rawBody: '!!:foo > ; > ?bar'
        }
      ]
    });
    expect(serialize(document).css).toBe('@future {!!:foo > ; > ?bar}\n');
  });

  it('rejects removed bare at-variable prelude interpolation with a targeted parser error', () => {
    for (const source of [
      '@media @q { .card { color: red; } }',
      '@supports (@cond) { .card { color: red; } }',
      '@container @name (inline-size > 30em) { .card { color: red; } }',
      '@layer @name;',
      '@keyframes @name { from { opacity: 0; } }'
    ]) {
      expect(() => parse(source), source).toThrow(
        LessBareVariableInterpolationError
      );
    }

    expect(
      parse('@media (min-width: @w) { .card { color: red; } }')
    ).toMatchObject({
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'Block',
            value: {
              type: 'Operation',
              right: { type: 'Lookup', kind: 'var', name: 'w', raw: '@w' }
            }
          }
        }
      ]
    });
  });

  it('rejects unsupported legacy Less variable names with targeted parser errors', () => {
    for (const source of [
      '@1: red;',
      '@-: red;',
      '.entry { color: @-; }',
      'each(1, .(@-) { color: red; });'
    ]) {
      expect(() => parse(source), source).toThrow(
        LessUnsupportedVariableNameError
      );
    }
  });

  it('keeps interpolated Less media-query terms structural in a multi-term header', () => {
    const document = parse(
      '@all: ~"all"; @tv: ~"(tv)"; @media @{all} and @{tv} { .card { color: red; } }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'all' },
        { type: 'VariableDeclaration', name: 'tv' },
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'Sequence',
            parts: [
              { type: 'Interpolation' },
              { type: 'Keyword', src: 'and' },
              { type: 'Interpolation' }
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('@media all and (tv) {\n  .card {\n    color: red;\n  }\n}\n');
  });

  it('preserves a structural query prelude when a media block is emitted from nested mode', () => {
    const document = parse(
      '@limit: 40rem; .card { @media (min-width: @limit) { color: red; } }'
    );

    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('@media (min-width: 40rem) {\n  .card {\n    color: red;\n  }\n}\n');
  });

  it('accepts selector comments in static functional pseudo arguments on the public route', () => {
    const document = parse(
      '.card:not(/* before */ .disabled, /* between */ .muted, .a /* left */ > /* right */ .b):nth-child(/* numeric */ 2n + 1) { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                {
                  type: 'PseudoSelector',
                  name: ':not',
                  text: null,
                  crossable: false
                },
                simpleSelector(':nth-child(2n + 1)')
              )
            ]
          }
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card:not(.disabled, .muted, .a > .b):nth-child(2n + 1) {\n  color: red;\n}\n'
    );
  });

  it('does not turn a comment-only simple-selector boundary into a descendant combinator', () => {
    const document = parse(
      '.card:not(.x/* glued */.y, .a /* descendant */ .b) { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              compoundComplex(
                simpleSelector('.card'),
                {
                  type: 'PseudoSelector',
                  name: ':not',
                  text: null,
                  crossable: false
                }
              )
            ]
          }
        }
      ]
    });

    /*
     * A glued/comment boundary stays one compound inside the structured arg; the
     * canonical join renders `:not(.x.y, .a .b)` (spaced) via core serialization.
     */
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.card:not(.x.y, .a .b) {\n  color: red;\n}\n');
  });

  it('retains outer selector comments on the public route', () => {
    const document = parse(
      '#planadvisor, /* first *//* second */\n.first, /* third */.planning { color: red; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              simpleComplex('#planadvisor'),
              simpleComplex('.first'),
              simpleComplex('.planning')
            ]
          }
        }
      ]
    });
    expect(serialize(document).css).toBe(
      '#planadvisor,\n/* first *//* second */\n.first,\n/* third */.planning {\n  color: red;\n}\n'
    );
  });

  it('attaches inline extend only to its later comma sibling and lowers !all as partial', () => {
    const document = parse(
      '.rules { &:extend(.target !all); } .first, .inline:extend(.target all), .sibling { color: red; }'
    );
    const body = document.rules[0];
    const inline = document.rules[1];
    if (body?.type !== 'Ruleset' || inline?.type !== 'Ruleset') {
      throw new Error('expected two rules with extend instructions');
    }

    expect(body.extendInstructions).toMatchObject([{ partial: true }]);
    expect(inline.extendInstructions).toMatchObject([
      {
        partial: true,
        subject: { selectors: [simpleComplex('.inline')] }
      }
    ]);
    expect(inline.selector.selectors).toHaveLength(3);
  });

  it('plans a later inline extend for only its attached selector', () => {
    const document = parse(
      '.target { color: navy; } .first, .inline:extend(.target), .sibling {}'
    );
    const css = serialize(document, {
      evaluator: buildEvaluator(makeLessRegistry())
    }).css;

    expect(css).toContain('.target,\n.inline {');
    expect(css).not.toContain('.first {');
    expect(css).not.toContain('.sibling {');
  });

  it('retains an interpolated extend target as a typed selector fact', () => {
    const document = parse(
      '@name: target; .target { color: red; } .replacement:extend(.@{name}) { color: blue; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'Ruleset' },
        {
          type: 'Ruleset',
          extendInstructions: [
            {
              partial: false,
              target: {
                type: 'SelectorList',
                selectors: [
                  simpleSelector(null, {
                    interp: {
                      type: 'Interpolation',
                      parts: [
                        { lit: '.' },
                        {
                          ref: {
                            type: 'Lookup', kind: 'var',
                            name: 'name',
                            raw: '@name',
                            scope: 'scoped'
                          },
                          unquote: true
                        }
                      ]
                    }
                  })
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('rejects a mixin call that mixes comma and semicolon separators', () => {
    const source =
      '.mixin(@a: 4, @b: 3, @c: 2) {} .mixin-test { .mixin(@a: 5, @b: 6; @c: 7); }';
    expect(() => parse(source)).toThrow(SyntaxError);
  });

  it('evaluates canonical statement bodies inside an inline extend rule through public parse', () => {
    const source =
      '.paint() { color: red; } .target { width: 1px; } .inline:extend(.target) { .paint(); each(1, { order: @value; }); @media screen { display: block; } }';
    const document = parse(source);
    expect(document).toMatchObject({
      rules: [
        { type: 'MixinDefinition' },
        { type: 'Ruleset' },
        {
          type: 'Ruleset',
          rules: [
            { type: 'MixinCall' },
            { type: 'For' },
            { type: 'AtRuleBlock', name: '@media' }
          ]
        }
      ]
    });
    const css = serialize(document, {
      evaluator: buildEvaluator(makeLessRegistry())
    }).css;
    expect(css).toContain('.inline {');
    expect(css).toContain('color: red;');
    expect(css).toContain('order: 1;');
    expect(css).toContain('@media screen');
    expect(css).toContain('display: block;');
  });

  it('returns and evaluates parenthesis-free namespaced mixin calls through the public route', () => {
    const document = parse(
      '#theme { .mixin() { color: red; } } .card { #theme > .mixin; } .important { #theme > .mixin !important; }'
    );

    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Ruleset', rules: [{ type: 'MixinDefinition', name: '.mixin' }] },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.mixin',
              args: [],
              path: [{ combinator: ' ', selector: '#theme' }]
            }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.mixin',
              args: [],
              path: [{ combinator: ' ', selector: '#theme' }],
              important: true
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe(
      '.card {\n  color: red;\n}\n.important {\n  color: red !important;\n}\n'
    );
  });

  it('routes one parsed class/id prefix to its mixin or ruleset continuation', () => {
    const document = parse([
      '.simple() { color: red; }',
      '#library { .tone() { color: blue; } }',
      '.host { .simple(); #library > .tone(); #library .tone(); #library.tone(); }',
      '.compound.selector { color: black; }',
      '.descendant .selector { color: green; }',
      '.child > .selector { color: white; }'
    ].join('\n'));

    expect(document).toMatchObject({
      rules: [
        { type: 'MixinDefinition', name: '.simple' },
        { type: 'Ruleset', rules: [{ type: 'MixinDefinition', name: '.tone' }] },
        {
          type: 'Ruleset',
          rules: [
            { type: 'MixinCall', name: '.simple', path: [] },
            { type: 'MixinCall', name: '.tone', path: [{ selector: '#library' }] },
            { type: 'MixinCall', name: '.tone', path: [{ selector: '#library' }] },
            { type: 'MixinCall', name: '.tone', path: [{ selector: '#library' }] }
          ]
        },
        { type: 'Ruleset', selector: { selectors: [{ type: 'CompoundSelector' }] } },
        { type: 'Ruleset', selector: { selectors: [{ type: 'ComplexSelector' }] } },
        { type: 'Ruleset', selector: { selectors: [{ type: 'ComplexSelector' }] } }
      ]
    });
    expect(() => parse('.a.b() { color: red; }')).toThrow(SyntaxError);
  });

  it('lowers one parenthesized mixin interior by its definition or call continuation', () => {
    const document = parse([
      '@first: one; @second: two; @third: three;',
      '.join(@first, @second; @third,) { first: @first; second: @second; third: @third; }',
      '.host { .join(@first; @second, @third,); .join(@first - 1); }'
    ].join('\n'));

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'first' },
        { type: 'VariableDeclaration', name: 'second' },
        { type: 'VariableDeclaration', name: 'third' },
        {
          type: 'MixinDefinition',
          name: '.join',
          params: [{ name: 'first' }, { name: 'second' }, { name: 'third' }]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.join',
              args: [
                { value: { type: 'Lookup', kind: 'var', name: 'first', raw: '@first' } },
                {
                  value: {
                    type: 'List',
                    sep: ',',
                    value: [
                      { type: 'Lookup', kind: 'var', name: 'second', raw: '@second' },
                      { type: 'Lookup', kind: 'var', name: 'third', raw: '@third' }
                    ]
                  }
                }
              ]
            },
            {
              type: 'MixinCall',
              name: '.join',
              args: [{
                value: {
                  type: 'Operation',
                  operator: '-',
                  left: { type: 'Lookup', kind: 'var', name: 'first', raw: '@first' },
                  right: { type: 'Dimension', number: 1 }
                }
              }]
            }
          ]
        }
      ]
    });
  });

  it('returns static ruleset guards from the public Stylesheet route', () => {
    expect(
      parse(
        '.wide when (not (@width < 20px) and iscolor(red), default()) { color: red; }'
      )
    ).toMatchObject({
      rules: [
        {
          type: 'Ruleset',
          guard: {
            g: 'or',
            left: {
              g: 'and',
              left: { g: 'not' },
              right: { g: 'call', name: 'iscolor' }
            },
            right: { g: 'default' }
          }
        }
      ]
    });
    expect(() => parse('.x when (@{dynamic}) { color: red; }')).toThrow(
      SyntaxError
    );
  });

  it('returns bare function-call statements through the public Stylesheet route', () => {
    const document = parse('e("x"); .card { e("y"); }');
    expect(document).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'FunctionCall',
          name: 'e',
          args: [{ value: { type: 'Quoted', value: 'x' } }]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'FunctionCall',
              name: 'e',
              args: [{ value: { type: 'Quoted', value: 'y' } }]
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('x\n.card {\n  y\n}\n');
  });

  it('returns and renders static escaped quoted values through the public route', () => {
    const document = parse(
      '.x { double: ~"a/b"; single: ~\'c d\'; ordinary: "e\\\\ f"; }'
    );

    expect(document).toMatchObject({
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'double',
              value: { type: 'Quoted', escaped: true, value: 'a/b' }
            },
            {
              type: 'Declaration',
              name: 'single',
              value: { type: 'Quoted', escaped: true, value: 'c d' }
            },
            {
              type: 'Declaration',
              name: 'ordinary',
              value: { type: 'Quoted', escaped: false }
            }
          ]
        }
      ]
    });
    expect(
      serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css
    ).toBe('.x {\n  double: a/b;\n  single: c d;\n  ordinary: "e\\\\ f";\n}\n');
  });

  it('carries static escaped quotes through import facts, URLs, and guards', () => {
    const document = parse(
      '@choice: ~"yes"; @import (css) ~"foo.css"; .m(@value) when (@value = ~"yes") { guarded: ok; } .card { asset: url(~"a b.svg"); .m(@choice); }'
    );
    const css = serialize(document, {
      evaluator: buildEvaluator(makeLessRegistry())
    }).css;

    expect(document).toMatchObject({
      rules: [
        {
          type: 'VariableDeclaration',
          value: { type: 'Quoted', escaped: true, value: 'yes' }
        },
        {
          type: 'AtRuleStatement',
          name: '@import',
          prelude: { type: 'Quoted', escaped: true, value: 'foo.css' }
        },
        { type: 'MixinDefinition', guard: { g: 'match', op: '=' } },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'Url',
                value: { type: 'Quoted', escaped: true, value: 'a b.svg' }
              }
            },
            { type: 'MixinCall' }
          ]
        }
      ]
    });
    expect(css).toContain('asset: url(a b.svg);');
    expect(css).toContain('guarded: ok;');
  });

  it('keeps terminal and at-rule-body function calls on the public Less route', () => {
    const evaluator = buildEvaluator(makeLessRegistry());

    expect(serialize(parse('e("x")'), { evaluator }).css).toBe('x\n');
    expect(serialize(parse('.card { e("y") }'), { evaluator }).css).toBe(
      '.card {\n  y\n}\n'
    );
    expect(
      serialize(parse('@media screen { e("z"); }'), { evaluator }).css
    ).toBe('@media screen {\n  z\n}\n');
    expect(
      serialize(parse('@keyframes a { from { e("k"); } }'), { evaluator }).css
    ).toBe('@keyframes a {\n  from {\n    k\n  }\n}\n');
    expect(
      serialize(parse('.a:extend(.b) { e("i"); }'), { evaluator }).css
    ).toBe('.a {\n  i\n}\n');
    expect(() => parse('e("x") e("y")')).toThrow(SyntaxError);
  });

  it('keeps condition syntax scoped to the current function argument', () => {
    /*
     * A quoted argument is a completed value piece, so comparison and logical
     * bytes inside it cannot route its containing argument through the Less
     * condition production.
     */
    const evaluator = buildEvaluator(makeLessRegistry());

    // `or` inside a plain string → a Quoted argument, not a condition
    expect(parse('.x { p: error("a or b"); }')).toMatchObject({
      rules: [
        {
          rules: [
            {
              value: {
                type: 'FunctionCall',
                name: 'error',
                args: [{ value: { type: 'Quoted' } }]
              }
            }
          ]
        }
      ]
    });

    // the exact bootstrap shape: interpolation + `or` inside the string
    expect(parse('.x { p: error("@{u} or x"); }')).toMatchObject({
      rules: [
        {
          rules: [
            {
              value: {
                type: 'FunctionCall',
                name: 'error',
                args: [{ value: { type: 'Interpolation' } }]
              }
            }
          ]
        }
      ]
    });

    // comparison chars inside a string are also opaque
    expect(parse('.x { p: fn("1 < 2"); }')).toMatchObject({
      rules: [
        {
          rules: [
            {
              value: {
                type: 'FunctionCall',
                name: 'fn',
                args: [{ value: { type: 'Quoted' } }]
              }
            }
          ]
        }
      ]
    });

    // sanity: a REAL condition (operator OUTSIDE any string) still parses as one
    expect(
      serialize(parse('.x { p: if((1 < 2), a, b); }'), { evaluator }).css
    ).toContain('p:');
  });
});

describe('final declaration without a trailing semicolon', () => {
  const css = (source: string) =>
    serialize(parse(source), { evaluator: buildEvaluator(makeLessRegistry()) }).css;

  it('accepts a variable declaration as the last statement in a block', () => {
    expect(css('.a { @o: 3 }')).toBe('');
    expect(css('.a { @o: 3; }')).toBe('');
  });

  it('accepts the idiomatic Less value-map forms', () => {
    expect(css('.m()  { @o: 3 }  .x { b: .m()[@o]; }')).toBe('.x {\n  b: 3;\n}\n');
    expect(css('@d: { @o: 3 };   .x { b: @d[@o]; }')).toBe('.x {\n  b: 3;\n}\n');
    expect(css('#n()  { @o: 3 }  .x { b: #n[@o]; }')).toBe('.x {\n  b: 3;\n}\n');
  });

  it('still requires the semicolon at end of stylesheet', () => {
    /* `lessc` 4.8.1: "@o rule is missing block or ending semi-colon". The `}` is
     * what licenses the omission, so a root declaration has nothing to lean on. */
    expect(() => parse('@o: 3')).toThrow(LessParseError);
    expect(css('@o: 3;')).toBe('');
  });

  it('still rejects a declaration running into the next statement', () => {
    expect(() => parse('.a { @o: 3 color: red; }')).toThrow(LessParseError);
    expect(() => parse('.a { @o: 3 b { x: 1 } }')).toThrow(LessParseError);
    expect(() => parse('.a { color: red b { x: 1 } }')).toThrow(LessParseError);
  });
});

/*
 * A keyword ends at the css-syntax-3 §4.3.11 ident-continue boundary, which
 * includes every non-ASCII ident character. An ASCII-only boundary recognized
 * the keyword and then failed on the remainder, turning valid CSS into a Less
 * parse error.
 * @see https://drafts.csswg.org/css-syntax/#ident-token-diagram
 */
describe('keyword boundaries run to full ident-continue', () => {
  it('continues an at-keyword through a non-ASCII ident character', () => {
    for (const name of ['@supportsé', '@mediaé', '@containeré', '@layeré', '@importé']) {
      expect(parse(`${name} { a { color: red; } }`), name).toMatchObject({
        rules: [{ type: 'AtRuleBlock', name, prelude: null }]
      });
    }
  });

  it('continues a named color through a non-ASCII ident character', () => {
    expect(parse('a { color: redé; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Keyword', src: 'redé' } }] }]
    });
    expect(parse('a { color: tané; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Keyword', src: 'tané' } }] }]
    });
  });

  it('still binds the real keywords', () => {
    expect(parse('a { color: red; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Keyword', src: 'red' } }] }]
    });
    expect(parse('a { color: tan; }')).toMatchObject({
      rules: [{ rules: [{ value: { type: 'Keyword', src: 'tan' } }] }]
    });
    expect(parse('@supports (color: red) { a { color: red; } }')).toMatchObject({
      rules: [{ type: 'AtRuleBlock', name: '@supports', prelude: { type: 'Block', delimiter: 'paren' } }]
    });
  });
});
