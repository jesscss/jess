/**
 * Parse-coverage features added to reach full sass-spec parse coverage:
 *   - namespaced variable ASSIGNMENT (`ns.$var: value`, incl. `!default`/`!global`,
 *     nested in rules/functions/nested-props)
 *   - `@import` with CSS media-query lists, `supports(...)`, interpolation, and
 *     comment/whitespace around the modifier
 *   - control flow / namespaced assignment inside a nested-properties block
 *   - `@use ... with (...)` trailing comma
 *   - bare unknown at-rule with the terminator omitted before `}` (`@supports {@c}`)
 *   - placeholder ruleset inside `@supports`
 *   - `@forward ... as prefix-*` / `show` / `hide` reported as owner-unsupported
 *     even when interrupted by comments / newlines
 */
import { describe, expect } from 'vitest';
import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/jess.js';
import { functionalIt } from './parse-helpers.js';

const parser = new Parser();

function parse(src: string) {
  const r = parser.parse(src, 'Stylesheet');
  return {
    tree: r.tree,
    errors: r.errors.map(e => e.message),
    lexErrors: r.lexerResult.errors.map(e => e.message)
  };
}
function expectClean(src: string) {
  const { tree, errors, lexErrors } = parse(src);
  expect(lexErrors, src).toEqual([]);
  expect(errors, src).toEqual([]);
  return tree;
}
function expectRejected(src: string) {
  const { errors } = parse(src);
  expect(errors.length, src).toBeGreaterThanOrEqual(1);
}

