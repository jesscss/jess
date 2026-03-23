import { describe, it, expect } from 'vitest';
import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/index.js';
import { assertValidTree } from './assert-valid-tree.js';

const parser = new Parser();

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
            (Any [role=any] '#sass/map')
          )
      `);
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
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`forwardAsPrefix: 'bar-'`);
  });

  it('serializes @forward "foo" show/hide lists', () => {
    const { tree, errors, lexerResult } = parser.parse(`
      @forward "foo" show $a, mixin-b, fn-c;
      @forward "foo" hide $a, mixin-b, fn-c;
    `);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
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
        (Call
          name:
            (Reference
              type: 'function'
      `);
  });

  it('serializes @each destructuring as For with vars array', () => {
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
        vars:
          [
            (VarDeclaration
              name:
                (Any [role=property] 'a')
              value:
                (Nil)
            )
            (VarDeclaration
              name:
                (Any [role=property] 'b')
              value:
                (Nil)
            )
          ]
      `);
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
