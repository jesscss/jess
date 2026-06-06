import { describe, it, expect } from 'vitest';
import { Parser } from '../src/index.js';
import { isNode, N, serializeTypes } from '@jesscss/core';
import { assertValidTree } from './assert-valid-tree.js';

describe('jess-parser (baseline)', () => {
  it('parses basic CSS successfully', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: red; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.tree).toBeDefined();
    assertValidTree(result.tree);
  });

  it('parses dollar variable declaration', () => {
    const parser = new Parser();
    const result = parser.parse('$foo: red;');
    expect(result.lexerResult.errors.length).toBe(0);
    if (result.errors.length > 0) {
      console.log('Parser errors:', result.errors.map(e => ({ message: e.message, token: e.token })));
    }
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    // VarDeclarations are invisible in CSS output by design; check AST directly
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    expect(rules?.value.some(n => isNode(n, N.VarDeclaration))).toBe(true);
  });

  it('parses dollar expression in value', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$foo');
  });

  it('parses dollar expression with property access', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo.bar; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$foo');
    expect(result.tree.toString()).toContain('bar');
  });

  it('parses dollar expression with function call', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo.bar(arg1, arg2); }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$foo');
  });

  it('parses dollar expression with array access', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo[0]; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$foo');
  });

  it('parses snapshot dollar variable reference', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $!foo; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$!foo');
  });

  it('parses parenthesized dollar expression', () => {
    const parser = new Parser();
    const result = parser.parse('.a { width: $(1 + 1)px; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$(1 + 1)');
  });

  it('parses mixin definition', () => {
    const parser = new Parser();
    const result = parser.parse('mixin() { color: red; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    // Mixins are invisible in CSS output by design; check AST directly
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    expect(rules?.value.some(n => isNode(n, N.Mixin))).toBe(true);
  });

  it('parses mixin call expression', () => {
    const parser = new Parser();
    const result = parser.parse('$ > .mixin();');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$ > .mixin()');
  });

  it('parses $if conditional', () => {
    const parser = new Parser();
    const result = parser.parse('$if ($foo = bar) { .a { color: red; } }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$if');
  });

  it('parses $if with $else', () => {
    const parser = new Parser();
    const result = parser.parse(`
      $if ($foo = bar) { .a { color: red; } }
      $else { .b { color: blue; } }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$if');
    expect(result.tree.toString()).toContain('$else');
  });

  it('parses $while loop', () => {
    const parser = new Parser();
    const result = parser.parse('$while ($i < 3) { .a { color: red; } }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(serializeTypes(result.tree)).toContainString('(While');
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    expect(rules?.value.some(n => n.type === 'While')).toBe(true);
  });

  it('parses @-compose', () => {
    const parser = new Parser();
    const result = parser.parse('@-compose "./theme.jess";');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(serializeTypes(result.tree)).toContainString('(StyleImport');
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const imported = rules?.value.find(n => isNode(n, N.StyleImport));
    expect(isNode(imported, N.StyleImport)).toBe(true);
    if (isNode(imported, N.StyleImport)) {
      expect(imported.options.type).toBe('compose');
      expect(imported.value.path.valueOf()).toBe('./theme.jess');
    }
  });

  it('parses @-compose with namespace', () => {
    const parser = new Parser();
    const result = parser.parse('@-compose "./theme.jess" as theme;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const imported = rules?.value.find(n => isNode(n, N.StyleImport));
    expect(isNode(imported, N.StyleImport)).toBe(true);
    if (isNode(imported, N.StyleImport)) {
      expect(imported.options.type).toBe('compose');
      expect(imported.options.namespace).toBe('theme');
    }
  });

  it('parses @-from with namespace', () => {
    const parser = new Parser();
    const result = parser.parse('@-from "./tokens.js" import * as tokens;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const imported = rules?.value.find(n => isNode(n, N.JsImport));
    expect(isNode(imported, N.JsImport)).toBe(true);
    if (isNode(imported, N.JsImport)) {
      expect(imported.value.path.valueOf()).toBe('./tokens.js');
      expect(imported.options.namespace).toBe('tokens');
    }
  });

  it('parses @-from with named imports (parens)', () => {
    const parser = new Parser();
    const result = parser.parse('@-from "./tokens.js" import ( primary, secondary );');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const imported = rules?.value.find(n => isNode(n, N.JsImport));
    expect(isNode(imported, N.JsImport)).toBe(true);
    if (isNode(imported, N.JsImport)) {
      expect(imported.value.imports).toContain('primary');
      expect(imported.value.imports).toContain('secondary');
    }
  });

  it('parses @-from with named imports (braces)', () => {
    const parser = new Parser();
    const result = parser.parse('@-from "./tokens.js" import { primary, secondary };');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const imported = rules?.value.find(n => isNode(n, N.JsImport));
    expect(isNode(imported, N.JsImport)).toBe(true);
    if (isNode(imported, N.JsImport)) {
      expect(imported.value.imports).toContain('primary');
    }
  });

  it('parses @-export', () => {
    const parser = new Parser();
    const result = parser.parse('@-export "./theme.jess";');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const imported = rules?.value.find(n => isNode(n, N.StyleImport));
    expect(isNode(imported, N.StyleImport)).toBe(true);
    if (isNode(imported, N.StyleImport)) {
      expect(imported.options.importOptions?.forward).toBe(true);
      expect(imported.value.path.valueOf()).toBe('./theme.jess');
    }
  });

  it('parses collection', () => {
    const parser = new Parser();
    const result = parser.parse('$colors: { primary: red; secondary: blue; };');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    // VarDeclarations are invisible in CSS output; verify collection via AST
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const varDecl = rules?.value.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(varDecl, N.VarDeclaration)).toBe(true);
    if (isNode(varDecl, N.VarDeclaration)) {
      expect(isNode(varDecl.value.value, N.Collection)).toBe(true);
    }
  });

  it('parses mixin with guard', () => {
    const parser = new Parser();
    const result = parser.parse('mixin($x) when ($x > 0) { color: red; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    // Mixins are invisible in CSS output; verify guard via AST
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const mixin = rules?.value.find(n => isNode(n, N.Mixin));
    expect(isNode(mixin, N.Mixin)).toBe(true);
    if (isNode(mixin, N.Mixin)) {
      expect(mixin.value.guard).toBeDefined();
    }
  });

  it('parses chained mixin calls', () => {
    const parser = new Parser();
    const result = parser.parse('$ > #ns > .mixin();');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$ > #ns > .mixin()');
  });

  it('parses dollar expression at root level', () => {
    const parser = new Parser();
    const result = parser.parse('$foo;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(result.tree.toString()).toContain('$foo');
  });
});
