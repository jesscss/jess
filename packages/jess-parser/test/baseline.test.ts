import { describe, it, expect } from 'vitest';
import { Parser } from '../src/index.js';
import { isNode, N } from '@jesscss/core';
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
    expect(rules?.data.some(n => isNode(n, N.VarDeclaration))).toBe(true);
  });

  it('parses dollar expression in value', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$foo');
  });

  it('parses dollar expression with property access', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo.bar; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$foo');
    expect(String(result.tree)).toContain('bar');
  });

  it('parses dollar expression with function call', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo.bar(arg1, arg2); }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$foo');
  });

  it('parses dollar expression with array access', () => {
    const parser = new Parser();
    const result = parser.parse('.a { color: $foo[0]; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$foo');
  });

  it('parses parenthesized dollar expression', () => {
    const parser = new Parser();
    const result = parser.parse('.a { width: $(1 + 1)px; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$(1 + 1)');
  });

  it('parses mixin definition', () => {
    const parser = new Parser();
    const result = parser.parse('mixin() { color: red; }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    // Mixins are invisible in CSS output by design; check AST directly
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    expect(rules?.data.some(n => isNode(n, N.Mixin))).toBe(true);
  });

  it('parses mixin call expression', () => {
    const parser = new Parser();
    const result = parser.parse('$ > .mixin();');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$ > .mixin()');
  });

  it('parses $if conditional', () => {
    const parser = new Parser();
    const result = parser.parse('$if ($foo = bar) { .a { color: red; } }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$if');
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
    expect(String(result.tree)).toContain('$if');
    expect(String(result.tree)).toContain('$else');
  });

  it('parses @-compose', () => {
    const parser = new Parser();
    const result = parser.parse('@-compose "./theme.jess";');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('@-compose');
    expect(String(result.tree)).toContain('./theme.jess');
  });

  it('parses @-compose with namespace', () => {
    const parser = new Parser();
    const result = parser.parse('@-compose "./theme.jess" as theme;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('@-compose');
    expect(String(result.tree)).toContain('theme');
  });

  it('parses @-from with namespace', () => {
    const parser = new Parser();
    const result = parser.parse('@-from "./tokens.js" import * as tokens;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('@-from');
    expect(String(result.tree)).toContain('import * as tokens');
  });

  it('parses @-from with named imports (parens)', () => {
    const parser = new Parser();
    const result = parser.parse('@-from "./tokens.js" import ( primary, secondary );');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('@-from');
    expect(String(result.tree)).toContain('primary');
    expect(String(result.tree)).toContain('secondary');
  });

  it('parses @-from with named imports (braces)', () => {
    const parser = new Parser();
    const result = parser.parse('@-from "./tokens.js" import { primary, secondary };');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('@-from');
    expect(String(result.tree)).toContain('primary');
  });

  it('parses @-export', () => {
    const parser = new Parser();
    const result = parser.parse('@-export "./theme.jess";');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('@-export');
    expect(String(result.tree)).toContain('./theme.jess');
  });

  it('parses collection', () => {
    const parser = new Parser();
    const result = parser.parse('$colors: { primary: red; secondary: blue; };');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    // VarDeclarations are invisible in CSS output; verify collection via AST
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    const varDecl = rules?.data.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(varDecl, N.VarDeclaration)).toBe(true);
    if (isNode(varDecl, N.VarDeclaration)) {
      expect(isNode(varDecl.data.value, N.Collection)).toBe(true);
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
    const mixin = rules?.data.find(n => isNode(n, N.Mixin));
    expect(isNode(mixin, N.Mixin)).toBe(true);
    if (isNode(mixin, N.Mixin)) {
      expect(mixin.data.guard).toBeDefined();
    }
  });

  it('parses chained mixin calls', () => {
    const parser = new Parser();
    const result = parser.parse('$ > #ns > .mixin();');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$ > #ns > .mixin()');
  });

  it('parses dollar expression at root level', () => {
    const parser = new Parser();
    const result = parser.parse('$foo;');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    assertValidTree(result.tree);
    expect(String(result.tree)).toContain('$foo');
  });
});
