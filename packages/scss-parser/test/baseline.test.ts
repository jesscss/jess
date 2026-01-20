import { describe, it, expect } from 'vitest';
import { Parser } from '../src/index.js';
import { isNode } from '@jesscss/core';
import { assertValidTree } from './assert-valid-tree.js';

describe('scss-parser (baseline)', () => {
  it('parses basic CSS successfully', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: red; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.tree).toBeDefined();
    assertValidTree(result.tree);
  });

  it('parses a Sass map literal as a Collection', () => {
    const parser = new Parser();
    const result = parser.parse('.a { x: ("regular": 400, "medium": 500); }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const treeStr = String(result.tree);
    // Should serialize via Collection as braced rules with semicolons.
    expect(treeStr).toContain('regular: 400;');
    expect(treeStr).toContain('medium: 500;');
    assertValidTree(result.tree);
  });

  it('desugars map.get() into a Reference lookup chain', () => {
    const parser = new Parser();
    const result = parser.parse('.a { x: map.get($font-weights, "medium"); }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const treeStr = String(result.tree);
    // The desugaring uses Reference access. This is a structural smoke test.
    expect(treeStr).toContain('font-weights');
    expect(treeStr).toContain('medium');
    expect(treeStr).not.toContain('map.get(');
    assertValidTree(result.tree);
  });

  it('parses @content as $content()', () => {
    const parser = new Parser();
    const result = parser.parse('@content;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.lexerResult.tokens[0]?.tokenType?.name).toBe('AtKeyword');
    expect(result.lexerResult.tokens[0]?.image).toBe('@content');
    expect(String(result.tree)).toContain('$content()');
    assertValidTree(result.tree);
  });

  it('parses @if/@else if/@else and serializes as $if/$else if/$else', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @if 1 = 1 { .a { color: red; } }
      @else if 2 = 2 { .b { color: blue; } }
      @else { .c { color: green; } }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const out = String(result.tree);
    expect(out).toContain('$if (');
    expect(out).toContain('$else if (');
    expect(out).toContain('$else');
    assertValidTree(result.tree);
  });

  it('parses @mixin into a Mixin node (non-visible)', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @mixin foo($a, $b: 2, ...$rest) {
        @content;
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const root = result.tree;
    expect(isNode(root, 'Rules')).toBe(true);
    if (isNode(root, 'Rules')) {
      expect(root.value.some(n => isNode(n, 'Mixin'))).toBe(true);
    }
    assertValidTree(result.tree);
  });

  it('parses @use "foo" as a compose StyleImport', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "foo";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, 'Rules')).toBe(true);
    if (isNode(root, 'Rules')) {
      const imp = root.value.find(n => isNode(n, 'StyleImport'));
      expect(imp && imp.options.type).toBe('compose');
    }
    assertValidTree(result.tree);
  });

  it('rewrites @use "sass:map" to a JsImport of "#sass/map"', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "sass:map";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, 'Rules')).toBe(true);
    if (isNode(root, 'Rules')) {
      const imp = root.value.find(n => isNode(n, 'JsImport'));
      expect(imp).toBeDefined();
      if (imp && isNode(imp, 'JsImport')) {
        expect(imp.value.path.valueOf()).toBe('#sass/map');
        expect(imp.options.namespace).toBe('map');
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @forward "foo" as a forward StyleImport', () => {
    const parser = new Parser();
    const result = parser.parse(`@forward "foo";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, 'Rules')).toBe(true);
    if (isNode(root, 'Rules')) {
      const imp = root.value.find(n => isNode(n, 'StyleImport'));
      expect(imp).toBeDefined();
      if (imp && isNode(imp, 'StyleImport')) {
        expect(imp.options.importOptions?.reference).toBe(true);
        expect(imp.options.importOptions?.export).toBe(true);
        expect(imp.options.importOptions?.mutable).toBe(false);
      }
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS $var declarations as VarDeclaration', () => {
    const parser = new Parser();
    const result = parser.parse(`$color: red;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(isNode(result.tree, 'Rules')).toBe(true);
    if (isNode(result.tree, 'Rules')) {
      expect(result.tree.value.some(n => isNode(n, 'VarDeclaration'))).toBe(true);
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS $var flags !default and !global', () => {
    const parser = new Parser();
    const result = parser.parse(`$x: 1 !default !global;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const s = String(result.tree);
    // Jess prints `?:` for conditional assignment and `$^` for setDefined.
    expect(s).toContain('$^');
    expect(s).toContain('?:');
    assertValidTree(result.tree);
  });
});

