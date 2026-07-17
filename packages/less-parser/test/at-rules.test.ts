/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- test inspects parser tree internals structurally. */
import { Context, serializeTypes, N, isNode, type Node } from '@jesscss/core';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Parser } from '../src/jess.js';
import { resolveLessTestDataRoot } from './test-data.js';

function atRulePrelude(n: Node | string | undefined): any {
  if (!isNode(n, N.AtRule)) {
    throw new Error('Expected an at-rule');
  }
  return n.prelude;
}

const parser = new Parser();
const parse = parser.parse;
const testData = resolveLessTestDataRoot();

describe('importAtRule', () => {
  it('should parse @import with url', () => {
    const { errors } = parse('@import "file.css";', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @import with url() function', () => {
    const { errors } = parse('@import url("file.css");', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @import with options', () => {
    const { errors } = parse('@import (reference) "file.less";', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('keeps a CSS @import media-query tail (not just the path)', () => {
    const { errors, tree } = parse('@import "test.css" screen, print;', 'Stylesheet');
    expect(errors.length).toBe(0);
    expect(tree.toString()).toBe('@import "test.css" screen, print;\n');
  });

  it('gives a Less (reference) url() import an unquoted Url path (not undefined)', () => {
    // A `@import (reference) url(https://…)` with an UNQUOTED url() has no
    // Quoted path; StyleImport.path fell back to undefined and derefed
    // `this.path.eval` at eval. The parsed Url node must become the path.
    const { errors, tree } = parse(
      '@import (reference) url(https://cdn.example.com/a.less);',
      'Stylesheet'
    );
    expect(errors.length).toBe(0);
    const imp = (tree as any).rules.find((n: any) => isNode(n, N.StyleImport));
    expect(imp).toBeDefined();
    expect(imp.path).toBeDefined();
    expect(isNode(imp.path)).toBe(true);
  });
});

describe('innerAtRule', () => {
  it('should parse @media inside rule', () => {
    const { errors } = parse('.test { @media screen { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @supports inside rule', () => {
    const { errors } = parse('.test { @supports (display: flex) { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

// `@supports`'s prelude is a `<supports-condition>` (css-conditional-3 §2) — no
// bare form. v5 .less is STRICTER than 4.x (which only warns): a bare CSS ident or
// a bare `@var` prelude is a HARD parse error. Valid openers: `(`, `not`, a
// function-token (`selector(…)`), AND Less `@{…}` interpolation.
describe('strict @supports prelude (v5)', () => {
  it('rejects a bare CSS ident prelude (@supports color)', () => {
    const { errors } = parse('@supports color { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(1);
    const e: any = errors[0];
    expect(String(e.message)).toContain('supports condition');
    expect(e.line).toBe(1);
    expect(e.column).toBe(11);
  });

  it('rejects a bare variable-reference prelude (@supports @cond)', () => {
    const { errors } = parse('@supports @cond { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(1);
    const e: any = errors[0];
    expect(String(e.message)).toContain('supports condition');
    expect(e.line).toBe(1);
    expect(e.column).toBe(11);
  });

  it('accepts a parenthesized condition (@supports (color: red))', () => {
    const { errors } = parse('@supports (color: red) { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('accepts a not-led condition (@supports not (x: y))', () => {
    const { errors } = parse('@supports not (x: y) { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('accepts a function-token condition (@supports selector(:has(a)))', () => {
    const { errors } = parse('@supports selector(:has(a)) { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('accepts a Less @{…} interpolation prelude (@supports @{cond})', () => {
    const { errors } = parse('@supports @{cond} { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('keeps @media bare form valid (@media screen)', () => {
    const { errors } = parse('@media screen { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('keeps @container bare form valid (@container name (width > 0))', () => {
    const { errors } = parse('@container name (width > 0) { a { color: red } }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

// The `@supports` strict-prelude ruling (above) is generalized to EVERY at-rule
// prelude/name/identifier position: a TOP-LEVEL (paren-depth 0) bare `@var` is a
// HARD parse error, while `@{interp}` is accepted, a bare ident/name stays valid,
// and a `@var` INSIDE parens (a declaration value) stays valid + resolving — even
// inside an unknown/custom at-rule. v5 is stricter than 4.x (which only warned).
describe('strict at-rule prelude — all positions (v5)', () => {
  const err = (src: string, col?: number) => {
    const { errors } = parse(src, 'Stylesheet');
    expect(errors.length).toBe(1);
    expect(String((errors[0] as any).message)).toContain('at-rule block or ;');
    if (col !== undefined) expect((errors[0] as any).column).toBe(col);
  };
  const ok = (src: string) => {
    const { errors } = parse(src, 'Stylesheet');
    expect(errors.length).toBe(0);
  };

  it('@container: bare @var errors, @{var} + bare name ok', () => {
    err('@container @v { }', 12);
    ok('@container @{v} { }');
    ok('@container name (width > 0) { }');
  });

  it('@namespace: bare @var + @@var-var error, @{var} + prefix + bare-string ok', () => {
    err('@namespace @v "u";', 12);
    err('@namespace @@v "u";', 12); // variable-variable form (less.js 8e3504d5) — invalid
    ok('@namespace @{v} "u";');
    ok('@namespace pre "u";');
    ok('@namespace "u";');
  });

  it('@charset: bare @var errors, bare string ok', () => {
    err('@charset @v;', 10);
    ok('@charset "utf-8";');
  });

  it('@document + unknown + custom at-rules: bare @var errors, @{var} ok', () => {
    err('@document @v { }', 11);
    err('@foo @v { }', 6);
    err('@-blah @v { }', 8);
    ok('@foo @{v} { }');
  });

  // The owner's explicit carve-out: a `@var` inside `(...)` is a DECLARATION VALUE
  // and stays valid + resolving, EVEN inside an unknown/custom at-rule.
  it('unknown at-rule with a paren-wrapped declaration value stays valid (@foo (x: @v))', () => {
    ok('@foo (x: @v) { a { color: red } }');
  });
});

describe('layerName', () => {
  it('should parse @layer with name', () => {
    const { errors } = parse('@layer theme { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  // v5: a top-level bare `@var` in a `@layer` name is a HARD parse error (4.x only
  // warned). The migration target is `@{var}` interpolation.
  it('rejects a bare @var layer name (@layer @var)', () => {
    const { errors } = parse('@layer @var { }', 'Stylesheet');
    expect(errors.length).toBe(1);
    expect(String((errors[0] as any).message)).toContain('at-rule block or ;');
    expect((errors[0] as any).column).toBe(8);
  });

  it('accepts a @{var} interpolated layer name (@layer @{var})', () => {
    const { errors } = parse('@layer @{var} { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('accepts a @layer name list (@layer a, b;)', () => {
    const { errors } = parse('@layer a, b;', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  // A bare `@var` anywhere top-level in a dotted layer path is rejected.
  it('rejects a bare @var inside a dotted layer path (@layer a.@v.c;)', () => {
    const { errors } = parse('@layer a.@v.c;', 'Stylesheet');
    expect(errors.length).toBe(1);
  });
});

describe('keyframesName', () => {
  it('should parse @keyframes with identifier', () => {
    const { errors } = parse('@keyframes name { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  // v5: a top-level bare `@var` keyframes name is a HARD parse error; `@{var}` is
  // the interpolation migration target.
  it('rejects a bare @var keyframes name (@keyframes @var)', () => {
    const { errors } = parse('@keyframes @var { }', 'Stylesheet');
    expect(errors.length).toBe(1);
    expect(String((errors[0] as any).message)).toContain('at-rule block or ;');
    expect((errors[0] as any).column).toBe(12);
  });

  it('accepts a @{var} interpolated keyframes name (@keyframes @{var})', () => {
    const { errors } = parse('@keyframes @{var} { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('rejects a bare @var @counter-style name (@counter-style @var)', () => {
    const { errors } = parse('@counter-style @var { }', 'Stylesheet');
    expect(errors.length).toBe(1);
  });

  it('accepts a @{var} interpolated @counter-style name', () => {
    const { errors } = parse('@counter-style @{var} { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});

describe('mediaInParens', () => {
  it('should parse media query in parentheses', () => {
    const { errors } = parse('@media (min-width: 500px) { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('does not duplicate the query prelude paren into the at-rule body', () => {
    // `g.queryPrelude` parses the prelude into real node children, so the query
    // block builder must not also emit those prelude nodes as body rules.
    const { errors, tree } = parse('@media (max-width: 600px) { .mobile-only { display: block; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const atRule = tree!.rules[0];
    if (!isNode(atRule, N.AtRule)) {
      throw new Error('Expected an at-rule');
    }
    const body = atRule.rules;
    expect(body.length).toBe(1);
    expect(isNode(body[0], N.Ruleset)).toBe(true);
    expect(isNode(body[0], N.Paren)).toBe(false);
  });

  it('should parse escaped string in media query', () => {
    const { errors } = parse('@media ~"screen" { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('unwraps an escaped-string media query to its literal content on eval', async () => {
    const { errors, tree } = parse('@media ~"screen" { a { color: red; } }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('@media screen {');
    expect(String(evald)).not.toContain('~"screen"');
  });

  it('keeps an escaped-string media query atomic across embedded spaces/parens', async () => {
    const { errors, tree } = parse(
      '@media ~"screen and (min-width: 400px)" { a { color: red; } }',
      'Stylesheet'
    );
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('@media screen and (min-width: 400px) {');
  });

  // v5: a top-level bare `@var` media query is a HARD parse error (4.x accepted it
  // as an indexed reference / variable media query). `@{var}` interpolation and a
  // paren-wrapped `@var` (a declaration value) stay valid — see the tests below.
  it('rejects a bare @var media query at top level (@media @breakpoint, print)', () => {
    const { errors } = parse('@media @breakpoint, print { }', 'Stylesheet');
    expect(errors.length).toBe(1);
    expect(String((errors[0] as any).message)).toContain('at-rule block or ;');
  });

  it('accepts a @{var} interpolated media query (@media @{q})', () => {
    const { errors } = parse('@media @{q} { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse namespaced reference media query at top level', () => {
    const { errors, tree } = parse('@media #ns.breakpoint(.valToGet[])[@max] { }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(AtRule\n          nestable: true');
    expect(out).toContainString('(Expression\n            value:');
    expect(out).toContainString('(Reference\n                  type: \'variable\'');
    expect(out).toContainString('(Call\n                    name:');
    expect(out).toContainString('(Reference [role=name]');
    expect(out).toContainString('type: \'mixin-ruleset\'');
    expect(out).toContainString('role: \'name\'');
    expect(out).toContainString('key:\n                          [\'#ns\', \'.breakpoint\']');
    expect(atRulePrelude(tree.rules[0])?.value?.target?.name?.rawKey?.toString()).toBe('#ns.breakpoint');
  });

  it('rejects a simple bare @var media query at top level (@media @breakpoint)', () => {
    const { errors } = parse('@media @breakpoint { }', 'Stylesheet');
    expect(errors.length).toBe(1);
    expect(String((errors[0] as any).message)).toContain('at-rule block or ;');
    expect((errors[0] as any).column).toBe(8);
  });
});

describe('mfValue', () => {
  it('should parse media feature value', () => {
    const { errors } = parse('@media (width: 500px) { }', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('builds an indexed accessor for `@var[key]` in a feature value (not an opaque keyword)', () => {
    const { errors, tree } = parse('@media (min-width: @breakpoints[mobile]) { }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    // The feature value must be a Reference accessor (target Reference + key),
    // NOT a Keyword('@breakpoints[mobile]').
    expect(out).toContainString('(Reference');
    expect(out).toContainString('key:\n');
    expect(out).not.toContainString('@breakpoints[mobile]');
  });

  it('builds a math Operation for a parenthesized feature value (not an opaque keyword)', () => {
    const { errors, tree } = parse('@media screen and (min-width: (@some-var + 1)) { }', 'Stylesheet');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: true });
    expect(out).toContainString('(Operation');
    expect(out).not.toContainString('(@some-var + 1)');
  });

  it('evaluates a parenthesized math feature value in a media prelude', async () => {
    const { errors, tree } = parse(
      '@some-var: 60px;\n@media screen and (min-width: (@some-var + 1)) { a { color: red; } }',
      'Stylesheet'
    );
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('@media screen and (min-width: 61px) {');
  });

  it('unwraps an escaped-string feature value (`~"2/1"`) to its literal content', async () => {
    const { errors, tree } = parse(
      '@media (-o-min-device-pixel-ratio: ~"2/1") { a { color: red; } }',
      'Stylesheet'
    );
    expect(errors.length).toBe(0);
    const evald = await tree!.eval(new Context());
    expect(String(evald)).toContain('(-o-min-device-pixel-ratio: 2/1)');
    expect(String(evald)).not.toContain('~"2/1"');
  });

  // v5: bare `@var` media-query terms are a HARD parse error (4.x unwrapped an
  // escaped-string @var into the query). The paren-wrapped feature-value form
  // (`@media (min-width: @size)`) stays valid — covered by the tests above.
  it('rejects bare `@var` media-query terms (@media @all and @tv)', () => {
    const { errors } = parse(
      '@all: ~"all";\n@tv: ~"(tv)";\n@media @all and @tv { a { color: red; } }',
      'Stylesheet'
    );
    expect(errors.length).toBe(1);
    expect(String((errors[0] as any).message)).toContain('at-rule block or ;');
  });
});

describe('at-rule prelude comments', () => {
  it('preserves authored comments in evaluated @media and @import preludes', async () => {
    const source = `@media screen /* comment */, print /* another */, handheld {
  body {
    font-size: 12pt;
  }
}

@import "test.css" screen /* comment */, print;
`;

    const { errors, tree } = parse(source, 'Stylesheet');

    expect(errors.length).toBe(0);
    expect(tree.toString()).toContain('screen /* comment */, print /* another */, handheld');
    expect(tree.toString()).toContain('@import "test.css" screen /* comment */, print;');

    const context = new Context();
    const evald = await tree.eval(context);

    expect(evald.toString({ context })).toBeString(`
      @import "test.css" screen /* comment */, print;
      @media screen /* comment */, print /* another */, handheld {
        body {
          font-size: 12pt;
        }
      }
    `);
  });

  it('keeps the Less fixture comments after evaluation', async () => {
    const fixture = path.join(testData, 'tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less');
    const expected = readFileSync(
      path.join(testData, 'tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.css'),
      'utf8'
    );
    const source = readFileSync(fixture, 'utf8');
    const { errors, tree } = parse(source, 'Stylesheet');

    expect(errors.length).toBe(0);

    const context = new Context();
    const evald = await tree.eval(context);

    expect(evald.toString({ context })).toBe(expected);
  });
});

describe('exportAtRule', () => {
  it('should parse @-export with path', () => {
    const { errors } = parse('@-export "./theme.jess";', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @-export with namespace', () => {
    const { errors } = parse('@-export "./theme.jess" as theme;', 'Stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse @-export with url()', () => {
    const { errors } = parse('@-export url("./theme.jess");', 'Stylesheet');
    expect(errors.length).toBe(0);
  });
});
