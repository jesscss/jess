/**
 * Functional (Parséman) SCSS grammar tests — exercises `parseScssFn` directly.
 * Grows tranche-by-tranche as SCSS productions are ported onto the functional
 * grammar (see grammar-rules.ts). The class-based `ScssGrammar` is builder-only.
 */
import { describe, it, expect } from 'vitest';
import { parseScssFn } from '../src/index.js';
import { isNode, N, Condition, serializeTypes, TreeContext } from '@jesscss/core';

function parseOk(src: string) {
  const result = parseScssFn(src);
  expect(result.errors.map(e => e.message ?? String(e))).toEqual([]);
  expect(result.tree).toBeDefined();
  return result;
}

describe('ScssParserParseman — baseline', () => {
  it('parses a $var declaration', () => {
    const { tree } = parseOk('$color: red;');
    expect(tree.rules[0]!.type).toBe('VarDeclaration');
  });

  it('parses a ruleset with a $var reference', () => {
    const { tree } = parseOk('a { color: $color; }');
    expect(tree.rules[0]!.type).toBe('Ruleset');
  });
});

describe('ScssParserParseman — @if / @else', () => {
  it('parses @if / @else if / @else into a nested If chain', () => {
    const { tree } = parseOk(
      '@if 1 = 1 { .a { color: red; } } @else if 2 = 2 { .b { color: blue; } } @else { .c { color: green; } }'
    );
    const iff = tree.rules[0]!;
    expect(isNode(iff, N.If)).toBe(true);
    if (isNode(iff, N.If)) {
      // condition wraps a comparison in a Paren (matches Chevrotain)
      expect(isNode(iff.condition, N.Paren)).toBe(true);
      // @else if → nested If, @else → trailing Rules
      expect(isNode(iff.else, N.If)).toBe(true);
      if (isNode(iff.else, N.If)) {
        expect(isNode(iff.else.else, N.Rules)).toBe(true);
      }
    }
  });

  it('parses == as a Paren(Condition)', () => {
    const { tree } = parseOk('@if $a == $b { .x { y: 1; } }');
    const iff = tree.rules[0]!;
    expect(isNode(iff, N.If)).toBe(true);
    if (isNode(iff, N.If) && isNode(iff.condition, N.Paren)) {
      expect(iff.condition.value instanceof Condition).toBe(true);
    }
  });

  it('parses != as a Condition with = and negate', () => {
    const { tree } = parseOk('@if $a != $b { .x { y: 1; } }');
    const iff = tree.rules[0]!;
    if (isNode(iff, N.If) && isNode(iff.condition, N.Paren)) {
      const cond = iff.condition.value;
      expect(cond instanceof Condition).toBe(true);
      if (cond instanceof Condition) {
        expect(cond.options?.negate).toBe(true);
      }
    }
  });

  it('parses a bare truthy condition', () => {
    const { tree } = parseOk('@if $x { .a { b: 1; } }');
    expect(isNode(tree.rules[0], N.If)).toBe(true);
  });

  it('parses and / or / not / parenthesised conditions', () => {
    parseOk('@if $a and $b or $c { .a { b: 1; } }');
    parseOk('@if not $a { .a { b: 1; } }');
    parseOk('@if ($a == 1) and ($b != 2) { .a { b: 1; } }');
  });

  it('parses @if nested inside a ruleset', () => {
    const { tree } = parseOk('.wrap { @if $x { color: red; } }');
    const ruleset = tree.rules[0]!;
    expect(ruleset.type).toBe('Ruleset');
    if (isNode(ruleset, N.Ruleset)) {
      expect(isNode(ruleset.rules[0], N.If)).toBe(true);
    }
  });
});

