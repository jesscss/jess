import { describe, it, expect } from 'vitest';
import { serializeTypes, isNode, Condition } from '@jesscss/core';
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
      `);
    expect(serializeTypes(tree)).toContainString(`
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
    expect(serializeTypes(tree)).toContainString('(Collection');
    expect(String(tree)).toContain('regular: 400;');
    expect(String(tree)).toContain('medium: 500;');
  });

  it('serializes map.get() desugaring without literal map.get', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { x: map.get($font-weights, "medium"); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(String(tree)).not.toContain('map.get(');
    // Structural smoke: Reference chain should exist.
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('font-weights');
    expect(String(tree)).toContain('medium');
  });

  it('serializes @content rewrite', () => {
    const { tree, errors, lexerResult } = parser.parse('@content;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    // Keep it loose: we just want to ensure it becomes a call-like form.
    expect(String(tree)).toContain('$content()');
  });

  it('serializes @if $a == $b as a Condition using =', () => {
    const { tree, errors, lexerResult } = parser.parse(`@if $a == $b { .x { y: 1; } }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(If`);
    expect(String(tree)).toContain('=');
    expect(String(tree)).not.toContain('==');
    // `serializeTypes` does not traverse into `If.value.branches` (plain objects), so assert via structure.
    expect(isNode(tree, 'Rules')).toBe(true);
    if (isNode(tree, 'Rules')) {
      const ifNode = tree.value.find(n => isNode(n, 'If'));
      expect(ifNode && isNode(ifNode, 'If')).toBe(true);
      if (ifNode && isNode(ifNode, 'If')) {
        const cond = ifNode.value.branches[0]?.condition;
        expect(cond && isNode(cond, 'Paren')).toBe(true);
        if (cond && isNode(cond, 'Paren')) {
          expect(cond.value instanceof Condition).toBe(true);
        }
      }
    }
  });

  it('serializes @use "sass:map" rewrite as JsImport "#sass/map"', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "sass:map";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (JsImport
      `);
    // Path is represented as a quoted node in Jess.
    expect(serializeTypes(tree)).toContainString(`
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
      `);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
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
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`forwardShow: [`); // presence check
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`'$a'`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`'mixin-b'`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`'fn-c'`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`forwardHide: [`);
  });

  it('serializes @forward "foo" with(...) as StyleImport with injected vars', () => {
    const { tree, errors, lexerResult } = parser.parse(`@forward "foo" with ($a: #{$b});`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
      `);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
        importOptions: {
          forward: true
        }
      `);
    expect(serializeTypes(tree)).toContainString(`(Interpolated`);
  });

  it('serializes @use with(...) config var flags (!default, !global)', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "foo" with ($a: 1 !default, $b: 2 !global);`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    // Ensure both flags are captured on VarDeclarations inside the config Collection.
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`assign: '?:'`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`setDefined: true`);
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

  it('serializes ns.$var as Expression(Reference(target=Reference))', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: ns.$c; }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(Expression`);
    expect(serializeTypes(tree)).toContainString(`(Reference`);
  });

  it('serializes ns.fn($x) as Expression(Call(name=Reference(target=Reference)))', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: ns.fn($x); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(Expression`);
    expect(serializeTypes(tree)).toContainString(`(Call`);
    expect(serializeTypes(tree)).toContainString(`(Reference`);
  });

  it('serializes plain fn($x) as Call(name=Reference(type=function,fallbackValue:true)) (no Expression)', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: fn($x); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(Call`);
    expect(serializeTypes(tree)).toContainString(`(Reference`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`type: 'function'`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`fallbackValue: true`);
    expect(serializeTypes(tree)).not.toContainString(`(Expression`);
  });

  it('serializes @include ns.foo($x) as Call(name=Reference(target=Reference))', () => {
    const { tree, errors, lexerResult } = parser.parse(`@include ns.foo($x);`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(Expression`);
    expect(serializeTypes(tree)).toContainString(`(Call`);
    expect(serializeTypes(tree)).toContainString(`(Reference`);
  });

  it('serializes @use "foo" as bar with options.namespace=bar', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "foo" as bar;`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`(StyleImport`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`namespace: 'bar'`);
  });

  it('serializes @use "foo" as * with options.namespace=*', () => {
    const { tree, errors, lexerResult } = parser.parse(`@use "foo" as *;`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`(StyleImport`);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`namespace: '*'`);
  });

  it('serializes ns.\\#foo($x) as Expression(Call(name=Reference(type=mixin-ruleset)))', () => {
    const { tree, errors, lexerResult } = parser.parse(`.a { color: ns.\\#foo($x); }`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`(Expression`);
    expect(serializeTypes(tree)).toContainString(`(Call`);
    expect(serializeTypes(tree)).toContainString(`(Reference`);
  });
});

