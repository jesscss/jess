import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { parse } from '@jesscss/less-parser';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { sourceSpanOf, triviaMapOf } from '../../../../core/src/ast/provenance.js';

/**
 * A custom property is permissive at the CSS base, and valid CSS must parse in
 * every dialect. The same matrix is asserted in the less / scss / jess parser
 * packages, so a dialect that re-invents custom-property recognition instead of
 * composing the shared CSS leaves fails there rather than drifting silently.
 *
 * The value grammar is `<declaration-value>` (css-syntax-3 §7.2): any token
 * sequence without a bad string/url, an unmatched close delimiter, or a
 * top-level `;`. The name is a `<dashed-ident>` (css-syntax-3 §4.3.9) except
 * bare `--`, which css-variables-1 §2 reserves.
 */
const ACCEPTED: Array<[string, string, string, boolean?]> = [
  ['static keyword value', 'a { --x: red; }', 'red'],
  ['numeric value', 'a { --x: 0; }', '0'],
  ['multi-term value', 'a { --x: 1px solid black; }', '1px solid black'],
  ['empty value', 'a { --x:; }', ''],
  ['whitespace-only value', 'a { --x:   ; }', ''],
  ['nested parens', 'a { --x: foo(bar(1, 2)); }', 'foo(bar(1, 2))'],
  ['a brace block', 'a { --x: { color: red }; }', '{ color: red }'],
  ['a semicolon inside a string', 'a { --x: "a;b"; }', '"a;b"'],
  ['a semicolon inside a bracket group', 'a { --x: [a;b]; }', '[a;b]'],
  ['a protocol-relative url', 'a { --x: url(//e.com/a;b.png); }', 'url(//e.com/a;b.png)'],
  ['an escape and a non-ASCII byte', 'a { --x: \\2014 é; }', '\\2014 é'],
  ['a lone solidus', 'a { --x: a/b; }', 'a/b'],

  /*
   * css-syntax-3 §5.5.6 strips a trailing `!important` and sets the priority flag
   * before the custom-property original-text step, so the preserved value excludes
   * the marker and the whitespace in front of it. Asserted in all four dialects.
   */
  ['a trailing priority marker', 'a { --x: red !important; }', 'red', true],
  ['a bare priority marker', 'a { --x: !important; }', '', true],
  ['a non-final priority marker', 'a { --x: red !important b; }', 'red !important b']
];

const NAMES = ['--x', '--X', '--x-y', '--0', '---x', '--_x', '--é'];

