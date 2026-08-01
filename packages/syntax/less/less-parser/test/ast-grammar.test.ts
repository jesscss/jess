import { run } from 'parseman';
import type { SelectorBranch, SelectorTerm, Stylesheet } from '@jesscss/core/ast';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parseLessCst, type LessCstChild } from '../src/cst.js';
import { lessGrammar } from '../src/grammar.js';
import {
  LessBareVariableInterpolationError,
  LessDynamicCharsetError,
  LessInlineJavaScriptError,
  LessUnsupportedMixinNameError,
  LessUnsupportedVariableNameError
} from '../src/parse-error.js';
import { bare } from '../../../../../test/provenance-free.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return (
    typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && Array.isArray(value.rules)
  );
}

function stylesheet(value: unknown): Stylesheet {
  if (!isStylesheet(value)) {
    throw new TypeError('Expected the Less grammar to produce a Stylesheet');
  }
  return value;
}

function parsesCompleteStylesheet(source: string): boolean {
  try {
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    return (
      result.ok && result.unconsumedFrom === null && isStylesheet(result.value)
    );
  } catch {
    return false;
  }
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
    expect(value.sep).toSatisfy(
      separator => separator === ',' || separator === '/'
    );
  }
  Object.values(value).forEach(expectExplicitListSeparators);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function selectorTermTokens(term: SelectorTerm): unknown[] {
  return term.type === 'CompoundSelector' ? term.value : [term];
}

function firstSelectorTerm(branch: SelectorBranch): SelectorTerm {
  if (branch.type === 'ComplexSelector') {
    return branch.value[0];
  }
  if (branch.type === 'RelativeSelector') {
    return branch.value[1];
  }
  return branch;
}

function findCstNodes(
  node: LessCstChild,
  grammarType: string
): Extract<LessCstChild, { _tag: 'node' }>[] {
  if (node._tag !== 'node') {
    return [];
  }
  const self = node.grammarType === grammarType ? [node] : [];
  return [
    ...self,
    ...node.rules.flatMap(child => findCstNodes(child, grammarType))
  ];
}

function cstLeafValues(node: LessCstChild): string[] {
  if (node._tag === 'leaf') {
    return [node.value];
  }
  return node.rules.flatMap(cstLeafValues);
}

function cstIssueCount(result: ReturnType<typeof parseLessCst>): number {
  return (
    Number(!result.ok)
    + result.errors.length
    + Number(result.unconsumedFrom !== null)
  );
}

