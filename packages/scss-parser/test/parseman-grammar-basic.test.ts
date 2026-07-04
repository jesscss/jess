/**
 * Functional (Parséman) SCSS grammar tests — exercises `parseScssFn` directly.
 * Grows tranche-by-tranche as SCSS productions are ported onto the functional
 * grammar (see grammar-rules.ts). The class-based `ScssGrammar` is builder-only.
 */
import { describe, it, expect } from 'vitest';
import { parseScssFn } from '../src/index.js';
import { isNode, N, Condition } from '@jesscss/core';

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