describe('Less custom properties', () => {
  for (const [label, source, expected, important = false] of ACCEPTED) {
    it(`accepts ${label}`, () => {
      expect(parse(source)).toMatchObject({
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: expected }, important }] }]
      });
    });
  }

  for (const name of NAMES) {
    it(`accepts the custom-property name \`${name}\``, () => {
      expect(parse(`a { ${name}: red; }`)).toMatchObject({
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name, value: { type: 'Any', src: 'red' } }] }]
      });
    });
  }

  it('rejects the reserved bare `--` name', () => {
    expect(() => parse('a { --: red; }')).toThrow();
  });

  it('accepts a custom property at root, nested, and inside @media', () => {
    expect(() => parse(':root { --x: red; }')).not.toThrow();
    expect(() => parse('a { b { --x: red; } }')).not.toThrow();
    expect(() => parse('@media screen { a { --x: red; } }')).not.toThrow();
  });

  it('accepts an interpolated custom-property name', () => {
    expect(parse('@p: q; a { --@{p}x: red; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: { type: 'Interpolation' } }] }
      ]
    });
  });

  it('accepts an interpolation as the whole custom-property tail', () => {
    expect(() => parse('@p: q; a { --@{p}: red; }')).not.toThrow();
  });

  it('accepts a custom-property reference in a var() consumer', () => {
    expect(parse('a { color: var(--x, blue); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }]
    });
  });

  it.each([
    ['a variable', 'var(@v)', { type: 'Lookup', kind: 'var', name: 'v' }],
    ['an indirect variable', 'var(@@v)', { type: 'Lookup', kind: 'var', raw: '@@v' }],
    ['an escape', 'var(~"--x")', { type: 'Quoted', escaped: true, value: '--x' }],
    ['a call', 'var(e("--x"))', { type: 'FunctionCall', name: 'e' }],
    ['an identifier', 'var(foo)', { type: 'Keyword', src: 'foo' }],
    ['a string', 'var("--x")', { type: 'Quoted', escaped: false, value: '--x' }]
  ])('keeps %s written as the var() name for evaluation to resolve', (_label, call, name) => {
    expect(parse(`a { b: ${call}; }`)).toMatchObject({
      rules: [{ rules: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'var', args: [{ value: name }] } }] }]
    });
  });

  /*
   * Ledger P2 (owner, reaffirmed 2026-10-09): a custom-property value is CSS
   * text, so a bare `@name` — and `@@name`, `@m[k]`, `@d()`, anything after an
   * `@` — is literal bytes, never a variable read. Only `@{…}` interpolates.
   */
  it('keeps a bare Less variable inside a custom-property value as literal text', () => {
    const document = parse('@value: #fff; :root { --color: @value; --fallback: solid @value; --calc: calc(@value + 1px); --forms: @@value @value[k] @value(); --missing: @nope; }');

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'value' },
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: '--color', value: { type: 'Any', src: '@value' } },
            { type: 'Declaration', name: '--fallback', value: { type: 'Any', src: 'solid @value' } },
            { type: 'Declaration', name: '--calc', value: { type: 'Any', src: 'calc(@value + 1px)' } },
            { type: 'Declaration', name: '--forms', value: { type: 'Any', src: '@@value @value[k] @value()' } },
            { type: 'Declaration', name: '--missing', value: { type: 'Any', src: '@nope' } }
          ]
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      ':root {\n'
      + '  --color: @value;\n'
      + '  --fallback: solid @value;\n'
      + '  --calc: calc(@value + 1px);\n'
      + '  --forms: @@value @value[k] @value();\n'
      + '  --missing: @nope;\n'
      + '}\n'
    );
  });

  it('interpolates only a strict @{…} in a custom-property value, unquoted', () => {
    const document = parse('@value: "red"; :root { --raw: @value; --strict: @{value}; --mixed: @{value} @value; }');

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'value' },
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: '--raw', value: { type: 'Any', src: '@value' } },
            { type: 'Declaration', name: '--strict', value: { type: 'Interpolation', parts: [{ unquote: true }] } },
            { type: 'Declaration', name: '--mixed', value: { type: 'Interpolation', parts: [{ unquote: true }, { lit: ' @value' }] } }
          ]
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      ':root {\n'
      + '  --raw: @value;\n'
      + '  --strict: red;\n'
      + '  --mixed: red @value;\n'
      + '}\n'
    );
  });

  it('keeps known at-rule-looking custom-property bytes opaque', () => {
    expect(parse('.card { --x:red @media all {x:y} }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: 'red @media all {x:y}' } }] }]
    });
  });

  it('keeps custom-property block comments as trivia and renders them inline', () => {
    const source = '@n: blue; .x { --a: red/* c */blue; --b: f(a/* inner */b); --c: [a/* square */b]; --d: { x: 1/* curly */ }; --e: red/* var */@{n}; --f: "@{literal}"/* q */@{n}; }';
    const document = parse(source);
    const comments = triviaMapOf(document)
      ?.commentRuns()
      .map(run => source.slice(run.start, run.end));

    expect(document).toMatchObject({
      rules: [{ type: 'VariableDeclaration', name: 'n' }, {
        type: 'Ruleset',
        rules: [
          { type: 'Declaration', name: '--a', value: { type: 'Any', src: 'redblue' } },
          { type: 'Declaration', name: '--b', value: { type: 'Any', src: 'f(ab)' } },
          { type: 'Declaration', name: '--c', value: { type: 'Any', src: '[ab]' } },
          { type: 'Declaration', name: '--d', value: { type: 'Any', src: '{ x: 1 }' } },
          { type: 'Declaration', name: '--e', value: { type: 'Interpolation' } },
          { type: 'Declaration', name: '--f', value: { type: 'Interpolation' } }
        ]
      }]
    });
    expect(comments).toEqual(expect.arrayContaining(['/* c */', '/* inner */', '/* square */', '/* curly */', '/* var */', '/* q */']));
    expect(serialize(document).css).toBe(
      '.x {\n'
      + '  --a: red/* c */blue;\n'
      + '  --b: f(a/* inner */b);\n'
      + '  --c: [a/* square */b];\n'
      + '  --d: { x: 1/* curly */ };\n'
      + '  --e: red/* var */blue;\n'
      + '  --f: "@{literal}"/* q */blue;\n'
      + '}\n'
    );
  });

  /*
   * A block comment before the first value part opens the value: the value's
   * span starts at it, so it is written in place. The comment-free value keeps
   * no edge whitespace. Only whitespace after the `:` stays outside: CSS has no
   * `//` comment, so a `//` there opens the value too.
   */
  it('starts a custom-property value at a comment that opens it', () => {
    const source = '@v: red; .x { --a: /* c */ @{v}; --b: /* d */ blue; --c: // l\n  green; }';
    const document = parse(source);
    const rule = document.rules[1];
    if (rule?.type !== 'Ruleset') {
      throw new TypeError('expected a ruleset');
    }
    const spans = rule.rules.map((declaration) => {
      const span = declaration.type === 'Declaration' && !Array.isArray(declaration.value) ? sourceSpanOf(declaration.value) : undefined;
      return span === undefined ? undefined : source.slice(span.start, span.end);
    });

    expect(spans).toEqual(['/* c */ @{v}', '/* d */ blue', '// l\n  green']);
    expect(rule.rules[1]).toMatchObject({ type: 'Declaration', value: { type: 'Any', src: 'blue' } });
    expect(serialize(document).css).toBe('.x {\n  --a: /* c */ red;\n  --b: /* d */ blue;\n  --c: // l\n    green;\n}\n');
  });

  /*
   * A custom-property value is CSS `<declaration-value>` in every dialect, so a
   * `//` after the `:` is value text, not a Less line comment that hides the `;`
   * after it (Less 4.x read `--x: //b; c: d;` as `--x: c: d;`).
   */
  it('reads a `//` that opens a custom-property value as value text', () => {
    expect(parse('a { --x: //b; c: d; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: '--x', value: { type: 'Any', src: '//b' } },
        { type: 'Declaration', name: 'c' }
      ] }]
    });
    expect(serialize(parse('a {\n  --x: // b\n    red;\n}')).css).toBe('a {\n  --x: // b\n    red;\n}\n');
  });

  /*
   * A `var()` fallback and a style query's value are the same custom-property
   * value (ledger P2), so the gap before them is the same whitespace-only gap:
   * a `//` that opens one is value text, not a comment that drops it or hides
   * the `)` after it.
   */
  /*
   * The other side of that reading: a `//` "comment" that opens a value is now
   * value text, so a quote in it opens a string that the line ends unclosed (a
   * bad string, css-syntax-3 §4.3.5). lessc 4.9.1 read it as a comment; dart-sass
   * rejects it.
   */
  it('rejects an unclosed quote in a `//` that opens a custom-property value', () => {
    expect(() => parse('a {\n  --x: // don\'t\n    red;\n}')).toThrow();
  });

  it.each([
    ['a { b: var(--y, //c\n); }', 'a {\n  b: var(--y, //c);\n}\n'],
    ['a { b: var(--y, //c); }', 'a {\n  b: var(--y, //c);\n}\n'],
    ['a { b: var(--y, //c d); }', 'a {\n  b: var(--y, //c d);\n}\n']
  ])('reads a `//` that opens a var() fallback as value text: %j', (source, expected) => {
    expect(serialize(parse(source)).css).toBe(expected);
  });
  it.each([
    '@container style(--x: //c\n) { a { b: c; } }',
    '@container style(--x: //c) { a { b: c; } }'
  ])('reads a `//` that opens a style query value as value text: %j', (source) => {
    expect(parse(source)).toMatchObject({
      rules: [{ prelude: { type: 'FunctionCall', name: 'style', args: [
        { value: { type: 'Operation', operator: ':', right: { type: 'Any', src: expect.stringMatching(/^\/\/c\s*$/) } } }
      ] } }]
    });
  });

  /*
   * A Less `//` inside a custom-property value is value text: a custom property
   * is verbatim CSS, and CSS has no `//` comments (orchestrator judgment under
   * owner delegation 2026-10-06, ledger F13). lessc 4.9.1 drops it.
   */
  it('keeps a // inside a custom-property value as value text', () => {
    expect(serialize(parse('.x { --a: red // c\n; --b: red // c\n  blue; --c: a//b; }')).css)
      .toBe('.x {\n  --a: red // c;\n  --b: red // c\n    blue;\n  --c: a//b;\n}\n');
  });

  /* U+00A0 is an ident code point (css-syntax-3 §4.2), not whitespace, so a value keeps it at either edge. */
  it('keeps a non-CSS space at a custom-property value edge', () => {
    expect(serialize(parse('.x { --a:\u00a0red; --b: (\u00a0red\u00a0); --c: var(--y, red\u00a0); }')).css)
      .toBe('.x {\n  --a: \u00a0red;\n  --b: (\u00a0red\u00a0);\n  --c: var(--y, red\u00a0);\n}\n');
  });

  /*
   * Ledger F12: a comment at either edge of a custom-property value is kept in
   * the value, in place, and a comment-only value is not the empty value; only
   * the edge whitespace is dropped (css-syntax-3 §5.5.6). Asserted in all four
   * dialects.
   */
  it.each([
    ['a{--var:/* 1 */}', 'a {\n  --var: /* 1 */;\n}\n'],
    ['a { --x: /* lead */ red; }', 'a {\n  --x: /* lead */ red;\n}\n'],
    ['a { --x: red /* trail */ ; }', 'a {\n  --x: red /* trail */;\n}\n'],
    ['a { --x:/*g*/red/*h*/; }', 'a {\n  --x: /*g*/red/*h*/;\n}\n'],
    ['a { --x:   red   ; }', 'a {\n  --x: red;\n}\n'],
    ['a { --x: /* c */ red /* d */ !important; }', 'a {\n  --x: /* c */ red /* d */ !important;\n}\n']
  ])('keeps the comments at the edges of a custom-property value in place: %j', (source, expected) => {
    expect(serialize(parse(source)).css).toBe(expected);
  });
});