describe('ScssParserParseman — @each / @for / @while', () => {
  it('parses @each $a in $list as For', () => {
    const { tree } = parseOk('@each $a in $list { .x { y: $a; } }');
    const loop = tree.rules[0]!;
    expect(isNode(loop, N.For)).toBe(true);
    if (isNode(loop, N.For)) {
      expect(loop.toTrimmedString()).toContain('$for ($a of $list)');
    }
  });

  it('parses @each destructuring as For with tuple pattern', () => {
    const { tree } = parseOk('@each $a, $b in $list { .x { y: $a; z: $b; } }');
    const loop = tree.rules[0]!;
    expect(isNode(loop, N.For)).toBe(true);
    if (isNode(loop, N.For)) {
      expect(loop.toTrimmedString()).toContain('$for ([$a, $b] of $list)');
    }
  });

  it('parses @for ... through ... as inclusive range', () => {
    const { tree } = parseOk('@for $i from 1 through 3 { .x { y: $i; } }');
    const loop = tree.rules[0]!;
    expect(isNode(loop, N.For)).toBe(true);
    if (isNode(loop, N.For)) {
      expect(loop.toTrimmedString()).toContain('$for ($i of 1 to 3)');
    }
  });

  it('parses @for ... to ... as exclusive range', () => {
    const { tree } = parseOk('@for $i from 1 to 3 { .x { y: $i; } }');
    const loop = tree.rules[0]!;
    expect(isNode(loop, N.For)).toBe(true);
    if (isNode(loop, N.For)) {
      expect(loop.toTrimmedString()).toContain('$for ($i of 1 to <3)');
    }
  });

  it('parses @while with a condition', () => {
    const { tree } = parseOk('@while $x { .a { b: 1; } }');
    const loop = tree.rules[0]!;
    expect(isNode(loop, N.While)).toBe(true);
    if (isNode(loop, N.While)) {
      expect(loop.toTrimmedString()).toContain('$while');
    }
  });
});

describe('ScssParserParseman — @mixin / @include / @content', () => {
  it('parses @content as Call(Reference content)', () => {
    const { tree } = parseOk('@content;');
    const call = tree.rules[0]!;
    expect(isNode(call, N.Call)).toBe(true);
    if (isNode(call, N.Call) && isNode(call.name, N.Reference)) {
      expect(call.name.options?.type).toBe('mixin');
      expect(call.name.key).toBe('content');
    }
  });

  it('parses @content with args', () => {
    const { tree } = parseOk('@content($color, $count);');
    expect(isNode(tree.rules[0], N.Call)).toBe(true);
  });

  it('parses @mixin definition with params', () => {
    const { tree } = parseOk('@mixin foo($a, $b: 2, ...$rest) { @content; }');
    expect(isNode(tree.rules[0], N.Mixin)).toBe(true);
  });

  it('parses @mixin suffix rest param', () => {
    const { tree } = parseOk('@mixin foo($a, $rest...,) { @content; }');
    expect(isNode(tree.rules[0], N.Mixin)).toBe(true);
  });

  it('parses @include mixin call', () => {
    const { tree } = parseOk('@include wrap(red);');
    expect(isNode(tree.rules[0], N.Call)).toBe(true);
  });

  it('parses bare @include', () => {
    const { tree } = parseOk('@include wrap;');
    expect(isNode(tree.rules[0], N.Call)).toBe(true);
  });

  it('parses @include spread args', () => {
    parseOk('@include wrap($args...,);');
  });

  it('parses module-qualified @include', () => {
    const { tree } = parseOk('@include ns.foo($x);');
    expect(isNode(tree.rules[0], N.Call)).toBe(true);
    if (isNode(tree.rules[0], N.Call)) {
      expect(tree.rules[0].toTrimmedString()).toContain('$ns > foo');
    }
  });

  it('parses @include keyword args', () => {
    parseOk('@include wrap($x: 1, $y: 2);');
  });

  it('parses @include using block', () => {
    const { tree } = parseOk(
      '@include wrap(red) using ($c, $n) { .child { color: $c; z-index: $n; } }'
    );
    expect(isNode(tree.rules[0], N.Call)).toBe(true);
    if (isNode(tree.rules[0], N.Call)) {
      expect(tree.rules[0].contentNode).toBeDefined();
    }
  });
});

describe('ScssParserParseman — @function / @return', () => {
  it('parses @function definition with @return', () => {
    const { tree } = parseOk('@function add($a, $b: 2) { @return $a; }');
    expect(isNode(tree.rules[0], N.Func)).toBe(true);
    if (isNode(tree.rules[0], N.Func)) {
      expect(tree.rules[0].toTrimmedString()).toContain('$function add');
    }
  });
});