describe('Less AST grammar facts', () => {
  it('keeps ordinary adjacency as a raw value array and reserves List for explicit separators', () => {
    const result = run(
      lessGrammar.Document,
      '@space: red blue; @comma: red, blue; .x { value: @space; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(stylesheet(result.value).rules.slice(0, 2)).toMatchObject([
      {
        type: 'VariableDeclaration',
        name: 'space',
        value: [
          { type: 'Color', src: 'red' },
          { type: 'Color', src: 'blue' }
        ]
      },
      {
        type: 'VariableDeclaration',
        name: 'comma',
        value: { type: 'List', sep: ',' }
      }
    ]);
    expectExplicitListSeparators(result.value);
  });

  it('treats a standalone root block comment before an escaped selector as trivia', () => {
    const result = run(
      lessGrammar.Document,
      '/* escaped selector note */ \\62\\6c\\6f\\63\\6b { color: silver; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: 'silver' }
            }
          ]
        }
      ]
    });

    const rootRelative = run(
      lessGrammar.Document,
      '> .second { color: purple; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(rootRelative.ok && rootRelative.unconsumedFrom === null && isStylesheet(rootRelative.value)).toBe(false);
  });

  it('completes a document with final Less line-comment trivia', () => {
    const result = run(
      lessGrammar.Document,
      '@tone: red; // final override\n',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'VariableDeclaration', name: 'tone' }]
    });
  });

  it('completes a namespaced document before terminal line-comment trivia', () => {
    const result = run(
      lessGrammar.Document,
      '#ns { .m() { color: red; } }\n// compatibility note\n',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset' }]
    });
  });

  it('keeps a generic block at-rule function prelude structural', () => {
    const result = run(
      lessGrammar.Document,
      '@document url-prefix() { .child { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@document',
          prelude: { type: 'FunctionCall', name: 'url-prefix', args: [] },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
  });

  it('accepts valid CSS component preludes on generic Less at-rules', () => {
    const result = run(
      lessGrammar.Document,
      '@unknown [data-x="}"] and (--flag: value) { .child { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@unknown',
          prelude: { type: 'Any', src: '[data-x="}"] and (--flag: value)' },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
  });

  it('accepts valid CSS component preludes on generic Less at-rule statements', () => {
    const result = run(
      lessGrammar.Document,
      '@unknown (--flag: value);',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleStatement',
          name: '@unknown',
          prelude: { type: 'Any', src: '(--flag: value)' }
        }
      ]
    });
  });

  it('keeps typed generic at-rule preludes structural before the CSS component fallback', () => {
    const result = run(
      lessGrammar.Document,
      '@unknown foo 42 (bar) { .child { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@unknown',
          prelude: { type: 'SpacedValue' },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
  });

  it('keeps CSS-compatible generic at-rule function preludes structural', () => {
    const result = run(
      lessGrammar.Document,
      '@-moz-document regexp("(\\d{0,15})") { a { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@-moz-document',
          prelude: {
            type: 'FunctionCall',
            name: 'regexp',
            args: [{ type: 'Quoted', value: '(\\d{0,15})' }]
          },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
  });

  it('keeps generic at-rule calc preludes as glued function calls', () => {
    const result = run(
      lessGrammar.Document,
      '@unknown calc(1px + 2px) { a { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@unknown',
          prelude: {
            type: 'FunctionCall',
            name: 'calc',
            args: [
              {
                type: 'Operation',
                operator: '+',
                left: { type: 'Dimension', number: 1, unit: 'px', src: '1px' },
                right: { type: 'Dimension', number: 2, unit: 'px', src: '2px' }
              }
            ]
          },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
  });

  it('uses the CSS component fallback for generic prelude syntax outside the typed Less subset', () => {
    const block = run(
      lessGrammar.Document,
      '@-moz-document/* near */ /* filter */ url("example.com/{") /* a */ {}',
      { trivia: lessGrammar.whitespace }
    );
    expect(block.ok).toBe(true);
    expect(block.unconsumedFrom).toBeNull();
    expect(block.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@-moz-document',
          prelude: { type: 'Url' },
          rules: []
        }
      ]
    });

    const statement = run(
      lessGrammar.Document,
      '@arbitrary value after ();',
      { trivia: lessGrammar.whitespace }
    );
    expect(statement.ok).toBe(true);
    expect(statement.unconsumedFrom).toBeNull();
    expect(statement.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleStatement',
          name: '@arbitrary',
          prelude: { type: 'Any', src: 'value after ()' }
        }
      ]
    });
  });

  it('keeps generic at-rule prelude fallback behind Less-specific at routes', () => {
    const detachedCall = run(lessGrammar.Document, '@rules();', {
      trivia: lessGrammar.whitespace
    });
    expect(detachedCall.ok).toBe(true);
    expect(detachedCall.unconsumedFrom).toBeNull();
    expect(detachedCall.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Reference' }]
    });
  });

  it('preserves the historical doubled-quote function argument as one opaque fact', () => {
    const source =
      '@-x-document url-prefix(""github.com"") { h1 { color: red; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@-x-document',
          prelude: {
            type: 'FunctionCall',
            name: 'url-prefix',
            args: [{ type: 'Any', src: '""github.com""' }]
          }
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@-x-document url-prefix(""github.com"") {\n  h1 {\n    color: red;\n  }\n}\n'
    );

    const generic = run(
      lessGrammar.Document,
      '@unknown custom(""github.com"") { h1 { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(generic.ok).toBe(true);
    expect(generic.unconsumedFrom).toBeNull();
    expect(generic.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          prelude: {
            type: 'FunctionCall',
            name: 'custom',
            args: [{ type: 'Any', src: '""github.com""' }]
          }
        }
      ]
    });
  });

  it('keeps a block comment before a function argument comma as layout trivia', () => {
    const result = run(
      lessGrammar.Document,
      '.card { background: linear-gradient(#333 /* keep */, #111); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
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
                  { type: 'Color', src: '#333' },
                  { type: 'Color', src: '#111' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('skips Less line-comment trivia after every function-argument delimiter', () => {
    /*
     * The `separator` capture is authored layout, not a trivia substitute: the
     * argument after a delimiter runs the same ambient trivia as the first one.
     */
    const sources = [
      '.a { b: max(1px,\n  // c\n  2px); }',
      '.a { b: max(1px, // c\n2px); }',
      '.a { b: max(\n  // c\n  1px, 2px); }',
      '.a { b: e(1px;\n  // c\n  2px); }'
    ];
    for (const source of sources) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
    }
  });

  it('retains the authored delimiter gap when a line comment follows a function argument comma', () => {
    const result = run(
      lessGrammar.Document,
      '.a { b: max(1px,\n  // c\n  2px); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'FunctionCall',
                name: 'max',
                args: [
                  { type: 'Dimension', number: 1, unit: 'px' },
                  { type: 'Dimension', number: 2, unit: 'px' }
                ]
              }
            }
          ]
        }
      ]
    });

    /*
     * The authored `,\n  ` gap survives as layout; the comment is trivia, so it
     * never reaches the emitted bytes.
     */
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.a {\n  b: max(1px,\n    2px);\n}\n'
    );
  });

  it('skips line-comment trivia after a delimiter in a call-argument function', () => {
    const result = run(
      lessGrammar.Document,
      '@m: { a: 1; }\neach(@m,\n  // c\n  #(@v, @k) { .@{k} { x: @v; } });',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
  });

  it('reads a glued variable reference as the same expression as the spaced spelling', () => {
    /*
     * Less 4.x parses `1px@v` as the two-element space-separated expression
     * `1px @v`, in both `@name:` and property position. The absent gap is
     * layout, so both spellings must produce the identical value shape.
     */
    const glued = [
      '@x: 1px@v;',
      '.a { b: 1px@v; }',
      '@x: calc(@w + 2vw)@v;',
      '.a { b: calc(@w + 2vw)@v; }'
    ];
    const spaced = [
      '@x: 1px @v;',
      '.a { b: 1px @v; }',
      '@x: calc(@w + 2vw) @v;',
      '.a { b: calc(@w + 2vw) @v; }'
    ];
    const shape = (source: string): unknown => {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();

      /* Glued and spaced sources yield the same facts at different offsets, so
       * the authored span is not part of the shape being compared. */
      return bare(JSON.parse(
        JSON.stringify(result.value, (key, value) =>
          key === 'span' ? undefined : value
        )
      ));
    };
    for (let index = 0; index < glued.length; index += 1) {
      expect(bare(shape(glued[index]!), glued[index])).toEqual(shape(spaced[index]!));
    }
  });

  it('keeps a glued variable reference out of the value when the gap is a statement boundary', () => {
    const result = run(lessGrammar.Document, '@x: 1px;\n@v: 2px;', {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'x' },
        { type: 'VariableDeclaration', name: 'v' }
      ]
    });
  });

  it('reads a lookup-bearing mixin reference as a variable value', () => {
    /*
     * The bare-call arms of the variable-value choice must not claim the call
     * half of `#m(@a)[…]`; the whole reference is one value, exactly as it
     * already is in property position.
     */
    for (const source of [
      '@v: #m(@a)[];',
      '@v: #m(@a)[key];',
      '@v: #m()[];',
      '@v: .m(@a)[];',
      '@v: #ns > .m(@a)[];'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
    }
  });

  it('keeps a bare mixin call as a variable value when no lookup follows', () => {
    const result = run(lessGrammar.Document, '@v: #m(@a);', {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'v',
          value: { type: 'MixinCall' }
        }
      ]
    });
  });

  it('lowers an inline detached-ruleset each() iterable with a parameterized callback', () => {
    const result = run(
      lessGrammar.Document,
      'each({ margin: m; padding: p; }, #(@abbrev, @prop) { .@{abbrev} { @{prop}: 0; } });',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          binding: { kind: 'comma', names: ['abbrev', 'prop', undefined] }
        }
      ]
    });
  });

  it('keeps an interpolated pseudo argument structural', () => {
    const result = run(
      lessGrammar.Document,
      '.a { &:lang(@{lang}) ~ .b::after { content: @value; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Ruleset',
              selector: {
                selectors: [
                  {
                    value: [
                      {
                        type: 'CompoundSelector',
                        value: [
                          { type: 'SimpleSelector', text: '&', interp: null },

                          // The argument is typed parts, never a joined string.
                          {
                            type: 'SimpleSelector',
                            text: null,
                            interp: {
                              type: 'Interpolation',
                              parts: [
                                { lit: ':lang(' },
                                {
                                  ref: {
                                    type: 'VariableReference',
                                    name: 'lang'
                                  },
                                  unquote: true
                                },
                                { lit: ')' }
                              ]
                            }
                          }
                        ]
                      },
                      '~',
                      {
                        type: 'CompoundSelector',
                        value: [
                          { type: 'SimpleSelector', text: '.b', interp: null },
                          { type: 'SimpleSelector', text: '::after', interp: null }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('accepts an interpolated argument on non-selector and selector pseudos alike', () => {
    for (const source of [
      ':lang(@{l}) { a: b; }',
      ':dir(@{d}) { a: b; }',
      ':not(@{s}) { a: b; }',
      ':lang(x@{l}y) { a: b; }'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok, source).toBe(true);
      expect(result.unconsumedFrom, source).toBeNull();
    }
  });

  it('leaves a fully static pseudo argument on the static route', () => {
    const result = run(lessGrammar.Document, ':lang(en) { a: b; }', {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          selector: {
            selectors: [
              {
                type: 'SimpleSelector',
                text: ':lang(en)',
                interp: null
              }
            ]
          }
        }
      ]
    });
  });

  it('keeps a CSS escape hack as a typed declaration-value suffix', () => {
    const result = run(
      lessGrammar.Document,
      '.x { background-color: #000 \\9; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: [
                { type: 'Color', src: '#000' },
                { type: 'Any', src: '\\9' }
              ]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.x {\n  background-color: #000 \\9;\n}\n'
    );
  });

  it('keeps a generic at-rule parenthesized group structural after ordinary terms', () => {
    const source = '@unknown foo 42 (bar) { x { y: z; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@unknown',
          prelude: {
            type: 'SpacedValue',
            parts: [
              { type: 'Keyword', src: 'foo' },
              { type: 'Dimension', src: '42' },
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Keyword', src: 'bar' }
              }
            ]
          }
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@unknown foo 42 (bar) {\n  x {\n    y: z;\n  }\n}\n'
    );
  });

  it('keeps @page pseudo-pages as one typed header atom', () => {
    const source = '@page :first { margin: 3cm; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@page',
          prelude: { type: 'Any', src: ':first' }
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@page :first {\n  margin: 3cm;\n}\n'
    );
  });

  it('constructs static Less selector captures as existing selector-valued facts', () => {
    const source =
      '@targets: *[.notice, .card:not(.muted, .disabled):nth-child(-n+2), .tail:nth-child(2n+1)];';
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'targets',
          value: {
            type: 'SelectorCapture',
            branches: [
              '.notice',
              '.card:not(.muted, .disabled):nth-child(-n+2)',
              '.tail:nth-child(2n+1)'
            ],
            src: '*[.notice, .card:not(.muted, .disabled):nth-child(-n+2), .tail:nth-child(2n+1)]'
          }
        }
      ]
    });

    for (const invalid of [
      '@targets: *[@{selector}];',
      '@targets: *[.card-@{tone}];',
      '@targets: *[.card:not(@{tone})];',
      '@targets: * [.notice];'
    ]) {
      const rejected = run(lessGrammar.Document, invalid, {
        trivia: lessGrammar.whitespace
      });
      expect(
        rejected.ok
        && rejected.unconsumedFrom === null
        && isStylesheet(rejected.value),
        invalid
      ).toBe(false);
    }
  });

  it('lowers Less each() callbacks into canonical Jess-shaped For bindings', () => {
    const source =
      'each(@items, .(@entry) { value: @entry; });\neach(@items, .(@item, @key, @index) { value: @item; key: @key; index: @index; });\neach(@items, { value: @value; key: @key; index: @index; });';
    const legacy = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          iterable: {
            type: 'VariableReference',
            name: 'items',
            lookup: 'scoped'
          },
          binding: { kind: 'single', name: 'entry' },
          rules: [
            {
              type: 'Declaration',
              name: 'value',
              value: {
                type: 'VariableReference',
                name: 'entry',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            }
          ]
        },
        {
          type: 'For',
          iterable: {
            type: 'VariableReference',
            name: 'items',
            lookup: 'scoped'
          },
          binding: { kind: 'comma', names: ['item', 'key', 'index'] },
          rules: [
            {
              type: 'Declaration',
              name: 'value',
              value: {
                type: 'VariableReference',
                name: 'item',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            },
            {
              type: 'Declaration',
              name: 'key',
              value: {
                type: 'VariableReference',
                name: 'key',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            },
            {
              type: 'Declaration',
              name: 'index',
              value: {
                type: 'VariableReference',
                name: 'index',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            }
          ]
        },
        {
          type: 'For',
          iterable: {
            type: 'VariableReference',
            name: 'items',
            lookup: 'scoped'
          },
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: [
            {
              type: 'Declaration',
              name: 'value',
              value: {
                type: 'VariableReference',
                name: 'value',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            },
            {
              type: 'Declaration',
              name: 'key',
              value: {
                type: 'VariableReference',
                name: 'key',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            },
            {
              type: 'Declaration',
              name: 'index',
              value: {
                type: 'VariableReference',
                name: 'index',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            }
          ]
        }
      ]
    });
  });

  it('requires the Less each() opener to be glued', () => {
    const result = run(
      lessGrammar.Document,
      'each (1, { value: @value; });',
      { trivia: lessGrammar.whitespace }
    );

    expect(
      result.ok && result.unconsumedFrom === null && isStylesheet(result.value)
    ).toBe(false);
  });

  it('accepts hash-prefixed Less each() callbacks as the same canonical For binding', () => {
    const source = 'each(@items, #(@item, @key) { value: @item; key: @key; });';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          iterable: {
            type: 'VariableReference',
            name: 'items',
            lookup: 'scoped'
          },
          binding: { kind: 'comma', names: ['item', 'key', undefined] },
          rules: [
            {
              type: 'Declaration',
              name: 'value',
              value: {
                type: 'VariableReference',
                name: 'item',
                lookup: 'scoped'
              }
            },
            {
              type: 'Declaration',
              name: 'key',
              value: {
                type: 'VariableReference',
                name: 'key',
                lookup: 'scoped'
              }
            }
          ]
        }
      ]
    });
  });

  it('accepts semicolon-separated anonymous each() callback bindings', () => {
    const source =
      '.entry { each(a b, .(@value; @index) { item-@{index}: @value; }); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          rules: [
            {
              type: 'For',
              binding: { kind: 'comma', names: ['value', 'index', undefined] }
            }
          ]
        }
      ]
    });
  });

  it('lowers a flat static mixin call iterable into the existing For iterable fact', () => {
    const source =
      '.values() { first: red; second: blue; } each(.values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.values' },
        {
          type: 'For',
          iterable: { type: 'MixinCall', name: '.values', args: [], path: [] },
          binding: { kind: 'comma', names: ['value', 'key', undefined] },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
  });

  it('lowers a static namespaced mixin-call iterable through the existing MixinCall path fact', () => {
    const source =
      '.library { .values() { first: red; second: blue; } } each(.library > .values(), .(@value, @key) { .item { value: @value; key: @key; } });';
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [{ type: 'SimpleSelector', text: '.library' }]
          },
          rules: [{ type: 'MixinDefinition', name: '.values' }]
        },
        {
          type: 'For',
          iterable: {
            type: 'MixinCall',
            name: '.values',
            args: [],
            path: [{ combinator: ' ', selector: '.library' }]
          },
          binding: { kind: 'comma', names: ['value', 'key', undefined] },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
    expect(isStylesheet(direct.value)).toBe(true);
    if (!isStylesheet(direct.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(direct.value)).toEqual({
      css: '.item {\n  value: red;\n  key: first;\n}\n.item {\n  value: blue;\n  key: second;\n}\n'
    });
  });

  it('keeps dynamic, important, and semicolon namespaced mixin-call iterables out of the ambiguous selector route', () => {
    for (const source of [
      'each(.library > .@{name}(), { color: red; });',
      'each(.library > .values() !important, { color: red; });',
      'each(.library > .values();, { color: red; });'
    ]) {
      const direct = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        source
      ).toBe(false);
    }
  });

  it('lowers a flat static mixin call variable value into the existing callable binding fact', () => {
    const source =
      '.make-map() { tone: blue; } @map: .make-map(red, @tone: blue);';
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.make-map' },
        {
          type: 'VariableDeclaration',
          name: 'map',
          value: {
            type: 'MixinCall',
            name: '.make-map',
            args: [
              { value: { src: 'red' } },
              { name: 'tone', value: { src: 'blue' } }
            ],
            path: [],
            important: false
          }
        }
      ]
    });
  });

  it('drops only authored empty statements from simple and named each callbacks', () => {
    const source =
      'each(1, { ; value: @value; ; }); each(2, .(@entry) { ; value: @entry; ; });';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          binding: { kind: 'comma', names: ['value', 'key', 'index'] },
          rules: [{ type: 'Declaration', name: 'value' }]
        },
        {
          type: 'For',
          binding: { kind: 'single', name: 'entry' },
          rules: [{ type: 'Declaration', name: 'value' }]
        }
      ]
    });
  });

  it('retains the existing typed keyframes fact in detached-ruleset and each callback bodies', () => {
    const source =
      '@theme: { @keyframes fade { from { opacity: 0; } } }; each(1, { @-webkit-keyframes "slide" { 50% { opacity: @value; } } });';
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
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
  });

  it('constructs canonical import, variable, declaration, and ruleset facts directly', () => {
    const result = run(
      lessGrammar.Document,
      '@theme: "dark";\n.a { /* note */ color: red; }\n@import "theme.less";\n@-import \'tokens.less\';',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: {
            type: 'Quoted',
            src: '"dark"',
            value: 'dark',
            quote: '"',
            escaped: false
          },
          write: { mode: 'declare' }
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '.a', interp: null }
            ]
          },
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: 'red' },
              merge: null,
              important: false
            }
          ]
        },
        {
          type: 'ImportAtRule',
          name: '@import',
          options: null,
          target: {
            type: 'Quoted',
            src: '"theme.less"',
            value: 'theme.less',
            quote: '"',
            escaped: false
          },
          alias: null,
          tail: null
        },
        {
          type: 'ImportAtRule',
          name: '@-import',
          options: null,
          target: {
            type: 'Quoted',
            src: '\'tokens.less\'',
            value: 'tokens.less',
            quote: '\'',
            escaped: false
          },
          alias: null,
          tail: null
        }
      ]
    });
  });

  it('constructs an indirect variable as a typed two-step reference and evaluates it', () => {
    const source = '@name: tone; @tone: red; .card { color: @@name; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'tone' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: {
                type: 'VarIndirect',
                nameRef: {
                  type: 'VariableReference',
                  name: 'name',
                  lookup: 'scoped'
                },
                lookup: 'scoped'
              }
            }
          ]
        }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe('.card {\n  color: red;\n}\n');
  });

  it('constructs precedence-aware Less arithmetic without widening slash-list semantics', () => {
    const source =
      '@a: 2; .math { sum: 1 + 2 * 3; grouped: (1 + 2) * 3; neg: -(@a + 1); signed: -2px + 3px; ratio: 12px / 1.5; compact: 1 +2; spacedMinus: 1 -23; calc: calc(100% - (20px / 2)); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'a' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'sum',
              value: {
                type: 'Operation',
                operator: '+',
                left: { type: 'Dimension', src: '1' },
                right: {
                  type: 'Operation',
                  operator: '*',
                  left: { type: 'Dimension', src: '2' },
                  right: { type: 'Dimension', src: '3' }
                }
              }
            },
            {
              type: 'Declaration',
              name: 'grouped',
              value: {
                type: 'Operation',
                operator: '*',
                left: {
                  type: 'Block',
                  delimiter: 'paren',
                  value: { type: 'Operation', operator: '+' }
                },
                right: { type: 'Dimension', src: '3' }
              }
            },
            {
              type: 'Declaration',
              name: 'neg',
              value: {
                type: 'Operation',
                operator: '*',
                left: { type: 'Dimension', src: '-1' },
                right: {
                  type: 'Block',
                  delimiter: 'paren',
                  value: { type: 'Operation', operator: '+' }
                }
              }
            },
            {
              type: 'Declaration',
              name: 'signed',
              value: {
                type: 'Operation',
                operator: '+',
                left: { type: 'Dimension', src: '-2px' },
                right: { type: 'Dimension', src: '3px' }
              }
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
              name: 'compact',
              value: [
                { type: 'Dimension', src: '1' },
                { type: 'Dimension', src: '+2' }
              ]
            },
            {
              type: 'Declaration',
              name: 'spacedMinus',
              value: [
                { type: 'Dimension', src: '1' },
                { type: 'Dimension', src: '-23' }
              ]
            },
            {
              type: 'Declaration',
              name: 'calc',
              value: {
                type: 'FunctionCall',
                name: 'calc',
                args: [{ type: 'Operation', operator: '-' }]
              }
            }
          ]
        }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a Less Stylesheet.');
    }

    /*
     * Serialization without a ValueEvaluator is deliberately structural; this
     * assertion proves the direct tree has not turned Less math into raw text.
     */
    expect(serialize(result.value).css).toContain('sum: 1 + 2 * 3;');
    expect(serialize(result.value).css).toContain('grouped: (1 + 2) * 3;');
    expect(serialize(result.value).css).toContain('ratio: 12px / 1.5;');
    expect(serialize(result.value).css).toContain('compact: 1 +2;');
  });

  it('keeps known function openers strict while generic functions stay generic', () => {
    for (const { source, cstNode, value } of [
      {
        source: '.x { v: calc(1px + 2px); }',
        cstNode: 'CalcCall',
        value: { type: 'FunctionCall', name: 'calc' }
      },
      {
        source: '.x { v: foo(); }',
        cstNode: 'Call',
        value: { type: 'FunctionCall', name: 'foo' }
      },
      {
        source: '.x { v: url(@x); }',
        cstNode: 'Url',
        value: { type: 'Url' }
      },
      {
        source: '.x { v: url(foo); }',
        cstNode: 'Url',
        value: { type: 'Url' }
      }
    ]) {
      const cst = parseLessCst(source);
      expect(cstIssueCount(cst), source).toBe(0);
      expect(findCstNodes(cst.tree, cstNode).length, source).toBeGreaterThan(0);

      const direct = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(direct.ok, source).toBe(true);
      expect(direct.unconsumedFrom, source).toBeNull();
      expect(stylesheet(direct.value), source).toMatchObject({
        rules: [{ rules: [{ name: 'v', value }] }]
      });
    }

    for (const source of [
      '.x { v: calc(); }',
      '.x { v: calc(+); }',
      '.x { v: 0 calc(); }',
      '.x { v: 0 calc(+); }',
      '.x { v: calc(1px +2px); }',
      '.x { v: foo(+); }'
    ]) {
      const cst = parseLessCst(source);
      expect(cstIssueCount(cst), source).toBeGreaterThan(0);
      expect(parsesCompleteStylesheet(source), source).toBe(false);
    }
  });

  it('accepts modern CSS color functions as ordinary function values', () => {
    const source =
      '.modern { background: rgb(from blue calc(r + 100) g b); accent: oklch(from #0000FF calc(l / 2) c h); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cstIssueCount(cst)).toBe(0);
    expect(findCstNodes(cst.tree, 'Call').map(cstLeafValues)).toEqual(
      expect.arrayContaining([
        /*
         * The sum operator's leaf value is the sign alone, exactly as the
         * product operator's is on the next line. It used to carry its authored
         * padding (`' + '`) because the operator was one whitespace-only regex;
         * now that the padding may hold a comment, the operator owns the sign
         * and the padding stays padding, so `+` and `/` finally spell the same
         * kind of thing. The authored bytes are unchanged — they are the leaf's
         * span, not its value.
         */
        ['rgb(', 'from', 'blue', 'calc(', 'r', '+', '100', ')', 'g', 'b', ')'],
        ['oklch(', 'from', '#0000FF', 'calc(', 'l', '/', '2', ')', 'c', 'h', ')']
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'background',
              value: {
                type: 'FunctionCall',
                name: 'rgb',
                args: [
                  [
                    { type: 'Keyword', src: 'from' },
                    { type: 'Color', src: 'blue' },
                    {
                      type: 'FunctionCall',
                      name: 'calc',
                      args: [{ type: 'Operation', operator: '+' }]
                    },
                    { type: 'Keyword', src: 'g' },
                    { type: 'Keyword', src: 'b' }
                  ]
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'accent',
              value: {
                type: 'FunctionCall',
                name: 'oklch',
                args: [
                  [
                    { type: 'Keyword', src: 'from' },
                    { type: 'Color', src: '#0000FF' },
                    {
                      type: 'FunctionCall',
                      name: 'calc',
                      args: [{ type: 'Operation', operator: '/' }]
                    },
                    { type: 'Keyword', src: 'c' },
                    { type: 'Keyword', src: 'h' }
                  ]
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('keeps comment-aware product operators as one flat arithmetic stream', () => {
    const source =
      '.math { product: 2 * // factor\n 3; modulo: 7 // divisor follows\n % 3; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'product',
              value: {
                type: 'Operation',
                operator: '*',
                left: { type: 'Dimension', src: '2' },
                right: { type: 'Dimension', src: '3' }
              }
            },
            {
              type: 'Declaration',
              name: 'modulo',
              value: {
                type: 'Operation',
                operator: '%',
                left: { type: 'Dimension', src: '7' },
                right: { type: 'Dimension', src: '3' }
              }
            }
          ]
        }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe(
      '.math {\n  product: 2 * 3;\n  modulo: 7 % 3;\n}\n'
    );

    const malformed = run(
      lessGrammar.Document,
      '.math { product: 2 * // missing operand\n; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(malformed.ok && malformed.unconsumedFrom === null).toBe(false);
  });

  it('admits comments as operand separators for both product and sum operators', () => {
    /*
     * `*` / `%` are unambiguous — like CSS `calc()` (where `*`/`/` need no
     * whitespace) block and line comments count as separating trivia.
     */
    const product = run(
      lessGrammar.Document,
      '.m { star: 1/**/*/**/2; mod: 7 /* x */ % /* y */ 3; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(product.ok && product.unconsumedFrom === null).toBe(true);
    expect(product.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'star',
              value: {
                type: 'Operation',
                operator: '*',
                left: { type: 'Dimension', src: '1' },
                right: { type: 'Dimension', src: '2' }
              }
            },
            {
              type: 'Declaration',
              name: 'mod',
              value: {
                type: 'Operation',
                operator: '%',
                left: { type: 'Dimension', src: '7' },
                right: { type: 'Dimension', src: '3' }
              }
            }
          ]
        }
      ]
    });

    /*
     * `+` / `-` are sign-ambiguous, so the operand must be SEPARATED from the
     * operator — but a comment separates. This assertion was inverted until the
     * sum pad stopped hand-spelling its own trivia and started naming the
     * dialect's `mathTrivia` table (DESIGN-DECISIONS G24): the old pad REQUIRED
     * a whitespace run, so a comment standing alone as the separator did not
     * count, `1/**\/-/**\/2` performed no arithmetic, and the comment bytes were
     * emitted verbatim into the CSS as value content. lessc 4.x folds this to
     * `-1px`, so the old answer was also a byte divergence from the oracle.
     *
     * css-syntax-3 §4 makes a comment trivia wherever whitespace is trivia, and
     * `1 -2` is still a list — see the signed-dimension case below — because the
     * separation is required on BOTH sides, not because comments are excluded.
     */
    const commentSum = run(
      lessGrammar.Document,
      '.m { x: 1/**/-/**/2; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(commentSum.value).toMatchObject({
      rules: [
        { rules: [{ name: 'x', value: { type: 'Operation', operator: '-' } }] }
      ]
    });

    // Real whitespace around `-` still IS a subtraction (unchanged).
    const spacedSum = run(lessGrammar.Document, '.m { x: 1 - 2; }', {
      trivia: lessGrammar.whitespace
    });
    expect(spacedSum.value).toMatchObject({
      rules: [
        { rules: [{ name: 'x', value: { type: 'Operation', operator: '-' } }] }
      ]
    });

    /* A comment may also sit alongside whitespace in the same pad. */
    const paddedSum = run(lessGrammar.Document, '.m { x: 1 /* z */- 2; }', {
      trivia: lessGrammar.whitespace
    });
    expect(paddedSum.value).toMatchObject({
      rules: [
        { rules: [{ name: 'x', value: { type: 'Operation', operator: '-' } }] }
      ]
    });

    /*
     * `1 -2` stays a space list whose second item is the signed dimension. This
     * is the coupling the whole rule turns on, and it survives because the pad
     * is required on BOTH sides of the operator: there is one before the `-` and
     * none after it, so the separated arm cannot match and the glued arms reject
     * it on their `(?![0-9.])` guard.
     */
    const signList = run(lessGrammar.Document, '.m { x: 1 -2; }', {
      trivia: lessGrammar.whitespace
    });
    expect(
      JSON.stringify(signList.value ?? {}).includes('"operator":"-"')
    ).toBe(false);
  });

  /*
   * `calc(` owns its boundary gaps for the same reason `Paren` does: the math
   * ladder runs under `noTrivia`, so an interior that admits authored padding
   * has to spell it. Without those terms `calc( 1px + 2px )` was rejected as
   * hard as its comment forms were, and `Paren`'s own padding was unreachable
   * from inside a calc.
   */
  it('admits authored whitespace and comments at the calc boundary', () => {
    for (const source of [
      '.m { x: calc( 1px + 2px); }',
      '.m { x: calc(1px + 2px ); }',
      '.m { x: calc(/* c */1px + 2px); }',
      '.m { x: calc(1px + 2px/* c */); }',
      '.m { x: calc(1px + /* c */ 2px); }',
      '.m { x: calc( (1px + 2px) ); }',
      '.m { x: calc(( 1px + 2px )); }'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
    }
  });

  it('keeps the comments2 variable/parens product on the same math route', () => {
    const source =
      '@column-width: @base * 6em; @columns: 12; @gridsystem-width: (@column-width * // total columns */\n @columns) + ( // width */\n @gutter-width * // gutters */\n @columns);';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a Less Stylesheet.');
    }
    expect(
      result.value.rules.find(
        child =>
          child.type === 'VariableDeclaration'
          && child.name === 'gridsystem-width'
      )
    ).toMatchObject({
      value: { type: 'Operation', operator: '+' }
    });
  });

  it('keeps a glued top-level Less slash group structural for later calc evaluation', () => {
    const source =
      '@ratio: 50vh/2; .card { direct: @ratio; calc: calc(100% - (@ratio - 20px)); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(result.value.rules[0]).toMatchObject({
      type: 'VariableDeclaration',
      name: 'ratio',
      value: [
        { type: 'Dimension', src: '50vh' },
        { type: 'Keyword', src: '/' },
        { type: 'Dimension', src: '2' }
      ]
    });
    expect(serialize(result.value).css).toBe(
      '.card {\n  direct: 50vh / 2;\n  calc: calc(100% - (50vh / 2 - 20px));\n}\n'
    );
  });

  it('left-factors preserved slash value pieces without changing their grammar facts', () => {
    const source = [
      '@trivia: 12px / 1.5 / 3;',
      '.case {',
      '  bare: 12px;',
      '  slash: 12px/1.5;',
      '  multi: 12px/1.5/3;',
      '  function: min(12px/1.5/3, 2px);',
      '}'
    ].join('\n');
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'trivia',
          value: {
            type: 'SpacedValue',
            parts: [
              { type: 'Dimension', src: '12px' },
              { type: 'Keyword', src: '/' },
              { type: 'Dimension', src: '1.5' },
              { type: 'Keyword', src: '/' },
              { type: 'Dimension', src: '3' }
            ],
            separators: [' ', ' ', ' ', ' ']
          }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'bare',
              value: { type: 'Dimension', src: '12px' }
            },
            {
              type: 'Declaration',
              name: 'slash',
              value: [
                { type: 'Dimension', src: '12px' },
                { type: 'Keyword', src: '/' },
                { type: 'Dimension', src: '1.5' }
              ]
            },
            {
              type: 'Declaration',
              name: 'multi',
              value: [
                { type: 'Dimension', src: '12px' },
                { type: 'Keyword', src: '/' },
                { type: 'Dimension', src: '1.5' },
                { type: 'Keyword', src: '/' },
                { type: 'Dimension', src: '3' }
              ]
            },
            {
              type: 'Declaration',
              name: 'function',
              value: {
                type: 'FunctionCall',
                name: 'min',
                args: [
                  { type: 'Operation' },
                  { type: 'Dimension', src: '2px' }
                ]
              }
            }
          ]
        }
      ]
    });

    const malformed = run(
      lessGrammar.Document,
      '.case { malformed: 12px / * 2px; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(malformed.ok && malformed.unconsumedFrom === null).toBe(false);
  });

  it('constructs zero-argument variable calls as final Reference steps directly', () => {
    const source = '@theme(); .card { @theme(); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Reference',
          base: { type: 'VariableReference', name: 'theme', lookup: 'scoped' },
          steps: [{ type: 'Call', args: [] }],
          raw: '@theme()'
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Reference',
              base: {
                type: 'VariableReference',
                name: 'theme',
                lookup: 'scoped'
              },
              steps: [{ type: 'Call', args: [] }],
              raw: '@theme()'
            }
          ]
        }
      ]
    });
  });

  it('constructs bare function-call statements as existing FunctionCall facts', () => {
    const source = 'e("x"); .card { e("y"); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'FunctionCall',
          name: 'e',
          args: [{ type: 'Quoted', value: 'x' }]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'FunctionCall',
              name: 'e',
              args: [{ type: 'Quoted', value: 'y' }]
            }
          ]
        }
      ]
    });
  });

  it('constructs deprecated Less percent-format syntax as the existing percent FunctionCall', () => {
    const source = '.card { text: %("hello %s", "world"); modulo: 10 % 3; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'text',
              value: {
                type: 'FunctionCall',
                name: '%',
                args: [
                  { type: 'Quoted', value: 'hello %s' },
                  { type: 'Quoted', value: 'world' }
                ]
              }
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
    for (const invalid of [
      '.card { text: %foo; }',
      '.card { text: %("x",); }'
    ]) {
      const direct = run(lessGrammar.Document, invalid, {
        trivia: lessGrammar.whitespace
      });
      expect(direct.ok && direct.unconsumedFrom === null, invalid).toBe(false);
    }
  });

  it('keeps a static Less escaped quote inside percent-format arguments', () => {
    const source = '.card { text: %(~"hello %s", "world"); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'FunctionCall',
                name: '%',
                args: [
                  { type: 'Quoted', value: 'hello %s', escaped: true },
                  { type: 'Quoted', value: 'world' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs static body and inline extends with exact/all multi-target semantics', () => {
    const source =
      '.target { color: navy; } .rules { &:extend(.target, .other !all); } .first, .inline:extend(.target all), .sibling { color: red; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Ruleset', selector: { type: 'SelectorList' } },
        {
          type: 'Ruleset',
          extendInstructions: [
            { target: { type: 'SelectorList' }, partial: false },
            { target: { type: 'SelectorList' }, partial: true }
          ]
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '.first' },
              { type: 'SimpleSelector', text: '.inline' },
              { type: 'SimpleSelector', text: '.sibling' }
            ]
          },
          extendInstructions: [
            {
              target: { type: 'SelectorList' },
              partial: true,
              subject: {
                type: 'SelectorList',
                selectors: [{ type: 'SimpleSelector', text: '.inline' }]
              }
            }
          ]
        }
      ]
    });
  });

  it('keeps inline extend branch ownership aligned across AST and CST host modes', () => {
    const source =
      '.first, .inline:extend(.target all), .sibling { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '.first' },
              { type: 'SimpleSelector', text: '.inline' },
              { type: 'SimpleSelector', text: '.sibling' }
            ]
          },
          extendInstructions: [
            {
              partial: true,
              subject: {
                selectors: [{ type: 'SimpleSelector', text: '.inline' }]
              },
              target: {
                selectors: [{ type: 'SimpleSelector', text: '.target' }]
              }
            }
          ]
        }
      ]
    });

    const inlineExtends = findCstNodes(cst.tree, 'ExtendPseudo');
    expect(inlineExtends).toHaveLength(1);
    expect(cstLeafValues(inlineExtends[0]!)).toEqual([
      ':',
      'extend',
      '(',
      '.target',
      'all',
      ')'
    ]);
    expect(findCstNodes(cst.tree, 'InlineExtendTail')).toHaveLength(0);
  });

  it('keeps a repeated inline extend selector list as branch-owned instructions', () => {
    const source =
      '.ext3 > .leaf:extend(.foo all), .ext4:hover:extend(.bar !all), .plain {}';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'ComplexSelector',
                value: [{ text: '.ext3' }, '>', { text: '.leaf' }]
              },
              {
                type: 'CompoundSelector',
                value: [{ text: '.ext4' }, { text: ':hover' }]
              },
              { type: 'SimpleSelector', text: '.plain' }
            ]
          },
          extendInstructions: [
            {
              partial: true,
              target: {
                selectors: [{ type: 'SimpleSelector', text: '.foo' }]
              },
              subject: {
                selectors: [
                  {
                    value: [{ text: '.ext3' }, '>', { text: '.leaf' }]
                  }
                ]
              }
            },
            {
              partial: true,
              target: {
                selectors: [{ type: 'SimpleSelector', text: '.bar' }]
              },
              subject: {
                selectors: [
                  {
                    type: 'CompoundSelector',
                    value: [{ text: '.ext4' }, { text: ':hover' }]
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    const inlineExtends = findCstNodes(cst.tree, 'ExtendPseudo');
    expect(inlineExtends).toHaveLength(2);
    expect(inlineExtends.map(cstLeafValues)).toEqual([
      [':', 'extend', '(', '.foo', 'all', ')'],
      [':', 'extend', '(', '.bar', '!all', ')']
    ]);
    expect(findCstNodes(cst.tree, 'InlineExtendTail')).toHaveLength(0);
  });

  it('keeps inline extend subjects on the full parsed selector branch', () => {
    const source =
      '.active&:extend(.target), .ext1 .ext2 :extend(.foo all) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              { type: 'CompoundSelector', value: [{ text: '.active' }, { text: '&' }] },
              {
                value: [{ text: '.ext1' }, ' ', { text: '.ext2' }]
              }
            ]
          },
          extendInstructions: [
            {
              partial: false,
              subject: {
                selectors: [
                  { type: 'CompoundSelector', value: [{ text: '.active' }, { text: '&' }] }
                ]
              },
              target: {
                selectors: [{ type: 'SimpleSelector', text: '.target' }]
              }
            },
            {
              partial: true,
              subject: {
                selectors: [
                  {
                    value: [{ text: '.ext1' }, ' ', { text: '.ext2' }]
                  }
                ]
              },
              target: {
                selectors: [{ type: 'SimpleSelector', text: '.foo' }]
              }
            }
          ]
        }
      ]
    });

    const inlineExtends = findCstNodes(cst.tree, 'ExtendPseudo');
    expect(inlineExtends).toHaveLength(2);
    expect(inlineExtends.map(cstLeafValues)).toEqual([
      [':', 'extend', '(', '.target', ')'],
      [':', 'extend', '(', '.foo', 'all', ')']
    ]);
    expect(findCstNodes(cst.tree, 'InlineExtendTail')).toHaveLength(0);
  });

  it('rejects bare and non-terminal inline extend selectors', () => {
    for (const source of [
      ':extend(.a all) { color: red; }',
      '.a:extend(.b all).c { color: red; }'
    ]) {
      const cst = parseLessCst(source);
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });

      expect(cstIssueCount(cst), source).toBeGreaterThan(0);
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(false);
    }
  });

  it('stops direct extend targets before terminal all and !all flags', () => {
    const result = run(
      lessGrammar.Document,
      '.subject { &:extend(.a .b all, .c > .d !all); color: black; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          extendInstructions: [
            {
              partial: true,
              target: {
                selectors: [
                  {
                    value: [{ text: '.a' }, ' ', { text: '.b' }]
                  }
                ]
              }
            },
            {
              partial: true,
              target: {
                selectors: [
                  {
                    value: [{ text: '.c' }, '>', { text: '.d' }]
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.subject {\n  color: black;\n}\n'
    );
  });

  it('uses the ordinary direct statement body inside an inline extend rule', () => {
    const source =
      '.paint() { color: red; } .target { width: 1px; } .inline:extend(.target) { .paint(); each(1, { order: @value; }); @media screen { display: block; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.paint' },
        { type: 'Ruleset' },
        {
          type: 'Ruleset',
          extendInstructions: [{ target: { type: 'SelectorList' } }],
          rules: [
            { type: 'MixinCall', name: '.paint' },
            { type: 'For' },
            { type: 'AtRuleBlock', name: '@media' }
          ]
        }
      ]
    });
  });

  it('accepts an optional statement terminator after an inline extend ruleset', () => {
    const result = run(
      lessGrammar.Document,
      '.target { color: navy; } .alias:extend(.target) {};',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [{ type: 'Ruleset' }, { type: 'Ruleset' }]
    });
  });

  it('constructs recursively grammar-built detached-ruleset variable bindings directly', () => {
    const source = '@theme: { ; @accent: blue; color: @accent; ; };';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: {
            type: 'AnonymousMixin',
            rules: [
              {
                type: 'VariableDeclaration',
                name: 'accent',
                value: { type: 'Color', src: 'blue' }
              },
              {
                type: 'Declaration',
                name: 'color',
                value: { type: 'VariableReference', name: 'accent' }
              }
            ]
          }
        }
      ]
    });
  });

  it('retains numeric detached-ruleset map keys as declaration facts', () => {
    const source =
      '@grays: { 100: #f8f9fa; 900: #212529; <: %3c; #: %23; (: %28; };';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'grays',
          value: {
            type: 'AnonymousMixin',
            rules: [
              {
                type: 'Declaration',
                name: '100',
                value: { type: 'Color', src: '#f8f9fa' }
              },
              {
                type: 'Declaration',
                name: '900',
                value: { type: 'Color', src: '#212529' }
              },
              { type: 'Declaration', name: '<' },
              { type: 'Declaration', name: '#' },
              { type: 'Declaration', name: '(' }
            ]
          }
        }
      ]
    });
  });

  it('constructs full direct statement bodies in detached rulesets and each callbacks', () => {
    const source =
      '@theme: { .nested { color: red; } @media screen { .media { color: blue; } } .tone() { color: green; } each(1, { .item { order: @value; } }); };\neach(1, .(@entry) { .entry { order: @entry; } @media print { .print { color: black; } } });';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: {
            type: 'AnonymousMixin',
            rules: [
              { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] },
              { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'Ruleset' }] },
              {
                type: 'MixinDefinition',
                name: '.tone',
                rules: [{ type: 'Declaration', name: 'color' }]
              },
              {
                type: 'For',
                rules: [
                  {
                    type: 'Ruleset',
                    rules: [{ type: 'Declaration', name: 'order' }]
                  }
                ]
              }
            ]
          }
        },
        {
          type: 'For',
          binding: { kind: 'single', name: 'entry' },
          rules: [
            { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'order' }] },
            { type: 'AtRuleBlock', name: '@media', rules: [{ type: 'Ruleset' }] }
          ]
        }
      ]
    });
  });

  /**
   * A detached-ruleset body, an `each()` callback body and a block mixin
   * argument are all nested contexts: a child rule there may lead with a
   * combinator, exactly as it may inside an ordinary ruleset body. The
   * stylesheet root is not a nested context and keeps rejecting it.
   */
  it('admits leading-combinator child rules in every nested statement container', () => {
    const containers: Array<[string, string]> = [
      ['detached ruleset', '@d: { color: red; > td { color: blue; } };'],
      ['each() callback', 'each(1, { > td { color: blue; } });'],
      ['parameterized each() callback', 'each(1, .(@e) { ~ td { color: blue; } });'],
      ['block mixin argument', '.a { #h({ > td { color: blue; } }); }'],
      ['ordinary ruleset body', '.a { > td { color: blue; } }']
    ];
    for (const [label, source] of containers) {
      expect(parsesCompleteStylesheet(source), label).toBe(true);
      expect(cstIssueCount(parseLessCst(source)), `${label} (CST)`).toBe(0);
    }

    const detached = run(lessGrammar.Document, '@d: { color: red; > td { color: blue; } };', {
      trivia: lessGrammar.whitespace
    });
    expect(detached.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'd',
          value: {
            type: 'AnonymousMixin',
            rules: [
              { type: 'Declaration', name: 'color' },
              {
                type: 'Ruleset',
                selector: {
                  selectors: [
                    {
                      type: 'RelativeSelector',
                      value: ['>', { type: 'SimpleSelector', text: 'td', interp: null }]
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    });

    const callback = run(lessGrammar.Document, 'each(1, { ~ td { color: blue; } });', {
      trivia: lessGrammar.whitespace
    });
    expect(callback.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'For',
          rules: [
            {
              type: 'Ruleset',
              selector: {
                selectors: [
                  {
                    type: 'RelativeSelector',
                    value: ['~', { type: 'SimpleSelector', text: 'td', interp: null }]
                  }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('still rejects a leading-combinator selector at the stylesheet root', () => {
    for (const source of [
      '> .a { color: red; }',
      '+ .a { color: red; }',
      '~ .a { color: red; }'
    ]) {
      expect(parsesCompleteStylesheet(source), source).toBe(false);
    }
  });

  it('keeps standalone extend statements out of direct detached and callback bodies until they have a statement fact', () => {
    for (const source of [
      '@theme: { &:extend(.target); };',
      'each(1, { &:extend(.target); });'
    ]) {
      const cst = parseLessCst(source);
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });

      expect(cstIssueCount(cst), source).toBeGreaterThan(0);
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(false);
    }
  });

  it('retains argument-bearing variable calls as typed final Reference steps', () => {
    const source = '@theme(red);';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(
      result.ok && result.unconsumedFrom === null && isStylesheet(result.value)
    ).toBe(true);
    expect(result.value).toMatchObject({
      rules: [
        {
          type: 'Reference',
          base: { type: 'VariableReference', name: 'theme', lookup: 'scoped' },
          steps: [
            { type: 'Call', args: [{ value: { type: 'Color', src: 'red' } }] }
          ]
        }
      ]
    });
  });

  it('uses detached rulesets only in public call-argument and parameter-default positions', () => {
    const source =
      '@theme: { color: red; }; .m(@default: { width: 1px; }) { } .m({ color: blue; }); .m(@named: { color: green; }); fn({ display: block; });';
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: {
            type: 'AnonymousMixin',
            rules: [{ type: 'Declaration', name: 'color' }]
          }
        },
        {
          type: 'MixinDefinition',
          name: '.m',
          params: [
            {
              name: 'default',
              default: {
                type: 'AnonymousMixin',
                rules: [{ type: 'Declaration', name: 'width' }]
              }
            }
          ]
        },
        {
          type: 'MixinCall',
          name: '.m',
          args: [
            {
              value: {
                type: 'AnonymousMixin',
                rules: [{ type: 'Declaration', name: 'color' }]
              }
            }
          ]
        },
        {
          type: 'MixinCall',
          name: '.m',
          args: [
            {
              name: 'named',
              value: {
                type: 'AnonymousMixin',
                rules: [{ type: 'Declaration', name: 'color' }]
              }
            }
          ]
        },
        {
          type: 'FunctionCall',
          name: 'fn',
          args: [
            {
              type: 'AnonymousMixin',
              rules: [{ type: 'Declaration', name: 'display' }]
            }
          ]
        }
      ]
    });

    const valueArgument = run(
      lessGrammar.Document,
      'value: fn({ color: red; });',
      { trivia: lessGrammar.whitespace }
    );
    expect(valueArgument.ok).toBe(true);
    expect(valueArgument.unconsumedFrom).toBeNull();
    expect(valueArgument.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Declaration',
          name: 'value',
          value: {
            type: 'FunctionCall',
            name: 'fn',
            args: [
              {
                type: 'AnonymousMixin',
                rules: [{ type: 'Declaration', name: 'color' }]
              }
            ]
          }
        }
      ]
    });

    const finalRootDeclaration = run(
      lessGrammar.Document,
      'value: fn({ color: red; })',
      { trivia: lessGrammar.whitespace }
    );
    expect(finalRootDeclaration.ok).toBe(true);
    expect(finalRootDeclaration.unconsumedFrom).toBeNull();
    expect(finalRootDeclaration.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Declaration',
          name: 'value',
          value: {
            type: 'FunctionCall',
            name: 'fn',
            args: [
              {
                type: 'AnonymousMixin',
                rules: [{ type: 'Declaration', name: 'color' }]
              }
            ]
          }
        }
      ]
    });

    const separatedRootDeclaration = run(
      lessGrammar.Document,
      'value: red; @media all { x: y; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(separatedRootDeclaration.ok).toBe(true);
    expect(separatedRootDeclaration.unconsumedFrom).toBeNull();
    expect(separatedRootDeclaration.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'Declaration', name: 'value' },
        { type: 'AtRuleBlock', name: '@media' }
      ]
    });

    for (const rejected of [
      'value: red @media all { x: y; }',
      '.card { color: red @media all { color: blue; } }'
    ]) {
      const cst = parseLessCst(rejected);
      const result = run(lessGrammar.Document, rejected, {
        trivia: lessGrammar.whitespace
      });
      expect(
        cst.errors.length + (cst.unconsumedFrom === null ? 0 : 1),
        rejected
      ).toBeGreaterThan(0);
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        rejected
      ).toBe(false);
    }

    const customValueKeepsAtRuleBytes = run(
      lessGrammar.Document,
      '.card { --x:red @media all {x:y} }',
      { trivia: lessGrammar.whitespace }
    );
    expect(customValueKeepsAtRuleBytes.ok).toBe(true);
    expect(customValueKeepsAtRuleBytes.unconsumedFrom).toBeNull();
    expect(customValueKeepsAtRuleBytes.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: '--x',
              value: { type: 'Any', src: 'red @media all {x:y} ' }
            }
          ]
        }
      ]
    });

    const customValueWithSeparator = run(
      lessGrammar.Document,
      '.card { --x:red; @media all { x: y; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(customValueWithSeparator.ok).toBe(true);
    expect(customValueWithSeparator.unconsumedFrom).toBeNull();
    expect(customValueWithSeparator.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: '--x' },
            { type: 'AtRuleBlock', name: '@media' }
          ]
        }
      ]
    });

    for (const rejected of [
      'value: { color: red; };',
      'value: %({ color: red; });'
    ]) {
      const legacy = parseLessCst(rejected);
      const result = run(lessGrammar.Document, rejected, {
        trivia: lessGrammar.whitespace
      });
      expect(legacy.unconsumedFrom, rejected).not.toBeNull();
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        rejected
      ).toBe(false);
    }

    /*
     * Punctuation map keys are direct declaration facts, never an opaque
     * detached-body recovery path.
     */
    const rawDetachedBody = '@theme: { <: %3c; };';
    const rawLegacy = parseLessCst(rawDetachedBody);
    const rawResult = run(lessGrammar.Document, rawDetachedBody, {
      trivia: lessGrammar.whitespace
    });
    expect(rawLegacy.errors).toHaveLength(0);
    expect(rawLegacy.unconsumedFrom).toBeNull();
    expect(rawResult.ok).toBe(true);
    expect(rawResult.unconsumedFrom).toBeNull();
    expect(rawResult.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: {
            type: 'AnonymousMixin',
            rules: [
              {
                type: 'Declaration',
                name: '<',
                value: { type: 'Any', src: '%3c' }
              }
            ]
          }
        }
      ]
    });
    const nestedConditionalArgument = run(
      lessGrammar.Document,
      '.m({ @media (tv) { color: black; } });',
      { trivia: lessGrammar.whitespace }
    );
    expect(nestedConditionalArgument.ok).toBe(true);
    expect(nestedConditionalArgument.unconsumedFrom).toBeNull();
  });

  it('constructs static import options, url targets, and recursively balanced tails directly', () => {
    const result = run(
      lessGrammar.Document,
      '@import (less, multiple) url(theme.css) screen and (min-width: 600px) supports(label: "wide mode");',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'ImportAtRule',
          name: '@import',
          options: {
            type: 'List',
            value: [
              { type: 'Any', src: 'less' },
              { type: 'Any', src: 'multiple' }
            ],
            sep: ','
          },
          target: { type: 'Url', value: { type: 'Any', src: 'theme.css' } },
          alias: null,
          tail: {
            type: 'Any',
            src: 'screen and (min-width: 600px) supports(label: "wide mode")'
          }
        }
      ]
    });
  });

  it('constructs a variable-bearing import query tail without an opaque tail fallback', () => {
    const result = run(
      lessGrammar.Document,
      '@var: 100px; @import url("//ha.com/file.css") (min-width:@var);',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'var' },
        {
          type: 'ImportAtRule',
          target: {
            type: 'Url',
            value: { type: 'Quoted', value: '//ha.com/file.css' }
          },
          tail: {
            type: 'Block',
            delimiter: 'paren',
            value: {
              type: 'Operation',
              operator: ':',
              left: { type: 'Keyword', src: 'min-width' },
              right: {
                type: 'VariableReference',
                name: 'var',
                lookup: 'scoped'
              }
            }
          }
        }
      ]
    });
  });

  it('constructs quoted Less import interpolation as a structural target fact', () => {
    const result = run(
      lessGrammar.Document,
      '@import (less, multiple) "theme-@{name}.css" screen;',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'ImportAtRule',
          options: {
            type: 'List',
            sep: ',',
            value: [
              { type: 'Any', src: 'less' },
              { type: 'Any', src: 'multiple' }
            ]
          },
          target: {
            type: 'Interpolation',
            parts: [
              { lit: '"theme-' },
              {
                ref: { type: 'VariableReference', name: 'name' },
                unquote: true
              },
              { lit: '.css"' }
            ]
          },
          tail: { type: 'Any', src: 'screen' }
        }
      ]
    });
  });

  it('constructs one complete interpolated import tail as a structural fact', () => {
    const result = run(
      lessGrammar.Document,
      '@import (reference) "theme.less" @{media};',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'ImportAtRule',
          options: {
            type: 'List',
            sep: ',',
            value: [{ type: 'Any', src: 'reference' }]
          },
          target: { type: 'Quoted', value: 'theme.less' },
          tail: {
            type: 'Interpolation',
            parts: [
              {
                ref: {
                  type: 'VariableReference',
                  name: 'media',
                  lookup: 'scoped'
                },
                unquote: true
              }
            ]
          }
        }
      ]
    });
  });

  it('constructs unquoted dynamic URL values and import targets as typed interpolation', () => {
    const source =
      '@asset: icons; @theme: theme; .asset { variable: url(@asset/path.svg); template: url(@{theme}/icon.svg); } @import url(@{theme}.css);';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'asset' },
        { type: 'VariableDeclaration', name: 'theme' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'variable',
              value: {
                type: 'Url',
                value: {
                  type: 'Interpolation',
                  parts: [
                    { ref: { type: 'VariableReference', name: 'asset' } },
                    { lit: '/path.svg' }
                  ]
                }
              }
            },
            {
              type: 'Declaration',
              name: 'template',
              value: {
                type: 'Url',
                value: {
                  type: 'Interpolation',
                  parts: [
                    { ref: { type: 'VariableReference', name: 'theme' } },
                    { lit: '/icon.svg' }
                  ]
                }
              }
            }
          ]
        },
        {
          type: 'ImportAtRule',
          target: {
            type: 'Url',
            value: {
              type: 'Interpolation',
              parts: [
                { ref: { type: 'VariableReference', name: 'theme' } },
                { lit: '.css' }
              ]
            }
          }
        }
      ]
    });
  });

  it('keeps invalid interpolation-shaped quoted import text literal', () => {
    for (const source of [
      '@import "theme-@{bad.path}.css";',
      '@import "theme-@{ x }.css";',
      '@import "theme-@{}.css";'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(true);
      expect(result.value).toMatchObject({
        rules: [{ type: 'ImportAtRule', target: { type: 'Quoted' } }]
      });
    }
  });

  it('rejects non-static or unbalanced import facts instead of creating opaque fallbacks', () => {
    for (const source of [
      '@import "theme-@{name}.css;',
      '@import "theme.less" @media;',
      '@import "theme.less" @@media;',
      '@import "theme.less" @ {media};',
      '@import "theme.less" @{media} screen;',
      '@import "theme.less" screen @{media};',
      '@import "theme.less" @{media}@{print};',
      '@import "theme.less" ${media};',
      '@import "theme.less" screen and (min-width: 600px;',
      '@import "theme.less" screen and [min-width: 600px);',
      '@import "theme.less" screen and [min-width: 600px];',
      '@import "theme.less" screen and {min-width: 600px};',
      '@import "theme.less" screen and (min-width: {600px});',
      '@import "theme.less" screen and "unterminated;',
      '@import \'theme.less\' screen and \'unterminated;',
      '@import "theme.less" screen and (min-width: 600px));',
      '@import "theme.less" screen and (min-width: 600px)};',
      '@import (unknown) "theme.less";'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value)
      ).toBe(false);
      expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
    }
  });

  it('constructs keyword and variable-reference values without recovering value text', () => {
    const result = run(
      lessGrammar.Document,
      '@base: red;\n@theme: @base;\n.a { color: @theme; background: red; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'base',
          value: { type: 'Color', src: 'red' },
          write: { mode: 'declare' }
        },
        {
          type: 'VariableDeclaration',
          name: 'theme',
          value: { type: 'VariableReference', name: 'base', lookup: 'scoped' },
          write: { mode: 'declare' }
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '.a', interp: null }
            ]
          },
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: {
                type: 'VariableReference',
                name: 'theme',
                lookup: 'scoped'
              },
              merge: null,
              important: false
            },
            {
              type: 'Declaration',
              name: 'background',
              value: { type: 'Color', src: 'red' },
              merge: null,
              important: false
            }
          ]
        }
      ]
    });
  });

  it('feeds top-level and ruleset-local variable facts straight into the canonical serializer', () => {
    const result = run(
      lessGrammar.Document,
      '@base: red;\n.a { @tone: @base; color: @tone; }',
      { trivia: lessGrammar.whitespace }
    );

    if (
      !result.ok
      || result.unconsumedFrom !== null
      || !isStylesheet(result.value)
    ) {
      throw new Error('Less grammar did not make a Stylesheet.');
    }
    expect(serialize(result.value).css).toBe('.a {\n  color: red;\n}\n');
  });

  it('constructs a commented multiline comma-list variable value with a trailing comma', () => {
    const source = '.items { @values:\n  // fruit\n  apple,\n  banana,\n; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'VariableDeclaration',
              name: 'values',
              value: {
                type: 'List',
                sep: ',',
                value: [
                  { type: 'Keyword', src: 'apple' },
                  { type: 'Keyword', src: 'banana' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs static dimensions, colors, URLs, calls, and comma/space lists directly', () => {
    const source =
      '.a { margin: +1.5e2rem 0 -2%; color: #ff00aa; background: url(icons/a.svg); empty: url(); escaped: url(foo\\ bar); shadow: rgb(255, 0, 128),\n inset 0 1px #000; }';
    const legacy = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    /*
     * This is the same static lexical subset the existing Less grammar accepts;
     * the grammar receives each piece as a Parseman child and never
     * reclassifies a captured declaration string.
     */
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '.a', interp: null }
            ]
          },
          rules: [
            {
              type: 'Declaration',
              name: 'margin',
              merge: null,
              important: false,
              value: [
                {
                  type: 'Dimension',
                  number: 150,
                  unit: 'rem',
                  src: '+1.5e2rem'
                },
                { type: 'Dimension', number: 0, unit: '', src: '0' },
                { type: 'Dimension', number: -2, unit: '%', src: '-2%' }
              ]
            },
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: '#ff00aa' },
              merge: null,
              important: false
            },
            {
              type: 'Declaration',
              name: 'background',
              merge: null,
              important: false,
              value: {
                type: 'Url',
                value: { type: 'Any', src: 'icons/a.svg' }
              }
            },
            {
              type: 'Declaration',
              name: 'empty',
              merge: null,
              important: false,
              value: { type: 'Url', value: { type: 'Any', src: '' } }
            },
            {
              type: 'Declaration',
              name: 'escaped',
              merge: null,
              important: false,
              value: { type: 'Url', value: { type: 'Any', src: 'foo\\ bar' } }
            },
            {
              type: 'Declaration',
              name: 'shadow',
              merge: null,
              important: false,
              value: {
                type: 'List',
                sep: ',',
                value: [
                  {
                    type: 'FunctionCall',
                    name: 'rgb',
                    modern: false,
                    args: [
                      { type: 'Dimension', number: 255, unit: '', src: '255' },
                      { type: 'Dimension', number: 0, unit: '', src: '0' },
                      { type: 'Dimension', number: 128, unit: '', src: '128' }
                    ]
                  },
                  [
                    { type: 'Keyword', src: 'inset' },
                    { type: 'Dimension', number: 0, unit: '', src: '0' },
                    { type: 'Dimension', number: 1, unit: 'px', src: '1px' },
                    { type: 'Color', src: '#000' }
                  ]
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs a bare percent sign as a keyword function argument', () => {
    const source = 'size: unit(100, %);';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Declaration',
          value: {
            type: 'FunctionCall',
            name: 'unit',
            args: [
              { type: 'Dimension', src: '100' },
              { type: 'Keyword', src: '%' }
            ]
          }
        }
      ]
    });
    const serializable = run(
      lessGrammar.Document,
      `.test { ${source} }`,
      { trivia: lessGrammar.whitespace }
    );
    expect(serializable.ok).toBe(true);
    expect(serializable.unconsumedFrom).toBeNull();
    expect(serialize(stylesheet(serializable.value)).css).toBe(
      '.test {\n  size: unit(100, %);\n}\n'
    );
  });

  it('constructs a comparison condition in a Less function argument', () => {
    const full = run(
      lessGrammar.Document,
      '#boolean { a: boolean(not(2 < 1)); b: boolean(not(2 > 1) and (true)); c: boolean(not(boolean(true))); f: boolean((2 > 1) = (3 > 2)); }',
      { trivia: lessGrammar.whitespace }
    );
    expect(full.ok).toBe(true);
    expect(full.unconsumedFrom).toBeNull();
    const result = run(
      lessGrammar.Document,
      'x: boolean(not(2 < 1));',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            args: [
              {
                type: 'Condition',
                guard: { g: 'not', inner: { g: 'cmp', op: '<' } }
              }
            ]
          }
        }
      ]
    });
  });

  it('routes only top-level function condition syntax through the condition grammar', () => {
    const result = run(
      lessGrammar.Document,
      'nested: boolean(foo(1 = 1)); guard: boolean(foo(1 = 1) and true); plain: fn(red blue);',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            args: [
              {
                type: 'FunctionCall',
                name: 'foo',
                args: [{ type: 'Condition', guard: { g: 'cmp', op: '=' } }]
              }
            ]
          }
        },
        {
          value: {
            args: [{ type: 'Condition', guard: { g: 'and' } }]
          }
        },
        {
          value: {
            args: [[{ type: 'Color', src: 'red' }, { type: 'Color', src: 'blue' }]]
          }
        }
      ]
    });
    expect(parsesCompleteStylesheet('x: boolean(true and);')).toBe(false);
    expect(parsesCompleteStylesheet('x: boolean(1 =);')).toBe(false);
    expect(parsesCompleteStylesheet('x: boolean(foo(1 = 1) and);')).toBe(false);
  });

  it('constructs an assignment argument for `name=value`, not an equality comparison', () => {
    const result = run(
      lessGrammar.Document,
      'a: alpha(opacity=50); b: foo(bar=1, baz=2); c: foo(bar = 1); d: foo(bar=@v);',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            type: 'FunctionCall',
            name: 'alpha',
            args: [{ type: 'Assignment', key: 'opacity', value: { type: 'Dimension', src: '50' } }]
          }
        },
        {
          value: {
            args: [
              { type: 'Assignment', key: 'bar', value: { type: 'Dimension', src: '1' } },
              { type: 'Assignment', key: 'baz', value: { type: 'Dimension', src: '2' } }
            ]
          }
        },
        {
          value: {
            args: [{ type: 'Assignment', key: 'bar', value: { type: 'Dimension', src: '1' } }]
          }
        },
        {
          value: {
            args: [{ type: 'Assignment', key: 'bar', value: { type: 'VariableReference', name: 'v' } }]
          }
        }
      ]
    });
  });

  it('keeps a comparison whose left operand is not a bare identifier on the condition grammar', () => {
    const result = run(
      lessGrammar.Document,
      'a: boolean(3 = 4); b: foo(@v = 1); c: foo(bar >= 1);',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        { value: { args: [{ type: 'Condition', guard: { g: 'cmp', op: '=' } }] } },
        { value: { args: [{ type: 'Condition', guard: { g: 'cmp', op: '=' } }] } },
        { value: { args: [{ type: 'Condition', guard: { g: 'cmp', op: '>=' } }] } }
      ]
    });
  });

  it('does not claim an `=` that opens a longer comparison operator', () => {
    const result = run(
      lessGrammar.Document,
      'a: foo(bar =< 1); b: foo(bar => 1);',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        { value: { args: [{ type: 'Condition', guard: { g: 'cmp', op: '=<' } }] } },
        { value: { args: [{ type: 'Condition', guard: { g: 'cmp', op: '=>' } }] } }
      ]
    });
  });

  it('constructs a Less function condition comparison between parenthesized conditions', () => {
    const result = run(
      lessGrammar.Document,
      'x: boolean((2 > 1) = (3 > 2));',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            type: 'FunctionCall',
            name: 'boolean',
            args: [
              {
                type: 'Condition',
                guard: {
                  g: 'cmp',
                  op: '=',
                  left: { type: 'Condition', guard: { g: 'cmp', op: '>' } },
                  right: { type: 'Condition', guard: { g: 'cmp', op: '>' } }
                }
              }
            ]
          }
        }
      ]
    });
  });

  it('does not construct unparenthesized condition equality as a Less function condition operand', () => {
    expect(parsesCompleteStylesheet('x: boolean(2 > 1 = 3 > 2);')).toBe(false);
  });

  it('enforces Less function condition grouping for boolean() and if()', () => {
    const accepts = [
      'x: boolean(1 = 1);',
      'x: boolean(not (1 = 1));',
      'x: boolean((1 = 1) and (2 = 2));',
      'x: if(1 = 1, yes, no);',
      'x: if(not (1 = 1), yes, no);',
      'x: if((1 = 1) and (2 = 2), yes, no);'
    ];
    const rejects = [
      'x: boolean(not 1 = 1);',
      'x: boolean(1 = 1 and (2 = 2));',
      'x: if(not 1 = 1, yes, no);',
      'x: if(1 = 1 and (2 = 2), yes, no);'
    ];

    for (const source of accepts) {
      expect(parsesCompleteStylesheet(source), source).toBe(true);
    }
    for (const source of rejects) {
      expect(parsesCompleteStylesheet(source), source).toBe(false);
    }
  });

  it('constructs a truth condition in a multi-argument Less function call', () => {
    const result = run(
      lessGrammar.Document,
      'x: if(not(false), 1, 2);',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
  });

  it('constructs arithmetic inside Less function arguments as an operation', () => {
    const result = run(lessGrammar.Document, 'x: round(32 / 3);', {
      trivia: lessGrammar.whitespace
    });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            type: 'FunctionCall',
            name: 'round',
            args: [{ type: 'Operation', operator: '/' }]
          }
        }
      ]
    });
  });

  it('keeps an inter-argument block comment as function layout trivia', () => {
    const source = 'x: mix(blue, #FFF /* explanation */, 50%);';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            type: 'FunctionCall',
            name: 'mix',
            args: [
              { type: 'Color', src: 'blue' },
              { type: 'Color', src: '#FFF' },
              { type: 'Dimension', src: '50%' }
            ]
          }
        }
      ]
    });
  });

  it('keeps a generic function argument as one space-separated value slot while treating comments as trivia', () => {
    const source = 'grid-template-columns: repeat(14, 10px /* gap */ 60px);';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          value: {
            type: 'FunctionCall',
            name: 'repeat',
            args: [
              { type: 'Dimension', src: '14' },
              [
                { type: 'Dimension', src: '10px' },
                { type: 'Dimension', src: '60px' }
              ]
            ]
          }
        }
      ]
    });
  });

  it('keeps variable-initializer comments out of later typed call arguments', () => {
    const source =
      '@color: #FFF/* source note */; html { color: mix(blue, @color, 50%); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'color',
          value: { type: 'Color', src: '#FFF' }
        },
        {
          type: 'Ruleset',
          rules: [
            {
              value: {
                type: 'FunctionCall',
                name: 'mix',
                args: [
                  { type: 'Color', src: 'blue' },
                  {
                    type: 'VariableReference',
                    name: 'color',
                    lookup: 'scoped'
                  },
                  { type: 'Dimension', src: '50%' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('keeps detached rulesets as typed arguments of a Less function value', () => {
    const result = run(
      lessGrammar.Document,
      'x: if(not(false), { c: 3 }, { d: 4 });',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          value: {
            type: 'FunctionCall',
            name: 'if',
            args: [
              { type: 'Condition' },
              { type: 'AnonymousMixin' },
              { type: 'AnonymousMixin' }
            ]
          }
        }
      ]
    });
  });

  it('parses the upstream Less function-condition block without a legacy fallback', () => {
    const statements = [
      'a: if(not(false), 1, 2);',
      'b: if(not(true), 1, 2);',
      '@rules: if(not(false), {c: 3}, {d: 4}); @rules();',
      'e: if(not(true), 5);',
      '@f: boolean(3 = 4);',
      'f: if(not(@f), 6);',
      'g: if(true, 3, 5);',
      'h: if(false, 3, 5);',
      'i: if(true and isnumber(6), 6, 8);',
      'j: if(not(true) and true, 6, 8);',
      'k: if(true or true, 1);',
      '@some: foo;',
      'l: if((iscolor(@some)), darken(@some, 10%), black);',
      'if((false), {g: 7});',
      '@conditional: if((true), { color: green; }, {}); @conditional();',
      '@falsey: if((false), { color: orange; }, { color: purple; }); @falsey();'
    ];
    for (let count = 1; count <= statements.length; count += 1) {
      const source = `#if { ${statements.slice(0, count).join(' ')} }`;
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok, `first ${count} function-condition statements`).toBe(
        true
      );
      expect(
        result.unconsumedFrom,
        `first ${count} function-condition statements`
      ).toBeNull();
    }
  });

  it('constructs escaped parenthesized Less lists as typed, iterable values', () => {
    const result = run(
      lessGrammar.Document,
      '.x { value: ~(1, 2, 3); each(~(1 2 3); { item: @value; }); }',
      { trivia: lessGrammar.whitespace }
    );
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          rules: [
            {
              type: 'Declaration',
              value: {
                type: 'Block',
                delimiter: 'paren',
                escaped: true,
                value: {
                  type: 'List',
                  sep: ',',
                  value: [
                    { type: 'Dimension' },
                    { type: 'Dimension' },
                    { type: 'Dimension' }
                  ]
                }
              }
            },
            {
              type: 'For',
              iterable: {
                type: 'Block',
                delimiter: 'paren',
                escaped: true,
                value: [
                  { type: 'Dimension' },
                  { type: 'Dimension' },
                  { type: 'Dimension' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('keeps CSS custom-property tokens structural in nested Less function arguments', () => {
    const result = run(
      lessGrammar.Document,
      '.a { color: rgba(var(--color-accent), 0.2); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: {
                type: 'FunctionCall',
                name: 'rgba',
                args: [
                  {
                    type: 'FunctionCall',
                    name: 'var',
                    args: [{ type: 'Keyword', src: '--color-accent' }]
                  },
                  { type: 'Dimension', src: '0.2' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('retains multiline declaration value slots as canonical facts', () => {
    const source =
      '.grid { grid-template-areas:\n  "header header"\n  "content sidebar"; }';
    const result = run(lessGrammar.Document, source, {
      state: { source },
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'grid-template-areas',
              valueOnNewLine: true,
              value: [
                { type: 'Quoted', value: 'header header' },
                { type: 'Quoted', value: 'content sidebar' }
              ]
            }
          ]
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '.grid {\n  grid-template-areas:\n    "header header"\n    "content sidebar";\n}\n'
    });
  });

  it('constructs bare variable and interpolation URL bodies as typed values', () => {
    const source =
      '.asset { direct: url(@asset); interpolated: url(@{asset}.svg); quoted: url("@{base}/icon.svg"); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'direct',
              value: {
                type: 'Url',
                value: { type: 'VariableReference', name: 'asset' }
              }
            },
            {
              type: 'Declaration',
              name: 'interpolated',
              value: {
                type: 'Url',
                value: {
                  type: 'Interpolation',
                  parts: [
                    {
                      ref: { type: 'VariableReference', name: 'asset' },
                      unquote: true
                    },
                    { lit: '.svg' }
                  ]
                }
              }
            },
            {
              type: 'Declaration',
              name: 'quoted',
              value: {
                type: 'Url',
                value: {
                  type: 'Interpolation',
                  parts: [
                    { lit: '"' },
                    {
                      ref: { type: 'VariableReference', name: 'base' },
                      unquote: true
                    },
                    { lit: '/icon.svg"' }
                  ]
                }
              }
            }
          ]
        }
      ]
    });
  });

  it('retains declaration-head and value comments as trivia', () => {
    const source =
      '.card { color/* property */: grey; margin /* before merge */ + /* before colon */: 0; border: /* value */ solid black; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              merge: null,
              value: { type: 'Color', src: 'grey' }
            },
            {
              type: 'Declaration',
              name: 'margin',
              merge: ',',
              value: { type: 'Dimension', src: '0' }
            },
            {
              type: 'Declaration',
              name: 'border',
              merge: null,
              value: [
                { type: 'Keyword', src: 'solid' },
                { type: 'Color', src: 'black' }
              ]
            }
          ]
        }
      ]
    });

    /*
     * Grammar runs prove AST shape. Public parse() owns document trivia
     * attachment and the render replay assertion for these comment gaps.
     */
  });

  it('keeps fallback CSS at-rule prelude comments in trivia, not semantic bytes', () => {
    const result = run(lessGrammar.AtRulePrelude, 'a/* note */b', {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Any', src: 'a b' });
    expect(JSON.stringify(result.value)).not.toContain('/* note */');
  });

  it('constructs Less declaration merge and importance modifiers without flattening them into value text', () => {
    const source =
      '@accent: navy !important; .card { box-shadow+: @accent; box-shadow+: white; font+_: serif !important; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'accent',
          value: { type: 'Important', value: { type: 'Color', src: 'navy' } },
          write: { mode: 'declare' }
        },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '.card', interp: null }
            ]
          },
          rules: [
            {
              type: 'Declaration',
              name: 'box-shadow',
              value: {
                type: 'VariableReference',
                name: 'accent',
                lookup: 'scoped'
              },
              merge: ',',
              important: false
            },
            {
              type: 'Declaration',
              name: 'box-shadow',
              value: { type: 'Color', src: 'white' },
              merge: ',',
              important: false
            },
            {
              type: 'Declaration',
              name: 'font',
              value: { type: 'Keyword', src: 'serif' },
              merge: ' ',
              important: true
            }
          ]
        }
      ]
    });
  });

  it('constructs generic static at-rule blocks and statements through canonical at-rule nodes', () => {
    const source =
      '@charset "utf-8"; @namespace url(http://www.w3.org/1999/xhtml); @namespace foo url(http://www.example.com); @font-face { font-family: Inter; src: url(font.woff2); } @media screen { .card { color: red; } } .outer { @layer utilities { color: blue; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleStatement',
          name: '@charset',
          prelude: { type: 'Quoted', src: '"utf-8"', value: 'utf-8' }
        },
        {
          type: 'AtRuleStatement',
          name: '@namespace',
          prelude: {
            type: 'Url',
            value: { type: 'Any', src: 'http://www.w3.org/1999/xhtml' }
          }
        },
        {
          type: 'AtRuleStatement',
          name: '@namespace',
          prelude: {
            type: 'SpacedValue',
            parts: [
              { type: 'Keyword', src: 'foo' },
              {
                type: 'Url',
                value: { type: 'Any', src: 'http://www.example.com' }
              }
            ]
          }
        },
        {
          type: 'AtRuleBlock',
          name: '@font-face',
          prelude: null,
          rules: [
            {
              type: 'Declaration',
              name: 'font-family',
              value: { type: 'Keyword', src: 'Inter' }
            },
            {
              type: 'Declaration',
              name: 'src',
              value: { type: 'Url', value: { type: 'Any', src: 'font.woff2' } }
            }
          ]
        },
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: { type: 'Keyword', src: 'screen' },
          rules: [
            {
              type: 'Ruleset',
              selector: { type: 'SelectorList' },
              rules: [
                {
                  type: 'Declaration',
                  name: 'color',
                  value: { type: 'Color', src: 'red' }
                }
              ]
            }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'AtRuleBlock',
              name: '@layer',
              prelude: { type: 'Keyword', src: 'utilities' },
              rules: [
                {
                  type: 'Declaration',
                  name: 'color',
                  value: { type: 'Color', src: 'blue' }
                }
              ]
            }
          ]
        }
      ]
    });

    for (const dynamic of [
      '@custom @{query} { .card { color: red; } }',
      '@custom foo@{query} { .card { color: red; } }',
      '@custom foo @{query} { .card { color: red; } }',
      '@custom foo@{query};',
      '@custom foo @{query};'
    ]) {
      const rejected = run(lessGrammar.Document, dynamic, {
        trivia: lessGrammar.whitespace
      });
      expect(
        rejected.ok
        && rejected.unconsumedFrom === null
        && isStylesheet(rejected.value),
        dynamic
      ).toBe(false);
    }
  });

  it('keeps generic CSS opaque at-rule blocks narrow in Less', () => {
    const source = '@future {!!:foo > ; > ?bar}';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
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

    for (const dynamic of [
      '@custom foo@{query};',
      '@custom foo @{query};',
      '@theme: { &:extend(.target); };'
    ]) {
      const opaque = run(lessGrammar.OpaqueAtRuleBlock, dynamic, {
        trivia: lessGrammar.whitespace
      });
      expect(opaque.ok && opaque.unconsumedFrom === null, dynamic).toBe(false);
    }
  });

  it('keeps opaque at-rule prelude comments in trivia, not semantic bytes', () => {
    const result = run(lessGrammar.OpaqueAtRuleBlock, '@future a/* note */b { color: red; }', {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'OpaqueAtRuleBlock',
      name: '@future',
      prelude: 'a b',
      rawBody: ' color: red; '
    });
    expect(JSON.stringify(result.value)).not.toContain('/* note */');
  });

  it('keeps charset on the static generic route while retaining typed namespace interpolation', () => {
    const source =
      '@charset "UTF-8"; @ns: less; @namespace @{ns} "http://lesscss.org";';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleStatement',
          name: '@charset',
          prelude: {
            type: 'Quoted',
            src: '"UTF-8"',
            value: 'UTF-8'
          }
        },
        { type: 'VariableDeclaration', name: 'ns' },
        {
          type: 'AtRuleStatement',
          name: '@namespace',
          prelude: {
            type: 'SpacedValue',
            parts: [
              {
                type: 'Interpolation',
                parts: [
                  {
                    ref: {
                      type: 'VariableReference',
                      name: 'ns',
                      lookup: 'scoped'
                    },
                    unquote: true
                  }
                ]
              },
              {
                type: 'Quoted',
                src: '"http://lesscss.org"',
                value: 'http://lesscss.org'
              }
            ]
          }
        }
      ]
    });

    expect(() =>
      run(
        lessGrammar.Document,
        '@Eight: 8; @charset "UTF-@{Eight}";',
        { trivia: lessGrammar.whitespace }
      )
    ).toThrow(LessDynamicCharsetError);

    for (const rejectedSource of [
      '@charset @{encoding};',
      '@custom foo@{name};'
    ]) {
      const rejected = run(lessGrammar.Document, rejectedSource, {
        trivia: lessGrammar.whitespace
      });
      expect(
        rejected.ok
        && rejected.unconsumedFrom === null
        && isStylesheet(rejected.value),
        rejectedSource
      ).toBe(false);
    }
  });

  it('recognizes inline backtick JavaScript as removed Less syntax', () => {
    expect(() =>
      run(lessGrammar.Document, '.entry { value: `1 + 1`; }', {
        trivia: lessGrammar.whitespace
      })
    ).toThrow(LessInlineJavaScriptError);
  });

  it('recognizes bare at-variable prelude interpolation as removed Less syntax', () => {
    for (const source of [
      '@media @q { .card { color: red; } }',
      '@supports (@cond) { .card { color: red; } }',
      '@container @name (inline-size > 30em) { .card { color: red; } }',
      '@layer @name;',
      '@keyframes @name { from { opacity: 0; } }'
    ]) {
      expect(
        () =>
          run(lessGrammar.Document, source, {
            trivia: lessGrammar.whitespace
          }),
        source
      ).toThrow(LessBareVariableInterpolationError);
    }

    const valid = run(
      lessGrammar.Document,
      '@media (min-width: @w) { .card { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(valid.ok).toBe(true);
    expect(valid.unconsumedFrom).toBeNull();
  });

  it('recognizes unsupported legacy Less variable and mixin names', () => {
    for (const source of [
      '@1: red;',
      '.entry { color: @1; }',
      '.entry { color: @@-; }',
      '@{1}: red;',
      '@-: red;',
      '.entry { color: @-; }',
      '@{-}: red;',
      '.m(@-) { color: red; }',
      '.m(@x) { color: @x; } .entry { .m(@-: red); }',
      'each(1, .(@-) { color: red; });'
    ]) {
      expect(
        () =>
          run(lessGrammar.Document, source, {
            trivia: lessGrammar.whitespace
          }),
        source
      ).toThrow(LessUnsupportedVariableNameError);
    }

    for (const source of [
      '.-();',
      '#-();',
      '.-() { color: red; }'
    ]) {
      expect(
        () =>
          run(lessGrammar.Document, source, {
            trivia: lessGrammar.whitespace
          }),
        source
      ).toThrow(LessUnsupportedMixinNameError);
    }
  });

  it('constructs interpolated and dotted layer headers through canonical at-rule nodes', () => {
    const source =
      '@layer-name: theme; @layer @{layer-name} { .card { color: red; } } @layer framework.buttons { .button { color: blue; } } @layer reset, base;';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'layer-name' },
        {
          type: 'AtRuleBlock',
          name: '@layer',
          prelude: {
            type: 'Interpolation',
            parts: [
              {
                ref: { type: 'VariableReference', name: 'layer-name' },
                unquote: true
              }
            ]
          },
          rules: [
            {
              type: 'Ruleset',
              rules: [
                {
                  type: 'Declaration',
                  name: 'color',
                  value: { type: 'Color', src: 'red' }
                }
              ]
            }
          ]
        },
        {
          type: 'AtRuleBlock',
          name: '@layer',
          prelude: { type: 'Keyword', src: 'framework.buttons' },
          rules: [
            {
              type: 'Ruleset',
              rules: [
                {
                  type: 'Declaration',
                  name: 'color',
                  value: { type: 'Color', src: 'blue' }
                }
              ]
            }
          ]
        },
        {
          type: 'AtRuleStatement',
          name: '@layer',
          prelude: {
            type: 'List',
            sep: ',',
            value: [
              { type: 'Keyword', src: 'reset' },
              { type: 'Keyword', src: 'base' }
            ]
          }
        }
      ]
    });
  });

  it('constructs static CSS keyframes through canonical at-rule and rule facts', () => {
    const source =
      '@keyframes fade { from, 50% { opacity: 0; } to { opacity: 1; } } @-webkit-keyframes "slide" { 0%, 100% { left: 0; } } @keyframes ~"spin" { from { opacity: 0; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@keyframes',
          prelude: { type: 'Keyword', src: 'fade' },
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
            { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'opacity' }] }
          ]
        },
        {
          type: 'AtRuleBlock',
          name: '@-webkit-keyframes',
          prelude: { type: 'Quoted', value: 'slide' },
          rules: [
            {
              type: 'Ruleset',
              selector: {
                type: 'SelectorList',
                selectors: [
                  { type: 'SimpleSelector' },
                  { type: 'SimpleSelector' }
                ]
              }
            }
          ]
        },
        {
          type: 'AtRuleBlock',
          name: '@keyframes',
          prelude: {
            type: 'Quoted',
            src: '~"spin"',
            value: 'spin',
            escaped: true
          },
          rules: [
            {
              type: 'Ruleset',
              selector: {
                type: 'SelectorList',
                selectors: [{ type: 'SimpleSelector' }]
              }
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@keyframes fade {\n  from,\n  50% {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n@-webkit-keyframes "slide" {\n  0%,\n  100% {\n    left: 0;\n  }\n}\n@keyframes spin {\n  from {\n    opacity: 0;\n  }\n}\n'
    );

    expect(() =>
      run(
        lessGrammar.Document,
        '@keyframes @name { from { opacity: 0; } }',
        {
          trivia: lessGrammar.whitespace
        }
      )
    ).toThrow(LessBareVariableInterpolationError);

    for (const rejected of [
      '@keyframes fade { @{step} { opacity: 0; } }',
      '@keyframes fade { 10 { opacity: 0; } }'
    ]) {
      const direct = run(lessGrammar.Document, rejected, {
        trivia: lessGrammar.whitespace
      });
      expect(direct.ok && direct.unconsumedFrom === null, rejected).toBe(false);
    }
  });

  it('treats Less keyframe comments as trivia', () => {
    const bodyComment =
      '@keyframes fade { from { /* body note */ opacity: 0; } }';
    const direct = run(lessGrammar.Document, bodyComment, {
      trivia: lessGrammar.whitespace
    });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          rules: [
            {
              type: 'Ruleset',
              rules: [{ type: 'Declaration', name: 'opacity' }]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(direct.value)).css).toBe(
      '@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n'
    );

    for (const source of [
      '@keyframes fade { from /* selector note */, 50% { opacity: 0; } }',
      '@keyframes fade { from, /* selector note */ 50% { opacity: 0; } }',
      '@keyframes fade { from /* selector note */ { opacity: 0; } }'
    ]) {
      const accepted = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(accepted.ok && accepted.unconsumedFrom === null, source).toBe(
        true
      );
    }
  });

  it('matches public acceptance of an empty statement inside a generic at-rule body without inventing an AST node', () => {
    const source = '@foo { ; color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@foo',
          prelude: null,
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: 'red' },
              merge: null,
              important: false
            }
          ]
        }
      ]
    });
  });

  it('constructs bounded static @supports conditions with structural parentheses', () => {
    const source =
      '@supports ((display: grid) or (color: red)) and (hover) { .card { color: red; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@supports',
          prelude: {
            type: 'SpacedValue',
            parts: [
              {
                type: 'Block',
                delimiter: 'paren',
                value: {
                  type: 'SpacedValue',
                  parts: [
                    {
                      type: 'Block',
                      delimiter: 'paren',
                      value: { type: 'Operation', operator: ':' }
                    },
                    { type: 'Keyword', src: 'or' },
                    {
                      type: 'Block',
                      delimiter: 'paren',
                      value: { type: 'Operation', operator: ':' }
                    }
                  ]
                }
              },
              { type: 'Keyword', src: 'and' },
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Keyword', src: 'hover' }
              }
            ]
          },
          rules: [
            { type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }
          ]
        }
      ]
    });
  });

  it('renders bounded @supports parentheses without changing quoted or escaped feature values', () => {
    const source =
      '@supports (font-family: "A  \\"B\\"") and ((display: grid) or (color: red)) { .card { color: red; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@supports (font-family: "A  \\"B\\"") and ((display: grid) or (color: red)) {\n  .card {\n    color: red;\n  }\n}\n'
    });
  });

  it('keeps multi-token @supports feature values structural and canonicalizes their padding', () => {
    const source =
      '@supports ( box-shadow: 2px 2px 2px black ) or ( -moz-box-shadow: 2px 2px 2px black ) { .card { color: red; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(result.value.rules[0]).toMatchObject({
      type: 'AtRuleBlock',
      name: '@supports',
      prelude: {
        type: 'SpacedValue',
        parts: [
          {
            type: 'Block',
            delimiter: 'paren',
            value: {
              type: 'Operation',
              operator: ':',
              right: { type: 'SpacedValue' }
            }
          },
          { type: 'Keyword', src: 'or' },
          {
            type: 'Block',
            delimiter: 'paren',
            value: {
              type: 'Operation',
              operator: ':',
              right: { type: 'SpacedValue' }
            }
          }
        ]
      }
    });
    expect(serialize(result.value).css).toBe(
      '@supports (box-shadow: 2px 2px 2px black) or (-moz-box-shadow: 2px 2px 2px black) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('constructs structural media and container query preludes, including Less variables', () => {
    const source =
      '@limit: 40rem; @media screen and (min-width: @limit), print { .card { color: red; } } @container (400px < width < @limit) { .card { color: blue; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
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
                type: 'SpacedValue',
                parts: [
                  { type: 'Keyword', src: 'screen' },
                  { type: 'Keyword', src: 'and' },
                  {
                    type: 'Block',
                    delimiter: 'paren',
                    value: {
                      type: 'Operation',
                      operator: ':',
                      right: { type: 'VariableReference', name: 'limit' }
                    }
                  }
                ]
              },
              { type: 'Keyword', src: 'print' }
            ]
          },
          rules: [{ type: 'Ruleset' }]
        },
        {
          type: 'AtRuleBlock',
          name: '@container',
          prelude: {
            type: 'Block',
            delimiter: 'paren',
            value: {
              type: 'Operation',
              operator: '<',
              right: { type: 'VariableReference', name: 'limit' }
            }
          },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@media screen and (min-width: 40rem), print {\n  .card {\n    color: red;\n  }\n}\n@container (400px < width < 40rem) {\n  .card {\n    color: blue;\n  }\n}\n'
    });
  });

  it('constructs a bare parenthesized media feature as a typed query node', () => {
    const source = '@media (tv) { .card { color: red; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'Block',
            delimiter: 'paren',
            value: { type: 'Keyword', src: 'tv' }
          },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@media (tv) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('folds a media feature <ratio> into one typed operation in every feature form', () => {
    const ratio = {
      type: 'Operation',
      operator: '/',
      left: { type: 'Dimension', src: '16' },
      right: { type: 'Dimension', src: '9' }
    };

    for (const [source, operator] of [
      ['@media (aspect-ratio: 16/9) { .card { color: red; } }', ':'],
      ['@media (aspect-ratio: 16 / 9) { .card { color: red; } }', ':'],
      ['@media (min-aspect-ratio: 16/9) { .card { color: red; } }', ':'],
      ['@container (aspect-ratio: 16/9) { .card { color: red; } }', ':'],

      /*
       * The comparison form used to take the value-position slash group and
       * reduce `16/9` to a SpacedValue instead of the ratio operation.
       */
      ['@media (aspect-ratio >= 16/9) { .card { color: red; } }', '>=']
    ] as const) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok && result.unconsumedFrom === null, source).toBe(true);
      expect(result.value, source).toMatchObject({
        rules: [
          {
            prelude: {
              type: 'Block',
              delimiter: 'paren',
              value: { type: 'Operation', operator, right: ratio }
            }
          }
        ]
      });
    }

    const range = run(
      lessGrammar.Document,
      '@media (16/9 < aspect-ratio < 2/1) { .card { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(range.ok && range.unconsumedFrom === null).toBe(true);
    expect(range.value).toMatchObject({
      rules: [
        {
          prelude: {
            type: 'Block',
            delimiter: 'paren',
            value: {
              type: 'Operation',
              operator: '<',
              left: {
                type: 'Operation',
                operator: '<',
                left: ratio,
                right: { type: 'Keyword', src: 'aspect-ratio' }
              },
              right: {
                type: 'Operation',
                operator: '/',
                left: { type: 'Dimension', src: '2' },
                right: { type: 'Dimension', src: '1' }
              }
            }
          }
        }
      ]
    });
    expect(serialize(stylesheet(range.value)).css).toBe(
      '@media (16 / 9 < aspect-ratio < 2 / 1) {\n  .card {\n    color: red;\n  }\n}\n'
    );

    /*
     * `style()` carries a declaration, so its slash stays a value-position
     * slash group rather than becoming a ratio operation.
     */
    const styleQuery = run(
      lessGrammar.Document,
      '@container style(--ratio: 16/9) { .card { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(styleQuery.ok && styleQuery.unconsumedFrom === null).toBe(true);
    expect(styleQuery.value).toMatchObject({
      rules: [
        {
          prelude: {
            type: 'FunctionCall',
            name: 'style',
            args: [
              {
                type: 'Operation',
                operator: ':',
                right: { type: 'SpacedValue' }
              }
            ]
          }
        }
      ]
    });
  });

  it('stores parenthesized colon features as typed values for later media interpolation', () => {
    const source =
      '@size: 640px; @tablet: (min-width: @size); @media @{tablet} { .card { color: red; } }';
    const feature = run(
      lessGrammar.QueryColonFeature,
      '(min-width: @size)',
      { trivia: lessGrammar.whitespace }
    );
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(feature).toMatchObject({ ok: true, span: { start: 0, end: 18 } });
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'size' },
        {
          type: 'VariableDeclaration',
          name: 'tablet',
          value: {
            type: 'Block',
            delimiter: 'paren',
            value: {
              type: 'Operation',
              operator: ':',
              left: { type: 'Keyword', src: 'min-width' },
              right: { type: 'VariableReference', name: 'size' }
            }
          }
        },
        { type: 'AtRuleBlock', name: '@media' }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@media (min-width: 640px) {\n  .card {\n    color: red;\n  }\n}\n'
    );

    const incoherent = run(
      lessGrammar.Document,
      '.card { value: (12px 13px); }',
      { trivia: lessGrammar.whitespace }
    );
    expect(incoherent.ok && incoherent.unconsumedFrom === null).toBe(false);
  });

  it('evaluates the upstream namespacing-media accessor as a whole media query term', () => {
    const source = `#ns {
  .sizes() { @small: 600px; }
  .breakpoint(@size) {
    @val: #ns.sizes[@@size];
    @min: (min-width: @val);
    @max: not all and @min;
  }
}
#ns { .sizes() { @small: 480px; } }
.valToGet() { keyword: small; }
@media #ns.breakpoint(.valToGet[])[@max] { .selector { prop: val; } }`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        /*
         * `#ns { … }` is an ordinary ID-selector ruleset which owns mixin
         * declarations; it is not itself a mixin declaration.
         */
        {
          type: 'Ruleset',
          selector: { selectors: [{ type: 'SimpleSelector', text: '#ns' }] },
          rules: [
            { type: 'MixinDefinition', name: '.sizes' },
            { type: 'MixinDefinition', name: '.breakpoint' }
          ]
        },
        {
          type: 'Ruleset',
          selector: { selectors: [{ type: 'SimpleSelector', text: '#ns' }] },
          rules: [{ type: 'MixinDefinition', name: '.sizes' }]
        },
        { type: 'MixinDefinition', name: '.valToGet' },
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'Reference',
            base: {
              type: 'MixinCall',
              name: '.breakpoint',
              path: [{ combinator: ' ', selector: '#ns' }]
            },
            steps: [
              {
                type: 'BracketLookup',
                keyKind: 'var',
                key: { type: 'VariableReference', name: 'max' }
              }
            ]
          }
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toBe(
      '@media not all and (min-width: 480px) {\n  .selector {\n    prop: val;\n  }\n}\n'
    );
  });

  it('constructs top-level negated media query conditions structurally', () => {
    const source =
      '@media not (width <= -100px) { body { background: green; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'SpacedValue',
            parts: [
              { type: 'Keyword', src: 'not' },
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Operation', operator: '<=' }
              }
            ]
          },
          rules: [{ type: 'Ruleset' }]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@media not (width <= -100px) {\n  body {\n    background: green;\n  }\n}\n'
    );
  });

  it('constructs nested negated container-query conditions structurally', () => {
    const source =
      '@container (width > 760px) and (not (height > 670px)) { .card { color: red; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@container',
          prelude: {
            type: 'SpacedValue',
            parts: [
              {
                type: 'Block',
                delimiter: 'paren',
                value: { type: 'Operation', operator: '>' }
              },
              { type: 'Keyword', src: 'and' },
              {
                type: 'Block',
                delimiter: 'paren',
                value: {
                  type: 'SpacedValue',
                  parts: [
                    { type: 'Keyword', src: 'not' },
                    {
                      type: 'Block',
                      delimiter: 'paren',
                      value: { type: 'Operation', operator: '>' }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@container (width > 760px) and (not (height > 670px)) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('constructs typed container style queries and permits them in shared conditional bodies', () => {
    const source =
      '@container card (inline-size > 30em) { @container style(--responsive: true) { .card { color: red; } } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'AtRuleBlock',
          name: '@container',
          rules: [
            {
              type: 'AtRuleBlock',
              name: '@container',
              prelude: {
                type: 'FunctionCall',
                name: 'style',
                args: [
                  {
                    type: 'Operation',
                    operator: ':',
                    left: { type: 'Keyword', src: '--responsive' },
                    right: { type: 'Keyword', src: 'true' }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@container card (inline-size > 30em) {\n  @container style(--responsive: true) {\n    .card {\n      color: red;\n    }\n  }\n}\n'
    );
  });

  it('constructs an interpolated Less container name with a structural condition', () => {
    const source =
      '@name: card; @limit: 30em; @container @{name} (inline-size > @limit) { .card { color: red; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'limit' },
        {
          type: 'AtRuleBlock',
          name: '@container',
          prelude: {
            type: 'SpacedValue',
            parts: [
              {
                type: 'Interpolation',
                parts: [
                  {
                    ref: { type: 'VariableReference', name: 'name' },
                    unquote: true
                  }
                ]
              },
              {
                type: 'Block',
                delimiter: 'paren',
                value: {
                  type: 'Operation',
                  operator: '>',
                  right: { type: 'VariableReference', name: 'limit' }
                }
              }
            ]
          }
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '@container card (inline-size > 30em) {\n  .card {\n    color: red;\n  }\n}\n'
    );
  });

  it('treats media-query prelude comments as trivia', () => {
    const result = run(
      lessGrammar.Document,
      '@media screen /* comment */, print /* another */ { body { font-size: 12pt; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@media screen, print {\n  body {\n    font-size: 12pt;\n  }\n}\n'
    });
  });

  it('rejects malformed or unmodelled media/container query preludes without generic at-rule fallback', () => {
    for (const source of [
      '@media only (min-width: 1px) { .card { color: red; } }',
      '@media screen and { .card { color: red; } }',
      '@container none (width > 10px) { .card { color: red; } }',
      '@container and (width > 10px) { .card { color: red; } }',
      '@container only screen { .card { color: red; } }',
      '@container selector(.card) { .card { color: red; } }'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(false);
    }
    for (const source of [
      '@media screen { .card { color: red; } }',
      '@container (width > 10px) { .card { color: red; } }'
    ]) {
      const generic = run(lessGrammar.AtRuleBlock, source, {
        trivia: lessGrammar.whitespace
      });
      expect(generic.ok && generic.unconsumedFrom === null, source).toBe(false);
    }
    const namedOnly = run(
      lessGrammar.Document,
      '@container only (width > 10px) { .card { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(
      namedOnly.ok
      && namedOnly.unconsumedFrom === null
      && isStylesheet(namedOnly.value)
    ).toBe(true);
    for (const source of [
      '@container screen { .card { color: red; } }',
      '@container only { .card { color: red; } }',
      '@container card (inline-size > 30em), style(--large: true) { .card { color: red; } }'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(true);
    }
  });

  it('constructs complete Less interpolation headers as typed media, supports, and keyframe preludes', () => {
    const source =
      '@query: screen; @condition: "(display: grid)"; @animation: fade; @media @{query} { .media { color: red; } } @supports @{condition} { .supports { display: grid; } } @keyframes @{animation} { from { opacity: 0; } }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'query' },
        { type: 'VariableDeclaration', name: 'condition' },
        { type: 'VariableDeclaration', name: 'animation' },
        {
          type: 'AtRuleBlock',
          name: '@media',
          prelude: {
            type: 'Interpolation',
            parts: [
              {
                ref: { type: 'VariableReference', name: 'query' },
                unquote: true
              }
            ]
          }
        },
        {
          type: 'AtRuleBlock',
          name: '@supports',
          prelude: {
            type: 'Interpolation',
            parts: [
              {
                ref: { type: 'VariableReference', name: 'condition' },
                unquote: true
              }
            ]
          }
        },
        {
          type: 'AtRuleBlock',
          name: '@keyframes',
          prelude: {
            type: 'Interpolation',
            parts: [
              {
                ref: { type: 'VariableReference', name: 'animation' },
                unquote: true
              }
            ]
          }
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '@media screen {\n  .media {\n    color: red;\n  }\n}\n@supports (display: grid) {\n  .supports {\n    display: grid;\n  }\n}\n@keyframes fade {\n  from {\n    opacity: 0;\n  }\n}\n'
    });
  });

  it('constructs static and interpolated general-enclosed supports content without a raw fallback', () => {
    const source =
      '@feature: kind; @supports selector(  .card-@{feature} /* keep */ :is(.a, .b) ) { .card { color: red; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'feature' },
        {
          type: 'AtRuleBlock',
          name: '@supports',
          prelude: {
            type: 'GeneralEnclosed',
            form: 'function',
            name: 'selector',
            content: {
              type: 'Interpolation',
              parts: [
                { lit: '  .card-' },
                {
                  ref: {
                    type: 'VariableReference',
                    name: 'feature',
                    lookup: 'scoped'
                  },
                  unquote: true
                },
                { lit: ' /* keep */ :is(.a, .b) ' }
              ]
            }
          }
        }
      ]
    });

    for (const source of [
      '@supports (font-tech(color-COLRv1)) { .card { color: red; } }',
      '@supports (@{feature}: grid) { .card { color: red; } }'
    ]) {
      const direct = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        source
      ).toBe(true);
    }
    for (const source of [
      '@supports selector(.card { .card { color: red; } }',
      '@supports selector([.card) { .card { color: red; } }',
      '@supports (display: grid), (color: red) { .card { color: red; } }'
    ]) {
      const direct = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        source
      ).toBe(false);
    }
    const genericSupports = run(
      lessGrammar.AtRuleBlock,
      '@supports (display: grid) { .card { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );
    expect(genericSupports.ok && genericSupports.unconsumedFrom === null).toBe(
      false
    );
  });

  it('constructs static mixin definitions and calls through canonical mixin nodes', () => {
    const source =
      '.space(@amount, @color: blue) { padding: @amount; color: @color; } .card { .space(2px, red); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.space',
          params: [
            { name: 'amount' },
            { name: 'color', default: { type: 'Color', src: 'blue' } }
          ],
          rules: [
            {
              type: 'Declaration',
              name: 'padding',
              value: { type: 'VariableReference', name: 'amount' }
            },
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'VariableReference', name: 'color' }
            }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.space',
              path: [],
              important: false,
              args: [
                {
                  value: {
                    type: 'Dimension',
                    number: 2,
                    unit: 'px',
                    src: '2px'
                  }
                },
                { value: { type: 'Color', src: 'red' } }
              ]
            }
          ]
        }
      ]
    });
  });

  it('chooses a Less mixin continuation after one shared closing parenthesis', () => {
    const source = [
      '.empty() { color: red; }',
      '.guarded(@value) when (@value > 0) { width: @value; }',
      '.use { .empty(); .guarded(1) !important; }'
    ].join(' ');
    const cst = parseLessCst(source);
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(findCstNodes(cst.tree, 'MixinDefinition')).toHaveLength(2);
    expect(findCstNodes(cst.tree, 'MixinCall')).toHaveLength(2);
    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.empty', params: [] },
        { type: 'MixinDefinition', name: '.guarded', params: [{ name: 'value' }] },
        { type: 'Ruleset', rules: [
          { type: 'MixinCall', name: '.empty', args: [], important: false },
          { type: 'MixinCall', name: '.guarded', important: true }
        ] }
      ]
    });

    for (const invalid of [
      '.broken() when;',
      '.broken(@value) when (@value > 0);'
    ]) {
      expect(parsesCompleteStylesheet(invalid), invalid).toBe(false);
    }
  });

  it('parses multiline svg-gradient values inside a mixin definition directly', () => {
    const source =
      '.gradient-mixin(@color) {\n  background: svg-gradient(to bottom,\n    fade(@color, 0%) 0%,\n    fade(@color, 5%) 60%\n  );\n}';
    for (const candidate of [
      '.gradient-mixin(@color) { background: red; }',
      '.gradient-mixin(@color) { background: svg-gradient(red); }',
      '.gradient-mixin(@color) { background: svg-gradient(to bottom); }',
      '.gradient-mixin(@color) { background: svg-gradient(to bottom, fade(@color, 0%)); }',
      '.gradient-mixin(@color) { background: svg-gradient(to bottom, fade(@color, 0%) 0%); }',
      source
    ]) {
      const result = run(lessGrammar.Document, candidate, {
        trivia: lessGrammar.whitespace
      });
      expect(result.ok, candidate).toBe(true);
      expect(result.unconsumedFrom, candidate).toBeNull();
    }
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.gradient-mixin',
          params: [{ name: 'color' }],
          rules: [
            {
              type: 'Declaration',
              name: 'background',
              value: { type: 'FunctionCall', name: 'svg-gradient' }
            }
          ]
        }
      ]
    });
  });

  it('keeps CSS-escaped mixin names as direct canonical calls', () => {
    const source = '.mixin\\!tUp() { color: red; } .card { .mixin\\!tUp(); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.mixin\\!tUp' },
        {
          type: 'Ruleset',
          rules: [
            { type: 'MixinCall', name: '.mixin\\!tUp', path: [], args: [] }
          ]
        }
      ]
    });
  });

  it('accepts an optional statement terminator after a Less mixin definition', () => {
    const source = '.wrap(@value) { color: @value; }; .card { .wrap(red); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.wrap', params: [{ name: 'value' }] },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.wrap',
              args: [{ value: { type: 'Color', src: 'red' } }]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.card {\n  color: red;\n}\n'
    );
  });

  it('parses plugin-preeval shape as plugin plus block-argument mixin facts', () => {
    const source =
      '@plugin "../../plugin/plugin-preeval"; .two(@rules: {}) { :root.two & { @rules(); } } .one { .two({ --foo: @replace !important; }); } @stop: end;';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cstIssueCount(cst)).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Plugin',
          target: {
            type: 'Quoted',
            value: '../../plugin/plugin-preeval'
          }
        },
        {
          type: 'MixinDefinition',
          name: '.two',
          params: [
            {
              name: 'rules',
              default: { type: 'AnonymousMixin', rules: [] }
            }
          ],
          rules: [
            {
              type: 'Ruleset',
              rules: [
                {
                  type: 'Reference',
                  base: {
                    type: 'VariableReference',
                    name: 'rules',
                    lookup: 'scoped'
                  },
                  steps: [{ type: 'Call', args: [] }]
                }
              ]
            }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.two',
              args: [
                {
                  value: {
                    type: 'AnonymousMixin',
                    rules: [
                      {
                        type: 'Declaration',
                        name: '--foo',
                        value: {
                          type: 'Interpolation',
                          parts: [
                            {
                              ref: {
                                type: 'VariableReference',
                                name: 'replace',
                                lookup: 'scoped'
                              }
                            }
                          ]
                        },
                        important: true
                      }
                    ]
                  }
                }
              ]
            }
          ]
        },
        {
          type: 'VariableDeclaration',
          name: 'stop',
          value: { type: 'Keyword', src: 'end' }
        }
      ]
    });
  });

  it('constructs semicolon-separated mixin parameters with detached-ruleset defaults', () => {
    const result = run(
      lessGrammar.Document,
      '.configure(@a: {}; @b: { default: works; };) { @a(); @b(); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.configure',
          params: [
            { name: 'a', default: { type: 'AnonymousMixin', rules: [] } },
            {
              name: 'b',
              default: {
                type: 'AnonymousMixin',
                rules: [{ type: 'Declaration', name: 'default' }]
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs semicolon-separated detached-ruleset mixin arguments', () => {
    const result = run(
      lessGrammar.Document,
      '.configure(@a; @b) {} .card { .configure({ direct: works; }; @b: { named: works; }); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              args: [
                {
                  value: {
                    type: 'AnonymousMixin',
                    rules: [{ type: 'Declaration', name: 'direct' }]
                  }
                },
                {
                  name: 'b',
                  value: {
                    type: 'AnonymousMixin',
                    rules: [{ type: 'Declaration', name: 'named' }]
                  }
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it('keeps a single semicolon-terminated mixin argument on the semicolon branch', () => {
    const result = run(
      lessGrammar.Document,
      '.tone(@color) {} .card { .tone(red;); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.tone',
              args: [{ value: { type: 'Color', src: 'red' } }]
            }
          ]
        }
      ]
    });
  });

  it('groups comma runs into list-valued arguments when semicolons separate Less mixin arguments', () => {
    const result = run(
      lessGrammar.Document,
      '.generic(@left; @right) { left: @left; right: @right; } .out { .generic(a, b, c; a, b, c); }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.generic',
              args: [
                {
                  value: {
                    type: 'List',
                    sep: ',',
                    value: [
                      { type: 'Keyword', src: 'a' },
                      { type: 'Keyword', src: 'b' },
                      { type: 'Keyword', src: 'c' }
                    ]
                  }
                },
                {
                  value: {
                    type: 'List',
                    sep: ',',
                    value: [
                      { type: 'Keyword', src: 'a' },
                      { type: 'Keyword', src: 'b' },
                      { type: 'Keyword', src: 'c' }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.out {\n  left: a, b, c;\n  right: a, b, c;\n}\n'
    );
  });

  it('keeps recursive value slots inside semicolon-terminated mixin argument groups', () => {
    const source = [
      '.multi-bg(@bgs...) { background: @bgs; }',
      '.hero {',
      '  .multi-bg(linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url("/images/hero.jpg") center/cover no-repeat);',
      '}'
    ].join('\n');
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.multi-bg',
              args: [
                { value: { type: 'FunctionCall', name: 'linear-gradient' } },
                {
                  value: [
                    { type: 'Url' },
                    { type: 'SpacedValue' },
                    { type: 'Keyword', src: 'no-repeat' }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.hero {\n  background: linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3)) url("/images/hero.jpg") center/cover no-repeat;\n}\n'
    );
  });

  it('constructs public literal-pattern and variadic mixin parameters directly', () => {
    const source =
      '.badge(red, @gap, @rest...) { padding: @gap; } .card { .badge(red, 2px, 4px); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.badge',
          params: [
            { pattern: { type: 'Color', src: 'red' } },
            { name: 'gap' },
            { name: 'rest', rest: true }
          ]
        },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.badge',
              path: [],
              important: false,
              args: [
                { value: { type: 'Color', src: 'red' } },
                {
                  value: {
                    type: 'Dimension',
                    number: 2,
                    unit: 'px',
                    src: '2px'
                  }
                },
                {
                  value: {
                    type: 'Dimension',
                    number: 4,
                    unit: 'px',
                    src: '4px'
                  }
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it('constructs a Less mixin argument expansion through the existing spread field', () => {
    const source =
      '.pair(@a, @b) { first: @a; second: @b; } @args: one, two; .card { .pair(@args...); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'MixinDefinition', name: '.pair' },
        { type: 'VariableDeclaration', name: 'args' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.pair',
              args: [
                {
                  value: {
                    type: 'VariableReference',
                    name: 'args',
                    lookup: 'scoped'
                  },
                  spread: true
                }
              ]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.card {\n  first: one;\n  second: two;\n}\n'
    );
  });

  it('constructs static namespaced mixin calls through the existing path contract', () => {
    const source = '.card { .library > .colors .tone(red); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.tone',
              important: false,
              path: [
                { combinator: ' ', selector: '.library' },
                { combinator: '>', selector: '.colors' }
              ],
              args: [{ value: { type: 'Color', src: 'red' } }]
            }
          ]
        }
      ]
    });
  });

  it('keeps nested callable mixin arguments as MixinCall facts, not value-shaped source recovery', () => {
    const source = '.wrapper(.something(foo)); .wrapper(.output-height());';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinCall',
          name: '.wrapper',
          args: [
            {
              value: {
                type: 'MixinCall',
                name: '.something',
                args: [{ value: { type: 'Keyword', src: 'foo' } }]
              }
            }
          ]
        },
        {
          type: 'MixinCall',
          name: '.wrapper',
          args: [
            { value: { type: 'MixinCall', name: '.output-height', args: [] } }
          ]
        }
      ]
    });

    const arithmetic = run(
      lessGrammar.Document,
      '.wrapper(.something(foo) + 1);',
      { trivia: lessGrammar.whitespace }
    );
    expect(arithmetic.ok && arithmetic.unconsumedFrom === null).toBe(false);

    const lexical = run(
      lessGrammar.Document,
      '@caller: 10px; .wrapper(@m) { @m(); } .something(@value) { width: @value; } .output-height() { height: 10px; } .x { .wrapper(.something(@caller)); .wrapper(.output-height()); }',
      { trivia: lessGrammar.whitespace }
    );
    expect(lexical.ok).toBe(true);
    expect(serialize(stylesheet(lexical.value)).css).toBe(
      '.x {\n  width: 10px;\n  height: 10px;\n}\n'
    );
  });

  it('constructs static namespace/map reads as References over the existing MixinCall path base', () => {
    const source =
      '.out { a: #ns1[foo]; b: #ns1.vars[$sub]; c: #DEF.colors[primary]; d: #library.add-one(1px)[@return]; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'a',
              value: {
                type: 'Reference',
                base: { type: 'MixinCall', name: '#ns1', path: [], args: [] },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'prop',
                    key: { type: 'Keyword', src: 'foo' }
                  }
                ],
                raw: '#ns1[foo]'
              }
            },
            {
              type: 'Declaration',
              name: 'b',
              value: {
                type: 'Reference',
                base: {
                  type: 'MixinCall',
                  name: '.vars',
                  path: [{ combinator: ' ', selector: '#ns1' }],
                  args: []
                },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'prop',
                    key: { type: 'PropertyReference', name: 'sub' }
                  }
                ],
                raw: '#ns1 .vars[$sub]'
              }
            },
            {
              type: 'Declaration',
              name: 'c',
              value: {
                type: 'Reference',
                base: {
                  type: 'MixinCall',
                  name: '.colors',
                  path: [{ combinator: ' ', selector: '#DEF' }],
                  args: []
                },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'prop',
                    key: { type: 'Keyword', src: 'primary' }
                  }
                ],
                raw: '#DEF .colors[primary]'
              }
            },
            {
              type: 'Declaration',
              name: 'd',
              value: {
                type: 'Reference',
                base: {
                  type: 'MixinCall',
                  name: '.add-one',
                  path: [{ combinator: ' ', selector: '#library' }],
                  args: [{ value: { type: 'Dimension', src: '1px' } }]
                },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'var',
                    key: { type: 'VariableReference', name: 'return' }
                  }
                ],
                raw: '#library .add-one(1px)[@return]'
              }
            }
          ]
        }
      ]
    });
  });

  it('folds mixed namespace call, lookup, member, and call continuations into one direct Reference', () => {
    const source = `
#library {
  .seed() { @next: .inner(); }
  .inner(@n) { answer: @n; }
}
.out { value: #library.seed()[@next](42)[answer]; member: @theme[key].next(1); }
`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {},
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
                  name: '.seed',
                  path: [{ combinator: ' ', selector: '#library' }],
                  args: []
                },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'var',
                    key: {
                      type: 'VariableReference',
                      name: 'next',
                      lookup: 'scoped'
                    }
                  },
                  {
                    type: 'Call',
                    args: [{ value: { type: 'Dimension', src: '42' } }]
                  },
                  {
                    type: 'BracketLookup',
                    keyKind: 'prop',
                    key: { type: 'Keyword', src: 'answer' }
                  }
                ],
                raw: '#library .seed()[@next](42)[answer]'
              }
            },
            {
              type: 'Declaration',
              name: 'member',
              value: {
                type: 'Reference',
                base: {
                  type: 'VariableReference',
                  name: 'theme',
                  lookup: 'scoped'
                },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'prop',
                    key: { type: 'Keyword', src: 'key' }
                  },
                  { type: 'DotLookup', name: 'next' },
                  {
                    type: 'Call',
                    args: [{ value: { type: 'Dimension', src: '1' } }]
                  }
                ],
                raw: '@theme[key].next(1)'
              }
            }
          ]
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain('value: 42;');
  });

  it('constructs $@variable namespace property keys without flattening their indirection', () => {
    const result = run(
      lessGrammar.Document,
      '@prop-name: my-prop; #namespace { my-prop: prop-value; } .test { value: #namespace[$@prop-name]; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {},
        {},
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
                  name: '#namespace',
                  path: [],
                  args: []
                },
                steps: [
                  {
                    type: 'BracketLookup',
                    keyKind: 'prop',
                    key: {
                      type: 'VariableReference',
                      name: 'prop-name',
                      lookup: 'scoped'
                    }
                  }
                ],
                raw: '#namespace[$@prop-name]'
              }
            }
          ]
        }
      ]
    });
  });

  it('keeps a namespaced mixin map value and its call-level important flag typed', () => {
    const result = run(
      lessGrammar.Document,
      '@theme-colors: #theme.dark.navbar.colors() !important;',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'VariableDeclaration',
          name: 'theme-colors',
          value: {
            type: 'MixinCall',
            name: '.colors',
            args: [],
            important: true,
            path: [
              { combinator: ' ', selector: '#theme' },
              { combinator: ' ', selector: '.dark' },
              { combinator: ' ', selector: '.navbar' }
            ]
          }
        }
      ]
    });
  });

  it('constructs bracket-accessed namespace values as arithmetic operands', () => {
    const source = `
#ns { .options() { val1: 10px; } }
@ns: { @options: { val2: 20px; } }
.foo { val: #ns.options[val1] + @ns[@options][val2] + 5px; }
`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {},
        {},
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'val',
              value: {
                type: 'Operation',
                operator: '+',
                left: {
                  type: 'Operation',
                  operator: '+',
                  left: {
                    type: 'Reference',
                    base: {
                      type: 'MixinCall',
                      name: '.options',
                      path: [{ combinator: ' ', selector: '#ns' }],
                      args: []
                    },
                    steps: [
                      {
                        type: 'BracketLookup',
                        keyKind: 'prop',
                        key: { type: 'Keyword', src: 'val1' }
                      }
                    ]
                  },
                  right: {
                    type: 'Reference',
                    base: {
                      type: 'VariableReference',
                      name: 'ns',
                      lookup: 'scoped'
                    },
                    steps: [
                      {
                        type: 'BracketLookup',
                        keyKind: 'var',
                        key: {
                          type: 'VariableReference',
                          name: 'options',
                          lookup: 'scoped'
                        }
                      },
                      {
                        type: 'BracketLookup',
                        keyKind: 'prop',
                        key: { type: 'Keyword', src: 'val2' }
                      }
                    ]
                  }
                },
                right: { type: 'Dimension', src: '5px' }
              }
            }
          ]
        }
      ]
    });
  });

  it('evaluates bracket variable members from every applicable implicit and explicit mixin call result', () => {
    const source = `
#library { .implicit() { @return: red; } .explicit(@x) { @return: 1px; } }
#library { .implicit() { @return: blue; } .explicit(@x) { @return: 2px; } }
.out { implicit: #library.implicit[@return]; explicit: #library.explicit(1px)[@return]; }
`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain(
      '.out {\n  implicit: blue;\n  explicit: 2px;\n}'
    );
  });

  it('resolves direct `[@key]` members in the aggregated mixin-call result frame, not the caller frame', () => {
    const source = `
#library { .m() { @key: first; @return: first-return; } }
#library { .m() { @key: callee; @return: callee-return; } }
@key: return;
.out { ordinary: #library.m()[@key]; returned: #library.m()[@return]; }
`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }

    /*
     * Upstream namespacing-1/2 fixtures establish that `[@name]` selects that
     * named variable member (`[@foo]`, `[@return]`). `[@@name]` is the distinct
     * indirection form, covered separately by namespacing-2 and not widened here.
     */
    expect(serialize(result.value).css).toContain(
      '.out {\n  ordinary: callee;\n  returned: callee-return;\n}'
    );
  });

  it('classifies variable-only value blocks as Collections and reads their typed members', () => {
    /*
     * Upstream tests-config/namespacing/namespacing-1.less: the map declaration
     * follows its reads, and `@@varToGet` selects the `@default-color` member.
     */
    const source = `
@varToGet: default-color;
.out { @defaults(); direct: @defaults[@default-color]; nested: @defaults[@nested][@color]; indirect: @defaults[@@varToGet]; }
@defaults: { @default-color: red; @nested: { @color: yellow; }; };
`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(result.value.rules[2]).toMatchObject({
      type: 'VariableDeclaration',
      name: 'defaults',
      value: {
        type: 'Collection',
        entries: [
          {
            type: 'CollectionEntry',
            key: { type: 'Keyword', src: 'default-color' }
          },
          {
            type: 'CollectionEntry',
            key: { type: 'Keyword', src: 'nested' },
            value: {
              type: 'Collection',
              entries: [
                {
                  type: 'CollectionEntry',
                  key: { type: 'Keyword', src: 'color' }
                }
              ]
            }
          }
        ]
      }
    });
    const outputRule = result.value.rules[1];
    expect(outputRule).toMatchObject({ type: 'Ruleset' });
    if (outputRule?.type !== 'Ruleset') {
      throw new TypeError('expected output rule');
    }
    expect(outputRule.rules[0]).toMatchObject({
      type: 'Reference',
      base: { type: 'VariableReference', name: 'defaults', lookup: 'scoped' },
      steps: [{ type: 'Call', args: [] }],
      raw: '@defaults()'
    });
    expect(serialize(result.value).css).toContain(
      '.out {\n  direct: red;\n  nested: yellow;\n  indirect: red;\n}'
    );
  });

  it('reads `$name` as a property member on an aggregated static namespace call result', () => {
    /*
     * Upstream tests-config/namespacing/namespacing-1.less: #ns1.vars[$sub]
     * selects `sub:` from every applicable `.vars()` result; the last wins.
     */
    const source = `
#ns1 { .vars() { sub: value; } }
#ns1 { .vars() { sub: tres; } }
.out { sub: #ns1.vars[$sub]; }
`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value).css).toContain('.out {\n  sub: tres;\n}');
  });

  it('constructs semicolon-terminated parenthesis-free mixin calls through the existing path contract', () => {
    const source =
      '#theme { .mixin() { color: red; } } .card { #theme > .mixin; } .important { #theme > .mixin !important; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
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

    for (const invalid of ['.card { #theme > .mixin }']) {
      const direct = run(lessGrammar.Document, invalid, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        invalid
      ).toBe(false);
    }
  });

  it('constructs the public call-level !important mixin override directly', () => {
    const source = '.card { .space(2px) !important; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.space',
              path: [],
              important: true,
              args: [
                {
                  value: {
                    type: 'Dimension',
                    number: 2,
                    unit: 'px',
                    src: '2px'
                  }
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it('constructs ordered named arguments for static and namespaced mixin calls directly', () => {
    const source =
      '.card { .library > .colors .tone(@shade: red, @gap: 2px); }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'MixinCall',
              name: '.tone',
              important: false,
              path: [
                { combinator: ' ', selector: '.library' },
                { combinator: '>', selector: '.colors' }
              ],
              args: [
                { name: 'shade', value: { type: 'Color', src: 'red' } },
                {
                  name: 'gap',
                  value: {
                    type: 'Dimension',
                    number: 2,
                    unit: 'px',
                    src: '2px'
                  }
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it('constructs truthful static mixin comparison and truth guards directly', () => {
    const source =
      '.wide(@width) when (@width >= 20px) { width: @width; } .enabled() when (true) { display: block; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.wide',
          guard: {
            g: 'cmp',
            op: '>=',
            left: { type: 'VariableReference', name: 'width' },
            right: { type: 'Dimension', number: 20, unit: 'px', src: '20px' }
          }
        },
        {
          type: 'MixinDefinition',
          name: '.enabled',
          guard: { g: 'truth', value: { type: 'Keyword', src: 'true' } }
        }
      ]
    });
  });

  it('enforces Less when guard comparison grouping', () => {
    const accepts = [
      '.match() when (1 = 1) { color: green; }',
      '.match() when not (1 = 1) { color: green; }',
      '.match() when (1 = 1) and (2 = 2) { color: green; }'
    ];
    const rejects = [
      '.match() when 1 = 1 { color: red; }',
      '.match() when true { color: red; }',
      '.match(@is-true) when @is-true { color: red; }'
    ];

    for (const source of accepts) {
      expect(parsesCompleteStylesheet(source), source).toBe(true);
    }
    for (const source of rejects) {
      expect(parsesCompleteStylesheet(source), source).toBe(false);
    }
  });

  it('routes the namespacing-7 accessor guards through existing typed References', () => {
    const source = `#ns {
  .options() { option: true; }
}
@ns: { @options: { option: true; }; };
& when (#ns.options[option]) { .output { a: b; } }
& when (#ns.options[option] = true) { .output-2 { c: d; } }
& when (#ns.options[option] = false) { .no-reach { c: d; } }
& when (@ns[@options][option]) { .dr { a: b; } }
& when (@ns[@options][option] = true) { .dr-2 { c: d; } }
& when (@ns[@options][option] = false) { .dr-no-reach { c: d; } }`;
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    const children = stylesheet(result.value).rules;
    expect([children[2], children[3], children[7]]).toMatchObject([
      {
        type: 'Ruleset',
        guard: {
          g: 'truth',
          value: {
            type: 'Reference',
            base: {
              type: 'MixinCall',
              name: '.options',
              path: [{ combinator: ' ', selector: '#ns' }],
              args: []
            },
            steps: [
              {
                type: 'BracketLookup',
                keyKind: 'prop',
                key: { type: 'Keyword', src: 'option' }
              }
            ],
            raw: '#ns .options[option]'
          }
        }
      },
      {
        type: 'Ruleset',
        guard: {
          g: 'cmp',
          op: '=',
          left: {
            type: 'Reference',
            base: {
              type: 'MixinCall',
              name: '.options',
              path: [{ combinator: ' ', selector: '#ns' }],
              args: []
            },
            steps: [
              {
                type: 'BracketLookup',
                keyKind: 'prop',
                key: { type: 'Keyword', src: 'option' }
              }
            ],
            raw: '#ns .options[option]'
          },
          right: { type: 'Keyword', src: 'true' }
        }
      },
      {
        type: 'Ruleset',
        guard: {
          g: 'cmp',
          op: '=',
          left: {
            type: 'Reference',
            base: {
              type: 'VariableReference',
              name: 'ns',
              lookup: 'scoped'
            },
            steps: [
              {
                type: 'BracketLookup',
                keyKind: 'var',
                key: {
                  type: 'VariableReference',
                  name: 'options',
                  lookup: 'scoped'
                }
              },
              {
                type: 'BracketLookup',
                keyKind: 'prop',
                key: { type: 'Keyword', src: 'option' }
              }
            ],
            raw: '@ns[@options][option]'
          },
          right: { type: 'Keyword', src: 'false' }
        }
      }
    ]);
  });

  it('constructs quoted Less mixin guard operands as existing typed values', () => {
    const source =
      '.match(@value) when (@value = "ok") { color: green; } .yes { .match("ok"); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({ type: 'Stylesheet' });
    expect(stylesheet(result.value).rules[0]).toMatchObject({
      type: 'MixinDefinition',
      name: '.match',
      guard: {
        g: 'cmp',
        op: '=',
        left: { type: 'VariableReference', name: 'value', lookup: 'scoped' },
        right: {
          type: 'Quoted',
          src: '"ok"',
          value: 'ok',
          quote: '"',
          escaped: false
        }
      }
    });
  });

  it('constructs static logical, negated, default, and type-call mixin guards directly', () => {
    const source =
      '.match(@value) when (not (@value < 2) and iscolor(red), default()) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.match',
          guard: {
            g: 'or',
            left: {
              g: 'and',
              left: {
                g: 'not',
                inner: {
                  g: 'cmp',
                  op: '<',
                  left: { type: 'VariableReference', name: 'value' },
                  right: { type: 'Dimension', number: 2, unit: '', src: '2' }
                }
              },
              right: {
                g: 'call',
                name: 'iscolor',
                args: [{ type: 'Color', src: 'red' }]
              }
            },
            right: { g: 'default' }
          }
        }
      ]
    });
  });

  it('constructs default() as the typed comparison operand used by mixin dispatch', () => {
    const source =
      '.fallback(@value) when (@value = default()) { color: red; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'MixinDefinition',
          name: '.fallback',
          guard: {
            g: 'cmp',
            op: '=',
            left: {
              type: 'VariableReference',
              name: 'value',
              lookup: 'scoped'
            },
            right: { type: 'FunctionCall', name: 'default', args: [] }
          }
        }
      ]
    });
  });

  it('requires default() rather than widening the dispatch guard to a bare keyword', () => {
    const source = '.fallback() when default { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    /*
     * The public CST route is now the direct hostMode grammar too: it must not
     * accept the widened spelling or manufacture the `{ g: "default" }`
     * sentinel unless the source actually contains Less `default()`.
     */
    expect(cstIssueCount(cst)).toBeGreaterThan(0);
    expect(
      result.ok && result.unconsumedFrom === null && isStylesheet(result.value)
    ).toBe(false);
  });

  it('rejects URL control characters that have no valid URL-token representation', () => {
    for (const source of ['background: url(foo\u0007bar);']) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });

      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value)
      ).toBe(false);
      expect(result.ok ? result.unconsumedFrom : result.errors).not.toBeNull();
    }
  });

  it('constructs wrapped unquoted data URLs without widening ordinary URL text', () => {
    const source =
      '.asset { data: url(data:image/png;charset=utf-8;base64,\n  kiVBORw0K\n  k//+l2Z/dA==); escaped: url(http://example.test/a\\(b\\)); plain: url( icons/a.svg ); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'data',
              value: {
                type: 'Url',
                value: {
                  type: 'Any',
                  src: 'data:image/png;charset=utf-8;base64,\n  kiVBORw0K\n  k//+l2Z/dA=='
                }
              }
            },
            {
              type: 'Declaration',
              name: 'escaped',
              value: {
                type: 'Url',
                value: { type: 'Any', src: 'http://example.test/a\\(b\\)' }
              }
            },
            {
              type: 'Declaration',
              name: 'plain',
              value: {
                type: 'Url',
                value: { type: 'Any', src: 'icons/a.svg' }
              }
            }
          ]
        }
      ]
    });

    for (const invalid of [
      '.asset { value: url(foo bar); }',
      '.asset { value: url(foo\nbar); }'
    ]) {
      const rejected = run(lessGrammar.Document, invalid, {
        trivia: lessGrammar.whitespace
      });
      expect(
        rejected.ok
        && rejected.unconsumedFrom === null
        && isStylesheet(rejected.value)
      ).toBe(false);
    }
  });

  it('routes glued identifier functions without stealing spaced parens or ident interpolation', () => {
    const source =
      '.x { glued: foo(1); spaced: foo (1); dyn: foo-@{tone}; asset: URL(@asset); math: CALC(100% - 1px); }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'glued',
              value: {
                type: 'FunctionCall',
                name: 'foo',
                args: [{ type: 'Dimension', src: '1' }]
              }
            },
            {
              type: 'Declaration',
              name: 'spaced',
              value: [
                { type: 'Keyword', src: 'foo' },
                {
                  type: 'Block',
                  delimiter: 'paren',
                  value: { type: 'Dimension', src: '1' }
                }
              ]
            },
            {
              type: 'Declaration',
              name: 'dyn',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: 'foo-' },
                  { ref: { type: 'VariableReference', name: 'tone' } }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'asset',
              value: {
                type: 'Url',
                value: { type: 'VariableReference', name: 'asset' }
              }
            },
            {
              type: 'Declaration',
              name: 'math',
              value: {
                type: 'FunctionCall',
                name: 'CALC',
                args: [{ type: 'Operation', operator: '-' }]
              }
            }
          ]
        }
      ]
    });
  });

  it('retains outer list separators, accepts newline function separators, and keeps boundary comments as trivia', () => {
    const listResult = run(
      lessGrammar.Document,
      'shadow: 0,\n  1px;',
      { trivia: lessGrammar.whitespace }
    );
    expect(listResult.ok).toBe(true);
    expect(listResult.unconsumedFrom).toBeNull();
    expect(isStylesheet(listResult.value)).toBe(true);
    expect(bare(listResult.value.rules[0])).toEqual({
      type: 'Declaration',
      name: 'shadow',
      merge: null,
      important: false,
      value: {
        type: 'List',
        sep: ',',
        value: [
          { type: 'Dimension', number: 0, unit: '', src: '0' },
          { type: 'Dimension', number: 1, unit: 'px', src: '1px' }
        ]
      }
    });

    for (const source of ['shadow: rgb(1,\n2);']) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value)
      ).toBe(true);
      expect(result.value).toMatchObject({
        type: 'Stylesheet',
        rules: [
          {
            type: 'Declaration',
            value: {
              type: 'FunctionCall',
              args: [
                { type: 'Dimension', src: '1' },
                { type: 'Dimension', src: '2' }
              ]
            }
          }
        ]
      });
    }

    const source = 'shadow: rgb(1, /* note */ 2);';
    const commented = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });
    expect(commented.ok).toBe(true);
    expect(commented.unconsumedFrom).toBeNull();
    expect(commented.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Declaration',
          value: {
            type: 'FunctionCall',
            args: [
              { type: 'Dimension', src: '1' },
              { type: 'Dimension', src: '2' }
            ]
          }
        }
      ]
    });
  });

  it('keeps escaped and legacy-hack spelling confined to declaration names and CSS-escaped mixins', () => {
    const accepts = run(
      lessGrammar.Document,
      '@base: red; -theme: blue; @import "plain.less";',
      { trivia: lessGrammar.whitespace }
    );
    expect(
      accepts.ok
      && accepts.unconsumedFrom === null
      && isStylesheet(accepts.value)
    ).toBe(true);

    for (const source of ['*color: red;', '\\63 olor: red;']) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value)
      ).toBe(true);
    }

    for (const source of [
      /*
       * The declaration-name terminal must not become a value/variable escape
       * route, and malformed declaration escapes stay out.
       */
      'color: r\\65 d;',
      '@\\63 olor: red;',
      '\\\ncolor: red;',
      '*\\\ncolor: red;'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value)
      ).toBe(false);
    }

    const escapedMixin = run(
      lessGrammar.Document,
      '.\\63 lass() { color: red; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(
      escapedMixin.ok
      && escapedMixin.unconsumedFrom === null
      && isStylesheet(escapedMixin.value)
    ).toBe(true);
  });

  it('constructs structural Less interpolation in values, quoted strings, and property names without source reparse', () => {
    const source =
      '.x { content: "pre-@{theme}-${tone}"; color: @{map[key]}; fallback: ${tone}; mixed: pre-@{theme}-${tone}; pre-@{theme}-${tone}: @{theme}; --theme-@{theme}-${tone}: "x"; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'content',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: '"pre-' },
                  {
                    ref: { type: 'VariableReference', name: 'theme' },
                    unquote: true
                  },
                  { lit: '-' },
                  {
                    ref: {
                      type: 'PropertyReference',
                      name: 'tone',
                      raw: '$tone'
                    },
                    unquote: true
                  },
                  { lit: '"' }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'color',
              value: {
                type: 'Interpolation',
                parts: [
                  {
                    ref: {
                      type: 'Reference',
                      base: {
                        type: 'VariableReference',
                        name: 'map',
                        lookup: 'scoped'
                      },
                      steps: [
                        {
                          type: 'BracketLookup',
                          key: { type: 'Keyword', src: 'key' },
                          keyKind: 'prop'
                        }
                      ],
                      raw: '@map[key]'
                    },
                    unquote: true
                  }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'fallback',
              value: {
                type: 'Interpolation',
                parts: [
                  {
                    ref: {
                      type: 'PropertyReference',
                      name: 'tone',
                      raw: '$tone'
                    },
                    unquote: true
                  }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'mixed',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: 'pre-' },
                  {
                    ref: { type: 'VariableReference', name: 'theme' },
                    unquote: true
                  },
                  { lit: '-' },
                  {
                    ref: {
                      type: 'PropertyReference',
                      name: 'tone',
                      raw: '$tone'
                    },
                    unquote: true
                  }
                ]
              }
            },
            {
              type: 'Declaration',
              name: { type: 'Interpolation' },
              value: { type: 'Interpolation' }
            },
            {
              type: 'Declaration',
              name: { type: 'Interpolation' },
              value: { type: 'Any', src: '"x"' }
            }
          ]
        }
      ]
    });
  });

  it('constructs custom-property values from balanced grammar parts and accepts a terminal declaration without a semicolon', () => {
    const source =
      '@name: accent; .x { --theme: pre-@{name}-post (@{map[key]}) [@{index}] { @{nested} }; --literal: @name; color: red }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
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
                    ref: { type: 'VariableReference', name: 'name' },
                    unquote: true
                  },
                  { lit: '-post (' },
                  { ref: { type: 'Reference' }, unquote: true },
                  { lit: ') [' },
                  {
                    ref: { type: 'VariableReference', name: 'index' },
                    unquote: true
                  },
                  { lit: '] { ' },
                  {
                    ref: { type: 'VariableReference', name: 'nested' },
                    unquote: true
                  },
                  { lit: ' }' }
                ]
              }
            },
            {
              type: 'Declaration',
              name: '--literal',
              value: {
                type: 'Interpolation',
                parts: [
                  {
                    ref: { type: 'VariableReference', name: 'name', lookup: 'scoped' },
                    unquote: false
                  }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: 'red' }
            }
          ]
        }
      ]
    });
  });

  it('strips a trailing custom-property priority marker into the declaration flag', () => {
    /*
     * css-syntax-3 §5.5.6 removes a trailing `!important` and sets the priority
     * flag before the custom-property original-text step, so the preserved value
     * excludes the marker *and* the whitespace in front of it. css-variables-1
     * §2.1 confirms the `<declaration-value>` top-level `!` ban does not apply.
     * Less matches CSS here: a custom property is CSS declaration-value text.
     */
    const source =
      '@n: accent; .x { --a: red !important; --b: red    !important; --c: red!important; --d: red ! important; --e: red !IMPORTANT; --f: red ! /*c*/ important; --g: !important; --h: @{n} !important; --@{n}: red !important; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'n' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: '--a',
              value: { type: 'Any', src: 'red' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--b',
              value: { type: 'Any', src: 'red' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--c',
              value: { type: 'Any', src: 'red' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--d',
              value: { type: 'Any', src: 'red' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--e',
              value: { type: 'Any', src: 'red' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--f',
              value: { type: 'Any', src: 'red' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--g',
              value: { type: 'Any', src: '' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--h',
              value: {
                type: 'Interpolation',
                parts: [
                  {
                    ref: { type: 'VariableReference', name: 'n' },
                    unquote: true
                  }
                ]
              },
              important: true
            },
            {
              type: 'Declaration',
              name: {
                type: 'Interpolation',
                parts: [
                  { lit: '--' },
                  { ref: { type: 'VariableReference', name: 'n' } }
                ]
              },
              value: { type: 'Any', src: 'red' },
              important: true
            }
          ]
        }
      ]
    });
  });

  it('keeps a custom-property priority marker that is not the declaration trailer inside the value', () => {
    const source =
      '.x { --a: red !importantx; --b: a !important b; --c: "a !important"; --d: f(a !important); --e: [a !important]; --f: a !important !important; --g: red; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: '--a',
              value: { type: 'Any', src: 'red !importantx' },
              important: false
            },
            {
              type: 'Declaration',
              name: '--b',
              value: { type: 'Any', src: 'a !important b' },
              important: false
            },
            {
              type: 'Declaration',
              name: '--c',
              value: { type: 'Any', src: '"a !important"' },
              important: false
            },
            {
              type: 'Declaration',
              name: '--d',
              value: { type: 'Any', src: 'f(a !important)' },
              important: false
            },
            {
              type: 'Declaration',
              name: '--e',
              value: { type: 'Any', src: '[a !important]' },
              important: false
            },

            // Only the final marker is priority; the earlier one stays value text.
            {
              type: 'Declaration',
              name: '--f',
              value: { type: 'Any', src: 'a !important' },
              important: true
            },
            {
              type: 'Declaration',
              name: '--g',
              value: { type: 'Any', src: 'red' },
              important: false
            }
          ]
        }
      ]
    });
  });

  it('round-trips a custom-property priority marker through serialization', () => {
    const source = '.x { --accent: red !important; color: blue !important; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(
      isStylesheet(result.value) ? serialize(result.value).css : undefined
    ).toBe('.x {\n  --accent: red !important;\n  color: blue !important;\n}\n');
  });

  it('keeps malformed interpolation rejected by both public CST and AST property/value routes', () => {
    for (const source of [
      '.x { pre-@{ spaced }-post: red; }',
      '.x { --theme-${}: red; }',
      '.x { color: @{}; }',
      '.x { color: ${ spaced }; }'
    ]) {
      const cst = parseLessCst(source);
      const direct = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        cst.errors.length + Number(cst.unconsumedFrom !== null),
        source
      ).toBeGreaterThan(0);
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        source
      ).toBe(false);
    }
  });

  it('preserves escaped quoted bytes and constructs both Less interpolation forms structurally', () => {
    const source =
      '.x { plain: "a\\"b\\@{literal}-${tone}"; interpolated: "a\\"b\\@{literal}-@{theme}-${tone}"; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'plain',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: '"a\\"b\\@{literal}-' },
                  {
                    ref: {
                      type: 'PropertyReference',
                      name: 'tone',
                      raw: '$tone'
                    },
                    unquote: true
                  },
                  { lit: '"' }
                ]
              }
            },
            {
              type: 'Declaration',
              name: 'interpolated',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: '"a\\"b\\@{literal}-' },
                  {
                    ref: { type: 'VariableReference', name: 'theme' },
                    unquote: true
                  },
                  { lit: '-' },
                  {
                    ref: {
                      type: 'PropertyReference',
                      name: 'tone',
                      raw: '$tone'
                    },
                    unquote: true
                  },
                  { lit: '"' }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs static Less escaped quotes as existing escaped Quoted facts', () => {
    const source =
      '.x { double: ~"a/b"; single: ~\'c d\'; ordinary: "e\\\\ f"; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'double',
              value: {
                type: 'Quoted',
                src: '~"a/b"',
                value: 'a/b',
                quote: '"',
                escaped: true
              }
            },
            {
              type: 'Declaration',
              name: 'single',
              value: {
                type: 'Quoted',
                src: '~\'c d\'',
                value: 'c d',
                quote: '\'',
                escaped: true
              }
            },
            {
              type: 'Declaration',
              name: 'ordinary',
              value: {
                type: 'Quoted',
                src: '"e\\\\ f"',
                value: 'e\\\\ f',
                escaped: false
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs escaped quoted Less interpolation as an unquoted structural template', () => {
    const source = '@tone: red; .x { color: ~"pre-@{tone}"; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'tone' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: 'pre-' },
                  {
                    ref: {
                      type: 'VariableReference',
                      name: 'tone',
                      lookup: 'scoped'
                    },
                    unquote: true
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '.x {\n  color: pre-red;\n}\n'
    );
  });

  it('constructs child-combinator and comma-list selectors structurally', () => {
    const result = run(
      lessGrammar.Document,
      '.a > .b, #c { color: red; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value)).toEqual({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'ComplexSelector',
                value: [{ type: 'SimpleSelector', text: '.a', interp: null }, '>', { type: 'SimpleSelector', text: '.b', interp: null }]
              },
              { type: 'SimpleSelector', text: '#c', interp: null }
            ]
          },
          rules: [
            {
              type: 'Declaration',
              name: 'color',
              value: { type: 'Color', src: 'red' },
              merge: null,
              important: false
            }
          ]
        }
      ]
    });
  });

  it('treats outer Less selector comments as trivia', () => {
    const result = run(
      lessGrammar.Document,
      '#a /* first */, /* second */ .b { x: y; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              { type: 'SimpleSelector', text: '#a' },
              { type: 'SimpleSelector', text: '.b' }
            ]
          }
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '#a,\n.b {\n  x: y;\n}\n'
    );
  });

  it('constructs repeated static combinators as canonical complex segments', () => {
    const source = '.a + .b ~ #c | * || article { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value.rules[0])).toEqual({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: [
          {
            type: 'ComplexSelector',
            value: [
              { type: 'SimpleSelector', text: '.a', interp: null },
              '+',
              { type: 'SimpleSelector', text: '.b', interp: null },
              '~',
              { type: 'SimpleSelector', text: '#c', interp: null },
              '|',
              { type: 'SimpleSelector', text: '*', interp: null },
              '||',
              { type: 'SimpleSelector', text: 'article', interp: null }
            ]
          }
        ]
      },
      rules: [
        {
          type: 'Declaration',
          name: 'color',
          value: { type: 'Color', src: 'red' },
          merge: null,
          important: false
        }
      ]
    });
  });

  it('constructs adjacent static simple selectors as one canonical compound', () => {
    const source = 'button.primary#submit, &.is-open { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value.rules[0])).toEqual({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: [
          {
            type: 'CompoundSelector',
            value: [
              { type: 'SimpleSelector', text: 'button', interp: null },
              { type: 'SimpleSelector', text: '.primary', interp: null },
              { type: 'SimpleSelector', text: '#submit', interp: null }
            ]
          },
          {
            type: 'CompoundSelector',
            value: [
              { type: 'SimpleSelector', text: '&', interp: null },
              { type: 'SimpleSelector', text: '.is-open', interp: null }
            ]
          }
        ]
      },
      rules: [
        {
          type: 'Declaration',
          name: 'color',
          value: { type: 'Color', src: 'red' },
          merge: null,
          important: false
        }
      ]
    });
  });

  it('constructs production-parity static ampersand parent selectors directly', () => {
    const source = '&, &-active, &1 { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    /*
     * `ampToken` is a production terminal, not an AST recovery shortcut.  Its
     * static form maps exactly to SimpleSelector.text, which is the existing canonical
     * representation core uses to recognize parent selectors.
     */
    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(bare(result.value.rules[0])).toEqual({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: ['&', '&-active', '&1'].map(text => ({
          type: 'SimpleSelector',
          text,
          interp: null
        }))
      },
      rules: [
        {
          type: 'Declaration',
          name: 'color',
          value: { type: 'Color', src: 'red' },
          merge: null,
          important: false
        }
      ]
    });

    // Parent-selector transforms still have no typed AST/evaluator model.
    for (const unsupported of ['&(1) { color: red; }']) {
      const production = parseLessCst(unsupported);
      const direct = run(lessGrammar.Document, unsupported, {
        trivia: lessGrammar.whitespace
      });
      expect(cstIssueCount(production)).toBeGreaterThan(0);
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value)
      ).toBe(false);
    }
  });

  it('constructs nested Less relative selectors directly', () => {
    const result = run(
      lessGrammar.Document,
      '#first { > .second { + #third { color: purple; } } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Ruleset',
              selector: {
                selectors: [
                  {
                    type: 'RelativeSelector',
                    value: ['>', { type: 'SimpleSelector', text: '.second', interp: null }]
                  }
                ]
              },
              rules: [
                {
                  type: 'Ruleset',
                  selector: {
                    selectors: [
                      {
                        type: 'RelativeSelector',
                        value: ['+', { type: 'SimpleSelector', text: '#third', interp: null }]
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    });
    expect(serialize(stylesheet(result.value)).css).toBe(
      '#first > .second + #third {\n  color: purple;\n}\n'
    );
  });

  it('constructs descendant selectors as canonical space-combinator segments', () => {
    const source = '.a .b > .c { color: red; }';
    const legacy = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(legacy.errors).toHaveLength(0);
    expect(legacy.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(isStylesheet(result.value)).toBe(true);
    expect(result.value.rules[0]).toMatchObject({
      type: 'Ruleset',
      selector: {
        type: 'SelectorList',
        selectors: [
          {
            type: 'ComplexSelector',
            value: [
              { type: 'SimpleSelector', text: '.a' },
              ' ',
              { type: 'SimpleSelector', text: '.b' },
              '>',
              { type: 'SimpleSelector', text: '.c' }
            ]
          }
        ]
      }
    });
  });

  it('constructs interpolated class/id selector tokens as existing Interpolation-backed SimpleSelectors', () => {
    const source =
      '@name: card; @state: active; .@{name}-item, #tone-@{state} { color: red; &.@{state} { color: blue; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'name' },
        { type: 'VariableDeclaration', name: 'state' },
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'SimpleSelector',
                text: null,
                interp: {
                  type: 'Interpolation',
                  parts: [
                    { lit: '.' },
                    {
                      ref: { type: 'VariableReference', name: 'name' },
                      unquote: true
                    },
                    { lit: '-item' }
                  ]
                }
              },
              {
                type: 'SimpleSelector',
                text: null,
                interp: {
                  type: 'Interpolation',
                  parts: [
                    { lit: '#tone-' },
                    {
                      ref: { type: 'VariableReference', name: 'state' },
                      unquote: true
                    }
                  ]
                }
              }
            ]
          },
          rules: [
            { type: 'Declaration', name: 'color' },
            {
              type: 'Ruleset',
              selector: {
                selectors: [
                  {
                    type: 'CompoundSelector',
                    value: [
                      { text: '&' },
                      {
                        type: 'SimpleSelector',
                        text: null,
                        interp: {
                          type: 'Interpolation',
                          parts: [
                            { lit: '.' },
                            {
                              ref: {
                                type: 'VariableReference',
                                name: 'state'
                              },
                              unquote: true
                            }
                          ]
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '.card-item,\n#tone-active {\n  color: red;\n}\n:is(.card-item, #tone-active).active {\n  color: blue;\n}\n'
    });
  });

  it('keeps a bare interpolation with a glued selector suffix as typed interpolation segments', () => {
    const result = run(
      lessGrammar.Document,
      '@base: ~".foo"; .outer { & @{base}.bbb { color: red; } }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {},
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Ruleset',
              selector: {
                selectors: [
                  {
                    value: [{ type: 'SimpleSelector', text: '&' }, ' ', {
                      type: 'SimpleSelector',
                      text: null,
                      interp: {
                        type: 'Interpolation',
                        parts: [
                          {
                            ref: {
                              type: 'VariableReference',
                              name: 'base',
                              lookup: 'scoped'
                            },
                            unquote: true
                          },
                          { lit: '.bbb' }
                        ]
                      }
                    }]
                  }
                ]
              }
            }
          ]
        }
      ]
    });
  });

  it('constructs adjacent captured and quoted selector interpolations as one typed simple', () => {
    const source =
      '@cap-a: *[.a, .b]; @cap-b: *[.c, .d]; @quoted-a: ~".a, .b"; @quoted-b: ~".c, .d"; @{cap-a}@{cap-b}, @{quoted-a}@{quoted-b} { color: red; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {},
        {},
        {},
        {},
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'SimpleSelector',
                text: null,
                interp: {
                  type: 'Interpolation',
                  parts: [
                    {
                      ref: {
                        type: 'VariableReference',
                        name: 'cap-a',
                        lookup: 'scoped'
                      },
                      unquote: true
                    },
                    {
                      ref: {
                        type: 'VariableReference',
                        name: 'cap-b',
                        lookup: 'scoped'
                      },
                      unquote: true
                    }
                  ]
                }
              },
              {
                type: 'SimpleSelector',
                text: null,
                interp: {
                  type: 'Interpolation',
                  parts: [
                    {
                      ref: {
                        type: 'VariableReference',
                        name: 'quoted-a',
                        lookup: 'scoped'
                      },
                      unquote: true
                    },
                    {
                      ref: {
                        type: 'VariableReference',
                        name: 'quoted-b',
                        lookup: 'scoped'
                      },
                      unquote: true
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    });
  });

  it('constructs glued Less parent-suffix interpolation as one Interpolation-backed selector token', () => {
    const source =
      '@suffix: active; @left: x; @right: y; .button { &-@{suffix}, &@{left}-@{right} { color: red; } }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
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
                  {
                    type: 'SimpleSelector',
                    text: null,
                    interp: {
                      type: 'Interpolation',
                      parts: [
                        { lit: '&-' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'suffix'
                          }
                        }
                      ]
                    }
                  },
                  {
                    type: 'SimpleSelector',
                    text: null,
                    interp: {
                      type: 'Interpolation',
                      parts: [
                        { lit: '&' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'left'
                          }
                        },
                        { lit: '-' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'right'
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(isStylesheet(result.value)).toBe(true);
    if (!isStylesheet(result.value)) {
      throw new TypeError('expected Stylesheet');
    }
    expect(serialize(result.value)).toEqual({
      css: '.button-active,\n.buttonx-y {\n  color: red;\n}\n'
    });
  });

  it('keeps malformed, whitespace-split, and extend selector interpolation out of the ambiguous selector route', () => {
    for (const source of [
      '. @{name}-item { color: red; }',
      '.@{name}:extend(.target) { color: red; }'
    ]) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(false);
    }
  });

  it('constructs interpolated Less pseudo names as selector interpolation atoms', () => {
    const source = '@pseudo: hover; .card:@{pseudo} { color: black; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration' },
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  {
                    type: 'SimpleSelector',
                    text: null,
                    interp: {
                      parts: [
                        { lit: ':' },
                        {
                          ref: { type: 'VariableReference', name: 'pseudo' }
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('constructs static single- and double-colon pseudos as existing SimpleSelector text in compounds and lists', () => {
    const source = '.card:hover::before, .note:focus { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: ':hover' },
                  { type: 'SimpleSelector', text: '::before' }
                ]
              },
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.note' },
                  { type: 'SimpleSelector', text: ':focus' }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('routes bare and glued functional pseudos through one static pseudo opener', () => {
    const source = '.card:hover:not(.disabled):lang(en) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(
      findCstNodes(cst.tree, 'PseudoSelector').map(
        cstLeafValues
      )
    ).toContainEqual([':not(', '.disabled', ')']);
    expect(
      findCstNodes(cst.tree, 'GenericPseudo').map(
        cstLeafValues
      )
    ).toEqual([[':hover'], [':lang(', 'en', ')']]);
    expect(
      findCstNodes(cst.tree, 'PseudoArgumentText').map(
        cstLeafValues
      )
    ).toEqual([['en']]);
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: ':hover' },
                  {
                    type: 'PseudoSelector',
                    name: ':not',
                    text: null,
                    crossable: false
                  },
                  { type: 'SimpleSelector', text: ':lang(en)' }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('rejects whitespace-separated static pseudo colons on the AST path', () => {
    for (const source of [
      '.card : hover { color: red; }',
      '.card: hover { color: red; }'
    ]) {
      const direct = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });

      expect(direct.ok && direct.unconsumedFrom === null, source).toBe(false);
    }
  });

  it('constructs macro-fused static An+B pseudos as existing SimpleSelector text', () => {
    const source =
      '.card:nth-child(odd):nth-last-child(2n + 1), .note:nth-child(even) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: ':nth-child(odd)' },
                  { type: 'SimpleSelector', text: ':nth-last-child(2n + 1)' }
                ]
              },
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.note' },
                  { type: 'SimpleSelector', text: ':nth-child(even)' }
                ]
              }
            ]
          }
        }
      ]
    });
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
      [
        'a:nth-child(2n + 1) { color: red; }',
        'a:nth-child(2n + 1) {\n  color: red;\n}\n'
      ],
      [
        'a:nth-last-child(n - 3) { color: red; }',
        'a:nth-last-child(n - 3) {\n  color: red;\n}\n'
      ],
      [
        'a:nth-child(2n+1) { color: red; }',
        'a:nth-child(2n+1) {\n  color: red;\n}\n'
      ],
      [
        'a:nth-child( 2n+1 ) { color: red; }',
        'a:nth-child(2n+1) {\n  color: red;\n}\n'
      ]
    ] as const) {
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(true);
      if (!isStylesheet(result.value)) {
        continue;
      }
      expect(serialize(result.value).css, source).toEqual(expected);
    }
  });

  it('constructs static selector-valued functional pseudos through the recursive direct selector grammar', () => {
    const source =
      '.card:not(.disabled):has(.child > .grandchild), .note:is(.a, .b) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();

    /*
     * Whitelisted selector-function pseudos structure their arg: `text` is null,
     * structure lives in `args`, and the inline `:is(a, b)` join is core
     * serialization's job. `:is`/`:matches` are crossable; `:not`/`:has` sealed.
     */
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
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
                ]
              },
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.note' },
                  {
                    type: 'PseudoSelector',
                    name: ':is',
                    text: null,
                    crossable: true
                  }
                ]
              }
            ]
          }
        }
      ]
    });
    expect(
      isStylesheet(result.value) ? serialize(result.value).css : undefined
    ).toBe(
      '.card:not(.disabled):has(.child > .grandchild),\n.note:is(.a, .b) {\n  color: red;\n}\n'
    );
  });

  it('structures whitelisted selector-function pseudos while interpolated and :extend forms stay opaque', () => {
    const headTokens = (source: string): unknown[] => {
      const parsed = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });
      expect(parsed.ok, source).toBe(true);
      expect(parsed.unconsumedFrom, source).toBeNull();
      const selector = stylesheet(parsed.value).rules.flatMap(child =>
        child.type === 'Ruleset' ? [child] : []
      )[0].selector.selectors[0];
      return selectorTermTokens(firstSelectorTerm(selector));
    };

    /*
     * Whitelisted `:is` structures: parser keeps `args` (structure), never a
     * joined `text`; the inline `:is(.a, .b)` spelling is core serialization's job.
     * `:is`/`:matches` are crossable for extend.
     */
    expect(headTokens('.x:is(.a, .b) { color: red; }')).toMatchObject([
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
    ]);

    // `:not` structures too but is sealed (crossable:false).
    expect(headTokens('.x:not(.a, .b) { color: red; }')).toMatchObject([
      { type: 'SimpleSelector', text: '.x' },
      { type: 'PseudoSelector', name: ':not', text: null, crossable: false }
    ]);

    // Non-whitelist `:global`/`:local` stay opaque SimpleSelector text (no space).
    expect(headTokens('.x:global(.a, .b) { color: red; }')).toMatchObject([
      { type: 'SimpleSelector', text: '.x' },
      { type: 'SimpleSelector', text: ':global(.a,.b)' }
    ]);

    /*
     * An interpolated pseudo name stays an opaque interp-backed SimpleSelector —
     * it never becomes a structured PseudoSelector.
     */
    expect(headTokens('.x:@{state} { color: red; }')).toMatchObject([
      { type: 'SimpleSelector', text: '.x' },
      {
        type: 'SimpleSelector',
        text: null,
        interp: { parts: [{ lit: ':' }, { ref: { name: 'state' } }] }
      }
    ]);

    /*
     * A `@{…}`-interpolation-bearing arg cannot reach the static SelectorList
     * arm — its bytes do not exist until evaluation — so it becomes one
     * interpolation-backed SimpleSelector instead of a structured PseudoSelector.
     * Less 4.8.0 models this same case structurally (literal chunks and refs as
     * separate elements), so the parts stay typed and are never joined to text.
     */
    expect(headTokens('.x:is(@{sel}) { color: red; }')).toMatchObject([
      { type: 'SimpleSelector', text: '.x' },
      {
        type: 'SimpleSelector',
        text: null,
        interp: {
          parts: [{ lit: ':is(' }, { ref: { name: 'sel' } }, { lit: ')' }]
        }
      }
    ]);
    expect(headTokens('.x:not(.a@{b}) { color: red; }')).toMatchObject([
      { type: 'SimpleSelector', text: '.x' },
      {
        type: 'SimpleSelector',
        text: null,
        interp: {
          parts: [{ lit: ':not(.a' }, { ref: { name: 'b' } }, { lit: ')' }]
        }
      }
    ]);

    /*
     * `:extend(...)` is a Less extend directive, not a pseudo: it is never
     * structured and leaves the compound with only the subject SimpleSelector.
     */
    expect(headTokens('.x:extend(.a) { color: red; }')).toMatchObject([
      { type: 'SimpleSelector', text: '.x' }
    ]);
  });

  it('retains leading combinators inside nested functional pseudo selectors', () => {
    const source =
      ':is(:not(:has(>.foo)), :has(>.foo.bar)) { overflow: clip; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'PseudoSelector',
                name: ':is',
                text: null,
                crossable: true
              }
            ]
          }
        }
      ]
    });

    /*
     * Structured pseudos now render on ONE line with the canonical spaced join
     * (`, `) via core serialization; the nested leading `>` combinators survive.
     */
    expect(
      isStylesheet(result.value) ? serialize(result.value).css : undefined
    ).toBe(
      ':is(:not(:has(> .foo)), :has(> .foo.bar)) {\n  overflow: clip;\n}\n'
    );
  });

  it('constructs static non-selector functional pseudos as existing SimpleSelector text', () => {
    const source =
      '.card:lang(en-US)::part(icon):state(foo /* note */ [bar]) { color: blue; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: ':lang(en-US)' },
                  { type: 'SimpleSelector', text: '::part(icon)' },
                  { type: 'SimpleSelector', text: ':state(foo [bar])' }
                ]
              }
            ]
          }
        }
      ]
    });
    expect(
      isStylesheet(result.value) ? serialize(result.value).css : undefined
    ).toBe(
      '.card:lang(en-US)::part(icon):state(foo [bar]) {\n  color: blue;\n}\n'
    );
    expect(findCstNodes(cst.tree, 'BlockComment')).toHaveLength(0);

    for (const invalid of [
      '.card:nth-child(2n +) { color: blue; }',
      '.card:nth-child(1.5) { color: blue; }',
      '.card:nth-child(+ n) { color: blue; }',
      '.card:nth-child(+ n-5) { color: blue; }',
      '.card:nth-child(1 - n) { color: blue; }',
      '.card:nth-child(2 n + 2) { color: blue; }',
      '.card:nth-child(- 2n) { color: blue; }',
      '.card:nth-of-type(2n +) { color: blue; }',
      '.card:nth-last-of-type(1.5) { color: blue; }',
      '.card:nth-of-type(2n of .item) { color: blue; }',
      '.card:nth-last-of-type(2n of .item) { color: blue; }',
      '.card:nth-child { color: blue; }',
      '.card:nth-of-type { color: blue; }',

      /*
       * Less splices a non-`@{…}` pseudo argument as an opaque text blob and
       * never re-parses it. Jess keeps pseudo arguments structural, so these
       * stay rejected — an intentional divergence, not a recognition gap.
       */
      '.card:lang(@locale) { color: blue; }',
      '.card:lang(@@locale) { color: blue; }'
    ]) {
      const direct = run(lessGrammar.Document, invalid, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        invalid
      ).toBe(false);
    }

    /*
     * A `@{…}` argument is interpolation-bearing, which Less models structurally
     * too, so it parses as one interpolation-backed SimpleSelector.
     */
    for (const interpolated of [
      '.card:lang(@{locale}) { color: blue; }',
      '.card::part(icon-@{name}) { color: blue; }'
    ]) {
      const direct = run(lessGrammar.Document, interpolated, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        interpolated
      ).toBe(true);
    }
  });

  it('constructs the complete static An+B pseudo family without raw fallback', () => {
    const source =
      '.child:nth-child(-n+2 of .item):nth-last-child(2n + 1), .type:nth-of-type(odd):nth-last-of-type(3n) { color: blue; }';
    const direct = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(direct.ok).toBe(true);
    expect(direct.unconsumedFrom).toBeNull();
    expect(direct.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { text: '.child' },
                  { text: ':nth-child(-n+2 of .item)' },
                  { text: ':nth-last-child(2n + 1)' }
                ]
              },
              {
                type: 'CompoundSelector',
                value: [
                  { text: '.type' },
                  { text: ':nth-of-type(odd)' },
                  { text: ':nth-last-of-type(3n)' }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('restricts the `of S` nth argument to the child index via the shared cssPseudoSyntax recognition', () => {
    /*
     * `of S` is valid only for `:nth-child`/`:nth-last-child` (Selectors-4 §6.6.2);
     * the type-index families take a bare `<An+B>` (§7.1). The shared
     * `NthChildPseudoSelectorName`/`NthTypePseudoSelectorName`/`NthOfKeyword`
     * recognitions from `@jesscss/parser-shared/pseudo-consts` are what
     * enforce this split — a stray `of S` on an of-type index must reject rather
     * than fall through to an opaque descendant-selector parse.
     */
    for (const rejected of [
      'a:nth-of-type(2n of .a) { color: red; }',
      'a:nth-of-type(n of .a) { color: red; }',
      'a:nth-last-of-type(-n+3 of .a) { color: red; }'
    ]) {
      const result = run(lessGrammar.Document, rejected, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        rejected
      ).toBe(false);
    }

    for (const accepted of [
      'a:nth-child(2n of .a) { color: red; }',
      'a:nth-of-type(2n+1) { color: red; }',
      'a:nth-last-of-type(odd) { color: red; }'
    ]) {
      const result = run(lessGrammar.Document, accepted, {
        trivia: lessGrammar.whitespace
      });
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        accepted
      ).toBe(true);
    }

    /*
     * The Less-only `@{…}` interpolated An+B argument stays intact through the
     * shared-name dispatch: `:nth-child(@{n})` remains an Interpolation-backed
     * SimpleSelector, not a raw selector reparse.
     */
    const interp = run(
      lessGrammar.Document,
      'a:nth-child(@{n}) { color: red; }',
      { trivia: lessGrammar.whitespace }
    );
    expect(
      interp.ok && interp.unconsumedFrom === null && isStylesheet(interp.value)
    ).toBe(true);
    expect(interp.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: 'a' },
                  {
                    type: 'SimpleSelector',
                    text: null,
                    interp: { type: 'Interpolation' }
                  }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('keeps public block-comment trivia inside static selector-valued pseudo arguments', () => {
    const source =
      '.card:not(/* before */ .disabled, /* between */ .muted):nth-child(/* numeric */ 2n + 1) { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  {
                    type: 'PseudoSelector',
                    name: ':not',
                    text: null,
                    crossable: false
                  },
                  { type: 'SimpleSelector', text: ':nth-child(2n + 1)' }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('rejects non-selector and interpolation-bearing functional pseudo arguments without a raw fallback', () => {
    for (const source of [
      '.card:not(2n+1) { color: red; }',
      '.card:has(#{dynamic}) { color: red; }',
      '.card:has(.child { color: red; }) { color: red; }',
      '.card:extend/* not a pseudo */(.target) { color: red; }'
    ]) {
      const cst = parseLessCst(source);
      const result = run(lessGrammar.Document, source, {
        trivia: lessGrammar.whitespace
      });

      expect(cstIssueCount(cst), source).toBeGreaterThan(0);
      expect(
        result.ok
        && result.unconsumedFrom === null
        && isStylesheet(result.value),
        source
      ).toBe(false);
    }
  });

  it('constructs static unqualified attribute selectors as existing SimpleSelector text through the public selector shape', () => {
    const source =
      '.card[data-state][role=button][title="Save" i] { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: '[data-state]' },
                  { type: 'SimpleSelector', text: '[role=button]' },
                  { type: 'SimpleSelector', text: '[title="Save" i]' }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('constructs CSS-escaped attribute names structurally', () => {
    const result = run(
      lessGrammar.Document,
      '[ng\\:cloak], ng\\:form { display: none; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          selector: {
            selectors: [
              { type: 'SimpleSelector', text: '[ng\\:cloak]' },
              { type: 'SimpleSelector', text: 'ng\\:form' }
            ]
          }
        }
      ]
    });
  });

  it('constructs static namespace attribute selectors from grammar components', () => {
    const source =
      '.card[svg|role=button][*|data-state][|title="Save" i] { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  { type: 'SimpleSelector', text: '[svg|role=button]' },
                  { type: 'SimpleSelector', text: '[*|data-state]' },
                  { type: 'SimpleSelector', text: '[|title="Save" i]' }
                ]
              }
            ]
          }
        }
      ]
    });
  });

  it('keeps static namespace type selectors as one SimpleSelector rather than a column-combinator complex', () => {
    const source = 'svg|a, *|a, |a, svg|* { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'SimpleSelector',
                text: 'svg|a'
              },
              {
                type: 'SimpleSelector',
                text: '*|a'
              },
              {
                type: 'SimpleSelector',
                text: '|a'
              },
              {
                type: 'SimpleSelector',
                text: 'svg|*'
              }
            ]
          }
        }
      ]
    });
  });

  it('keeps the ordinary column combinator distinct from namespace type selector syntax', () => {
    const result = run(
      lessGrammar.Document,
      'a | b { color: red; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        {
          type: 'Ruleset',
          selector: {
            type: 'SelectorList',
            selectors: [
              {
                type: 'ComplexSelector',
                value: [{ type: 'SimpleSelector', text: 'a' }, '|', { type: 'SimpleSelector', text: 'b' }]
              }
            ]
          }
        }
      ]
    });
  });

  it('constructs interpolated attribute selectors as one structural selector token', () => {
    const source =
      '@field: state; @value: active; @name: role; @quoted: button; .card[data-@{field}=@{value}][svg|@{name}="@{quoted}"] { color: red; }';
    const cst = parseLessCst(source);
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(cst.errors).toHaveLength(0);
    expect(cst.unconsumedFrom).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
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
              {
                type: 'CompoundSelector',
                value: [
                  { type: 'SimpleSelector', text: '.card' },
                  {
                    type: 'SimpleSelector',
                    text: null,
                    interp: {
                      type: 'Interpolation',
                      parts: [
                        { lit: '[data-' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'field',
                            lookup: 'scoped'
                          },
                          unquote: true
                        },
                        { lit: '=' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'value',
                            lookup: 'scoped'
                          },
                          unquote: false
                        },
                        { lit: ']' }
                      ]
                    }
                  },
                  {
                    type: 'SimpleSelector',
                    text: null,
                    interp: {
                      type: 'Interpolation',
                      parts: [
                        { lit: '[svg|' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'name',
                            lookup: 'scoped'
                          },
                          unquote: true
                        },
                        { lit: '="' },
                        {
                          ref: {
                            type: 'VariableReference',
                            name: 'quoted',
                            lookup: 'scoped'
                          },
                          unquote: true
                        },
                        { lit: '"]' }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        }
      ]
    });
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe(
      '.card[data-state=active][svg|role="button"] {\n  color: red;\n}\n'
    );

    for (const invalid of [
      '.card[@{ spaced }=button] { color: red; }',
      '@{namespace}|a { color: red; }'
    ]) {
      const direct = run(lessGrammar.Document, invalid, {
        trivia: lessGrammar.whitespace
      });
      expect(
        direct.ok
        && direct.unconsumedFrom === null
        && isStylesheet(direct.value),
        invalid
      ).toBe(false);
    }
  });

  it('retains a quoted Less variable when it fills an unquoted attribute-selector value', () => {
    const result = run(
      lessGrammar.Document,
      '@value: "test3"; .card[data=@{value}] { color: red; }',
      { trivia: lessGrammar.whitespace }
    );

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    if (!isStylesheet(result.value)) {
      throw new TypeError('Expected a Less Stylesheet.');
    }
    expect(serialize(result.value).css).toBe(
      '.card[data="test3"] {\n  color: red;\n}\n'
    );
  });

  it('keeps the |= attribute operator distinct from a namespace prefix with interpolation', () => {
    const source = '@num: 3; [prop|="value@{num}"] { attributes: yes; }';
    const result = run(lessGrammar.Document, source, {
      trivia: lessGrammar.whitespace
    });

    expect(result.ok).toBe(true);
    expect(result.unconsumedFrom).toBeNull();
    expect(result.value).toMatchObject({
      type: 'Stylesheet',
      rules: [
        { type: 'VariableDeclaration', name: 'num' },
        {
          type: 'Ruleset',
          selector: {
            selectors: [
              {
                type: 'SimpleSelector',
                text: null,
                interp: {
                  parts: [
                    { lit: '[prop|="value' },
                    {
                      ref: { type: 'VariableReference', name: 'num' },
                      unquote: true
                    },
                    { lit: '"]' }
                  ]
                }
              }
            ]
          }
        }
      ]
    });
  });
});
