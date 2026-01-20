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

  it('serializes @forward "foo" as StyleImport with export+reference', () => {
    const { tree, errors, lexerResult } = parser.parse(`@forward "foo";`);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
      `);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
        importOptions: {
          reference: true
          export: true
          mutable: false
        }
      `);
  });
});