describe('ScssParserParseman — interpolation (#{…})', () => {
  it('parses interpolation inside strings', () => {
    const { tree } = parseOk('.a { content: "foo #{$bar} baz"; }');
    const ruleset = tree.rules[0]!;
    expect(isNode(ruleset, N.Ruleset)).toBe(true);
    if (isNode(ruleset, N.Ruleset)) {
      const decl = ruleset.rules[0]!;
      expect(isNode(decl, N.Declaration)).toBe(true);
      if (isNode(decl, N.Declaration) && isNode(decl.value, N.Quoted)) {
        expect(isNode(decl.value.value, N.Interpolated)).toBe(true);
      }
    }
  });

  it('parses interpolation inside selectors', () => {
    const { tree } = parseOk('.foo-#{$bar} { color: red; }');
    const ruleset = tree.rules[0]!;
    expect(isNode(ruleset, N.Ruleset)).toBe(true);
    if (isNode(ruleset, N.Ruleset)) {
      expect(serializeTypes(ruleset.selector)).toContain('Interpolated');
    }
  });

  it('parses interpolation inside declaration names', () => {
    const { tree } = parseOk('.a { #{$prop}: 1; }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      const decl = ruleset.rules[0]!;
      expect(isNode(decl, N.Declaration)).toBe(true);
      if (isNode(decl, N.Declaration)) {
        expect(isNode(decl.name, N.Interpolated)).toBe(true);
      }
    }
  });

  it('parses interpolation inside custom property names', () => {
    const { tree } = parseOk('.a { --x-#{$y}: 1; }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      const decl = ruleset.rules[0]!;
      expect(isNode(decl, N.CustomDeclaration)).toBe(true);
      if (isNode(decl, N.CustomDeclaration)) {
        expect(isNode(decl.name, N.Interpolated)).toBe(true);
      }
    }
  });

  it('parses interpolation inside @mixin names', () => {
    const { tree } = parseOk('@mixin foo-#{$bar} { .a { color: red; } }');
    const mixin = tree.rules[0]!;
    expect(isNode(mixin, N.Mixin)).toBe(true);
    if (isNode(mixin, N.Mixin)) {
      expect(isNode(mixin.name, N.Interpolated)).toBe(true);
    }
  });

  it('parses interpolation inside @include mixin names', () => {
    const { tree } = parseOk('@include foo-#{$bar}();');
    const call = tree.rules[0]!;
    expect(isNode(call, N.Call)).toBe(true);
    if (isNode(call, N.Call) && isNode(call.name, N.Reference)) {
      expect(call.name.options?.type).toBe('mixin');
      expect(isNode(call.name.key, N.Interpolated)).toBe(true);
    }
  });

  it('parses bare #{expr} in value position', () => {
    const { tree } = parseOk('.a { color: #{$bar}; }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      const decl = ruleset.rules[0]!;
      if (isNode(decl, N.Declaration) && isNode(decl.value, N.Interpolated)) {
        expect(decl.value.replacements.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('ScssParserParseman — maps / lists / module refs', () => {
  it('parses a Sass map literal as Collection', () => {
    const { tree } = parseOk('.a { x: ("regular": 400, "medium": 500); }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      const decl = ruleset.rules[0]!;
      if (isNode(decl, N.Declaration) && isNode(decl.value, N.Collection)) {
        expect(decl.value.toTrimmedString()).toContain('regular: 400');
        expect(decl.value.toTrimmedString()).toContain('medium: 500');
      }
    }
  });

  it('desugars map.get() into a Reference lookup chain', () => {
    const { tree } = parseOk('.a { x: map.get($font-weights, "medium"); }');
    const serialized = serializeTypes(tree);
    expect(serialized).toContain('font-weights');
    expect(serialized).toContain('medium');
    expect(serialized).not.toContain('map.get');
  });

  it('parses bracketed list literals with square delimiter metadata', () => {
    const { tree } = parseOk('.a { x: [foo]; y: [1, 2]; }');
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain(`delimiter: 'square'`);
    expect(serialized).toContain(`delimiter: 'paren'`);
  });

  it('parses module-member variable references (ns.$var)', () => {
    const { tree } = parseOk('.a { color: ns.$c; }');
    expect(serializeTypes(tree)).toContainString(`
      (Reference
        target:
          (Reference
            key: 'ns'
          )
        key: 'c'
      )
    `);
  });

  it('parses module-qualified function calls (ns.fn(...))', () => {
    const { tree } = parseOk('.a { color: ns.fn($x); }');
    const serialized = serializeTypes(tree);
    expect(serialized).toContain('(Expression');
    expect(serialized).toContain('(Call');
    expect(serialized).toContain('(Reference');
  });
});

describe('ScssParserParseman — @use / @forward / @import / @extend', () => {
  it('parses @use as StyleImport(compose)', () => {
    const { tree } = parseOk('@use "foo";');
    expect(isNode(tree.rules[0], N.StyleImport)).toBe(true);
    if (isNode(tree.rules[0], N.StyleImport)) {
      expect(tree.rules[0].options?.type).toBe('compose');
    }
  });

  it('parses @use with namespace and with-config', () => {
    const { tree } = parseOk('@use "foo" as bar with ($a: #{$b}, $c: 1 !default);');
    const imp = tree.rules[0]!;
    expect(isNode(imp, N.StyleImport)).toBe(true);
    if (isNode(imp, N.StyleImport)) {
      expect(imp.options?.namespace).toBe('bar');
      expect(imp.with?.node).toBeDefined();
    }
  });

  it('parses @use sass: builtin as JsImport', () => {
    const { tree } = parseOk('@use "sass:map";');
    expect(isNode(tree.rules[0], N.JsImport)).toBe(true);
  });

  it('parses @use wildcard namespace', () => {
    const { tree } = parseOk('@use "foo" as *;');
    if (isNode(tree.rules[0], N.StyleImport)) {
      expect(tree.rules[0].options?.namespace).toBe('*');
    }
  });

  it('parses @forward as forwarded StyleImport', () => {
    const { tree } = parseOk('@forward "foo";');
    expect(isNode(tree.rules[0], N.StyleImport)).toBe(true);
    if (isNode(tree.rules[0], N.StyleImport)) {
      expect(tree.rules[0].options?.importOptions?.forward).toBe(true);
    }
  });

  it('parses @forward with config', () => {
    const { tree } = parseOk('@forward "foo" with ($a: #{$b});');
    if (isNode(tree.rules[0], N.StyleImport)) {
      expect(tree.rules[0].with?.node).toBeDefined();
    }
  });

  it('parses legacy Sass @import as StyleImport', () => {
    const { tree } = parseOk('@import "foo";');
    expect(isNode(tree.rules[0], N.StyleImport)).toBe(true);
    if (isNode(tree.rules[0], N.StyleImport)) {
      expect(tree.rules[0].options?.type).toBe('import');
    }
  });

  it('parses comma-separated legacy @import as multiple StyleImports', () => {
    const { tree } = parseOk('@import "a", "b";');
    expect(tree.rules.length).toBe(2);
    expect(isNode(tree.rules[0], N.StyleImport)).toBe(true);
    expect(isNode(tree.rules[1], N.StyleImport)).toBe(true);
  });

  it('preserves plain CSS @import as AtRuleStatement', () => {
    const { tree } = parseOk('@import "foo.css";');
    expect(isNode(tree.rules[0], N.AtRuleStatement)).toBe(true);
  });

  it('parses @extend inside a ruleset', () => {
    const { tree } = parseOk('.a { @extend .b; }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      expect(isNode(ruleset.rules[0], N.Extend)).toBe(true);
    }
  });

  it('parses placeholder @extend', () => {
    const { tree } = parseOk('.a { @extend %foo; }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      const ext = ruleset.rules[0];
      expect(isNode(ext, N.Extend)).toBe(true);
      if (isNode(ext, N.Extend)) {
        expect(ext.namespace).toBe('*');
        expect(serializeTypes(ext.target)).toContain('\\foo');
      }
    }
  });

  it('parses selector-list @extend targets', () => {
    const { tree } = parseOk('.a { @extend .b, .c; }');
    const ruleset = tree.rules[0]!;
    if (isNode(ruleset, N.Ruleset)) {
      expect(isNode(ruleset.rules[0], N.Extend)).toBe(true);
    }
  });

  it('reports compound @extend rejection when configured', () => {
    const result = parseScssFn('.a { @extend .b.c; }', 'Stylesheet', {
      context: new TreeContext({ allowExtendSelectors: ['simple'] })
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain('@extend only allows simple');
  });

  it('reports @forward prefixing as unsupported', () => {
    const result = parseScssFn('@forward "foo" as bar-*;');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain('@forward with "as <prefix>-*" prefixing is not supported');
  });

  it('reports @forward show/hide as unsupported', () => {
    const result = parseScssFn('@forward "foo" show $a, mixin-b, fn-c;');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain('@forward with "show"/"hide" lists is not supported');
  });
});

describe('ScssParserParseman — trailing commas', () => {
  it('parses function calls with a trailing comma', () => {
    parseOk('a { z: foo(1, 2,); }');
  });

  it('parses parenthesized list literals with a trailing comma', () => {
    parseOk('a { z: (1, 2, 3,); }');
  });

  it('rejects a bare comma in function args', () => {
    const result = parseScssFn('a { z: foo(,); }');
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
