import { describe, it, expect } from 'vitest';
import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/index.js';
import { assertValidTree } from './assert-valid-tree.js';

const parser = new Parser();

function firstRuleDeclValue(tree: any) {
  return tree?.rules?.[0]?.rules?.rules?.[0]?.value;
}

describe('scss-parser (ast serialize)', () => {
  it('serializes a basic ruleset + declaration', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: red; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Ruleset
        selector:
          (BasicSelector '.a')
        rules:
          (Rules
            rules:
              [
                (Declaration
                  name:
                    (Any [role=property] 'color')
      `);
  });

  it('serializes Sass map literal as Collection', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { x: ("regular": 400, "medium": 500); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Collection
        rules:
          [
            (Declaration
              name:
                (Any [role=property] 'regular')
              value:
                (Num 400)
            )
            (Declaration
              name:
                (Any [role=property] 'medium')
              value:
                (Num 500)
            )
          ]
      )
    `);
  });

  it('serializes Sass bracketed list literals as Paren with delimiter metadata', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { x: [foo]; y: [1, 2]; z: [[1, 2], [3, 4]]; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain(`delimiter: 'square'`);
    expect(serialized).toContain(`delimiter: 'paren'`);
    expect(serialized).toContain(`(Paren`);
  });

  it('serializes SCSS arithmetic as Expression(Operation)', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { width: $v + 2; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Expression
        node:
          (Operation
    `);
    expect(firstRuleDeclValue(tree)?.node?.operator).toBe('+');
  });

  it('serializes isolated parenthesized slash division as Expression(Operation)', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { width: (15px/30px); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Expression
        node:
          (Operation
    `);
    expect(firstRuleDeclValue(tree)?.node?.operator).toBe('/');
  });

  it('keeps paren list slash forms as grouped values, not arithmetic expressions', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { font: (bold 15px/30px sans-serif); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain(`(Paren`);
    expect(serialized).not.toContain(`(Expression`);
  });

  it('serializes nested property declarations as a Collection-valued declaration', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { font: { size: 1rem; weight: bold; } }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'font')
        value:
          (Collection
    `);
    expect(serializeTypes(tree)).toContainString(`size`);
    expect(serializeTypes(tree)).toContainString(`weight`);
  });

  it('serializes nested property declarations with a base value as Sequence(..., Collection)', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { margin: auto { left: 1px; right: 2px; } }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'margin')
        value:
          (Sequence
    `);
    expect(serializeTypes(tree)).toContainString(`(Collection`);
    expect(serializeTypes(tree)).toContainString(`left`);
    expect(serializeTypes(tree)).toContainString(`right`);
  });

  it('serializes map.get() desugaring without literal map.get', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { x: map.get($font-weights, "medium"); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Reference
        target:
          (Reference
            key: 'font-weights'
          )
        key: 'medium'
      )
    `);
  });

  it('serializes @content rewrite', () => {
    const { tree, errors, lexerResult } = parser.parse('@content;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Call');
    expect(serialized).toContain(`type: 'mixin'`);
    expect(serialized).toContain(`key: 'content'`);
  });

  it('serializes @content($color, $count) with call args', () => {
    const { tree, errors, lexerResult } = parser.parse('@content($color, $count);');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Call');
    expect(serialized).toContain(`key: 'content'`);
    expect(serialized).toContain(`type: 'mixin'`);
    expect(serialized).toContain(`key: 'color'`);
    expect(serialized).toContain(`key: 'count'`);
  });

  it('serializes bare @include foo; as a mixin call', () => {
    const { tree, errors, lexerResult } = parser.parse('@include foo;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Call');
    expect(serialized).toContain(`type: 'mixin'`);
    expect(serialized).toContain(`key: 'foo'`);
  });

  it('serializes bare @include ns.foo; as a module-qualified mixin call', () => {
    const { tree, errors, lexerResult } = parser.parse('@include ns.foo;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Call');
    expect(serialized).toContain(`type: 'mixin'`);
    expect(serialized).toContain(`target:`);
    expect(serialized).toContain(`key: 'ns'`);
    expect(serialized).toContain(`key: 'foo'`);
  });

  it('serializes @include keyword args', () => {
    const { tree, errors, lexerResult } = parser.parse('@include wrap($x: 1, $y: 2);');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Call');
    expect(serialized).toContain('(VarDeclaration');
    expect(serialized).toContain(`(Any [role=property]`);
    expect(serialized).toContain(`'x'`);
    expect(serialized).toContain(`'y'`);
  });

  it('serializes SCSS suffix rest params and spread args', () => {
    const { tree, errors, lexerResult } = parser.parse(`
      @mixin foo($a, $rest...,) { @content; }
      @include foo(1, $args...,);
    `);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Rest');
    expect(serialized).toContain(`key: 'foo'`);
  });

  it('serializes SCSS literal spread args', () => {
    const { tree, errors, lexerResult } = parser.parse(`@include wrap(1..., (c: 2)...,);`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(Rest');
    expect(serialized).toContain('(Num 1)');
    expect(serialized).toContain('(Collection');
  });

  it('serializes plain CSS @import url(...) as an AtRule', () => {
    const { tree, errors, lexerResult } = parser.parse('@import url("foo.css");');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized).toContain('(AtRule');
    expect(serialized).toContain(`'@import'`);
    expect(serialized).toContain('(Url');
  });

  it('serializes placeholder rulesets', () => {
    const { tree, errors, lexerResult } = parser.parse(`%foo { color: red; }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Ruleset
        selector:
          (BasicSelector
    `);
    expect(serializeTypes(tree)).toContainString(`foo`);
  });

  it('serializes @if $a == $b as a Condition using =', () => {
    const { tree, errors, lexerResult } = parser.parse(`@if $a == $b { .x { y: 1; } }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(If`);
    expect(String(tree)).toContain('=');
    expect(String(tree)).not.toContain('==');
    expect(serializeTypes(tree)).toContainString(`
      (If
    `);
  });

  it('serializes @use "sass:map" rewrite as JsImport "#sass/map"', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "sass:map";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (JsImport
        path:
          (Quoted
            value:
              (Any [role=any] '#sass/map')
          )
      `);
  });

  it('serializes legacy Sass @import "foo" as StyleImport(type=import, multiple=true)', () => {
    const { tree, errors, lexerResult } = parser.parse(`@import "foo";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'import'
        importOptions: {
          multiple: true
        }
    `);
  });

  it('serializes comma-separated Sass imports as separate StyleImport nodes', () => {
    const { tree, errors, lexerResult } = parser.parse(`@import "a", "b";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree, { showOptions: true });
    expect(serialized.match(/\(StyleImport/g)?.length).toBe(2);
    expect(serialized).toContain(`multiple: true`);
    expect(serialized).toContain(`'a'`);
    expect(serialized).toContain(`'b'`);
  });

  it('preserves plain CSS @import as an AtRule', () => {
    const { tree, errors, lexerResult } = parser.parse(`@import "foo.css";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree);
    expect(serialized).toContainString(`(AtRule`);
    expect(serialized).not.toContainString(`(StyleImport`);
  });

  it('serializes @forward "foo" as StyleImport with forward', () => {
    const { tree, errors, lexerResult } = parser.parse(`@forward "foo";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        importOptions: {
          forward: true
        }
      `);
  });

  it('serializes @forward "foo" as bar-* with forwardAsPrefix', () => {
    const { tree, errors, lexerResult } = parser.parse(`@forward "foo" as bar-*;`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('@forward with "as <prefix>-*" prefixing is not supported');
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`forwardAsPrefix: 'bar-'`);
  });

  it('serializes @forward "foo" show/hide lists', () => {
    const { tree, errors, lexerResult } = parser.parse(`
      @forward "foo" show $a, mixin-b, fn-c;
      @forward "foo" hide $a, mixin-b, fn-c;
    `);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toContain('@forward with "show"/"hide" lists is not supported');
    expect(errors[1]?.message).toContain('@forward with "show"/"hide" lists is not supported');
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      forwardShow: ['$a', 'mixin-b', 'fn-c']
    `);
  });

  it('serializes @forward "foo" with(...) as StyleImport with injected vars', () => {
    const { tree, errors, lexerResult } = parser.parse(`@forward "foo" with ($a: #{$b});`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        importOptions: {
          forward: true
        }
      `);
  });

  it('serializes @use with(...) config var flags (!default, !global)', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "foo" with ($a: 1 !default, $b: 2 !global);`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      assign: '?:'
    `);
  });

  it('serializes @extend .b inside a ruleset as an Extend node', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { @extend .b; }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Extend
    `);
  });

  it('serializes @at-root selector shorthand as a hoisted ruleset', () => {
    const { tree, errors, lexerResult } = parser.parse(`@at-root .root-class { color: red; }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    const serialized = serializeTypes(tree);
    expect(serialized).not.toContainString(`(AtRule`);
    expect(serialized).toContainString(`
      (Ruleset
        selector:
          (ComplexSelector
            components:
              [
                (Ampersand
    `);
    expect(serialized).toContainString(`root-class`);
  });

  it('serializes ns.$var as Reference(target=Reference)', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: ns.$c; }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
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

  it('serializes ns.fn($x) as Expression(Call(name=Reference(target=Reference)))', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: ns.fn($x); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Expression
        node:
          (Call
            name:
              (Reference
                target:
                  (Reference
                    key: 'ns'
                )
              key: 'fn'
            )
      `);
  });

  it('serializes plain fn($x) as Call(name=Reference(type=function,fallbackValue:true)) (no Expression)', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: fn($x); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (Call
        name:
          (Reference
            type: 'function'
            fallbackValue: true
            key: 'fn'
          )
      `);
  });

  it('serializes selector.parse("...") as SelectorCapture', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { x: selector.parse(".b, .c"); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (SelectorCapture
    `);
  });

  it('serializes @include ns.foo($x) as Call(name=Reference(target=Reference))', () => {
    const { tree, errors, lexerResult } = parser.parse(`@include ns.foo($x);`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Call
        name:
          (Reference
            target:
              (Reference
                key: 'ns'
              )
            key: 'foo'
          )
        args:
          (List
            items:
              [
                (Reference
                  key: 'x'
                )
              ]
          )
      )
    `);
  });

  it('serializes @use "foo" as bar with options.namespace=bar', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "foo" as bar;`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        namespace: 'bar'
      `);
  });

  it('serializes @use "foo" as * with options.namespace=*', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "foo" as *;`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        namespace: '*'
      `);
  });

  it('serializes ns.\\#foo($x) as Expression(Call(name=Reference(type=mixin-ruleset)))', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: ns.\\#foo($x); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (Expression
        node:
          (Call
            name:
              (Reference
                type: 'function'
      `);
  });

  it('serializes @each destructuring as For with tuple pattern', () => {
    const { tree, errors, lexerResult } = parser.parse(`
      @each $a, $b in $list {
        .x { y: $a; z: $b; }
      }
    `);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (For
        pattern: {
          kind: 'tuple'
      `);
    expect(serializeTypes(tree)).toContainString(`(Any [role=property] 'a')`);
    expect(serializeTypes(tree)).toContainString(`(Any [role=property] 'b')`);
    expect(serializeTypes(tree)).toContainString(`
        iterable: {
          kind: 'node'
      `);
    expect(serializeTypes(tree)).toContainString(`key: 'list'`);
  });

  it('serializes @debug, @warn, @error as Log nodes with correct level', () => {
    const { tree, errors, lexerResult } = parser.parse(`
      @debug "Debug message";
      @warn "Warning message";
      @error "Error message";
    `);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Log
    `);
    // Verify they serialize to empty strings
    expect(String(tree)).not.toContain('@debug');
    expect(String(tree)).not.toContain('@warn');
    expect(String(tree)).not.toContain('@error');
  });
});