describe('namespaced variable assignment', () => {
  functionalIt('top-level `ns.$member: value` builds a VarDeclaration', () => {
    const tree = expectClean('@use "o";\no.$member: new value;');
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name: 'o.member'
    `);
  });

  functionalIt('`!global` and `!default` are accepted', () => {
    expectClean('@use "o";\no.$m: 1 !global;');
    expectClean('@use "o";\no.$m: 1 !default;');
  });

  functionalIt('accepts an aliased namespace and a nested assignment', () => {
    expectClean('@use "o" as x;\na { x.$m: v; }');
  });

  functionalIt('accepts a namespaced assignment inside a @function body', () => {
    expectClean('@use "o";\n@function a() { o.$m: v; @return $m; }');
  });

  functionalIt('a plain declaration whose value reads a member is unaffected', () => {
    expectClean('@use "o";\nb { c: o.get-a(); }');
  });
});

describe('@import modifiers', () => {
  functionalIt('media-query list with internal commas stays one import', () => {
    expectClean('@import "a" b, (c: d) and (e: f), g;');
  });

  functionalIt('`and` with no space, and a long modifier run', () => {
    expectClean('@import "a" b and(c: d), e;');
    expectClean('@import "a" b c d(e) supports(f: g) h, (p: q);');
  });

  functionalIt('interpolation in the modifier', () => {
    expectClean('@import "b" #{$a};');
    expectClean('@import "b" c#{$a}d;');
  });

  functionalIt('a comma before a string still starts a new import', () => {
    const tree = expectClean('@import "b" c(d), "e.css";');
    const out = serializeTypes(tree);
    // Two separate imports — the comma before `"e.css"` starts a new one; both are
    // plain-CSS imports kept verbatim as at-rule statements.
    expect(out.match(/StyleImport|AtRuleStatement/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  functionalIt('comment / newline around a modifier', () => {
    expectClean('@import "a.css" b //x\n  y');
    expectClean('@import "a.css"\n  b');
  });

  functionalIt('rejects CSS @import ordering violations (wrong_order)', () => {
    // media feature must not be followed by supports()/ident/function w/o and/or
    expectRejected('@import "a" (b: c) supports(d: e);');
    expectRejected('@import "a" (b: c) d;');
    expectRejected('@import "a" (b: c) d(e);');
    // a comma-separated @import item must be a URL/string, not supports()/function
    expectRejected('@import "a" b, supports(c: d);');
    expectRejected('@import "a" b, c(d);');
    expectRejected('@import "a", url(b);');
  });

  functionalIt('still accepts supports() conditions and verbatim plain imports', () => {
    expectClean('@import "a.css" supports(a: b);');
    expectClean('@import "a.css" supports((a: b));');
    expectClean('@import "a.css" supports((a: b) and (c: d));');
    expectClean('@import "a.css" supports(not (a: b));');
    expectClean('@import "a" b c d(e) supports(f: g) h i j(k) l m (n: o), (p: q);');
  });
});

describe('combinators are valid only between compound selectors', () => {
  functionalIt('a single combinator between compounds parses', () => {
    expectClean('a > b {c: d}');
    expectClean('a ~ b {c: d}');
    expectClean('a b {c: d}');
    expectClean('a > b + c {d: e}');
  });

  // Leading/trailing/adjacent-multiple combinators are "bogus" — Sass emits empty
  // CSS + a [bogus-combinators] deprecation and Dart Sass 2.0 makes them an error.
  functionalIt('leading, trailing, and doubled combinators are rejected', () => {
    expectRejected('> > a {b: c}');
    expectRejected('a > > {b: c}');
    expectRejected('a > + b {c: d}');
    expectRejected('a~>b {c: d}');
    expectRejected('a > {b: c}');
    expectRejected('> > > {b: c}');
    expectRejected('a {b: c}\n+ ~ d {@extend a}');
  });
});

describe('attribute modifier is a single ASCII letter', () => {
  functionalIt('accepts a single letter', () => {
    expectClean('[a=b c] {d: e}');
    expectClean('[a=b i] {d: e}');
  });
  functionalIt('rejects a digit, underscore, or two characters', () => {
    expectRejected('[a=b 2] {d: e}');
    expectRejected('[a=b _] {d: e}');
    expectRejected('[a=b cd] {d: e}');
  });
});

// Sass+ dialect decision: CSS hex escapes inside an at-rule keyword (`@\69 f` for
// `@if`, `@\65lse` for `@else`) are nonsense no one should write. Sass decodes
// them; Sass+ rejects them as a parse error. (The plain keywords still parse.)
describe('escaped at-rule keywords are a parse error (Sass+)', () => {
  functionalIt('accepts the plain directive keywords', () => {
    expectClean('@if true {a {b: c}}');
    expectClean('@if false {} @else {a {b: c}}');
  });
  functionalIt('rejects hex-escaped directive keywords', () => {
    expectRejected('@\\69 f true {a {b: c}}');
    expectRejected('@if false {}\n@\\65lse {a {b: c}}');
  });
});

describe('nested-properties block', () => {
  functionalIt('allows a namespaced assignment inside `prop: { … }`', () => {
    expectClean('@use "o";\na { b: { o.$m: v; } }');
  });

  functionalIt('allows control flow inside `prop: { … }`', () => {
    expectClean('a { b: { @for $i from 1 through 5 { c: $i } } }');
  });
});

describe('@use with-config', () => {
  functionalIt('accepts a trailing comma in the config', () => {
    expectClean('@use \'m\' with (\n  $a: \'a\',\n  $b: \'b\',\n);');
  });
});

describe('bare at-rule + placeholder inside a query block', () => {
  functionalIt('a bare `@c` with no terminator before `}` parses', () => {
    expectClean('@supports (a: b) {@c}');
  });

  functionalIt('a placeholder ruleset inside @supports parses', () => {
    expectClean('@supports (a: b) { %c { d: e } }');
  });

  functionalIt('@supports prelude interpolation with a bare-at-rule body', () => {
    expectClean('@supports #{"(a: b)"} {@c}');
    expectClean('@supports (#{"(a: b)"} and (c: 1 + 1)) {@d}');
  });
});

describe('@forward prefix / visibility is owner-unsupported', () => {
  const rejects = (src: string) => {
    const { errors } = parse(src);
    expect(errors.join(' '), src).toContain('will never be');
  };

  functionalIt('`as prefix-*` with a comment or newline still reports "will never be"', () => {
    rejects('@forward "other" as /**/ a-*');
    rejects('@forward "other" as //\n  a-*');
    rejects('@forward "other" /**/ as a-*');
    rejects('@forward "other"\n  as a-*');
    rejects('@forward "other" as a-* /**/');
  });

  functionalIt('`show` / `hide` lists report "will never be"', () => {
    rejects('@forward "other" show a, b;');
    rejects('@forward "other" hide c;');
  });
});
