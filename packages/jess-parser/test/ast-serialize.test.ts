import { describe, it, expect } from 'vitest';
import { serializeTypes, isNode, N, VarDeclaration, Reference, Mixin, Call, If, StyleImport, JsImport, Collection } from '@jesscss/core';
import { Parser } from '../src/index.js';
import { assertValidTree } from './assert-valid-tree.js';

const parser = new Parser();

describe('jess-parser (ast serialize)', () => {
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

  it('serializes dollar variable declaration', () => {
    const { tree, errors, lexerResult } = parser.parse('$foo: red;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (VarDeclaration
        name:
          (Any [role=property] 'foo')
      `);
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules).not.toBeNull();
    if (rules) {
      const varDecl = rules.data.find(n => isNode(n, N.VarDeclaration));
      expect(varDecl && isNode(varDecl, N.VarDeclaration)).toBe(true);
      if (varDecl && isNode(varDecl, N.VarDeclaration)) {
        expect(varDecl.data.name.valueOf()).toBe('foo');
      }
    }
  });

  it('serializes dollar expression as Reference', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('$foo');
  });

  it('serializes dollar expression with property access', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo.bar; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('$foo');
    expect(String(tree)).toContain('bar');
  });

  it('serializes dollar expression with function call', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo.bar(arg1, arg2); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(String(tree)).toContain('$foo');
  });

  it('serializes dollar expression with array access', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo[0]; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('$foo');
  });

  it('serializes parenthesized dollar expression', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { width: $(1 + 1)px; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Expression');
    expect(String(tree)).toContain('$(1 + 1)');
  });

  it('serializes mixin definition', () => {
    const { tree, errors, lexerResult } = parser.parse('mixin() { color: red; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (Mixin
        name:
          (Any [role=name] 'mixin')
      `);
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules).not.toBeNull();
    if (rules) {
      const mixin = rules.data.find(n => isNode(n, N.Mixin));
      expect(mixin && isNode(mixin, N.Mixin)).toBe(true);
      if (mixin && isNode(mixin, N.Mixin)) {
        expect(String(mixin.data.name)).toBe('mixin');
      }
    }
  });

  it('serializes mixin call expression', () => {
    const { tree, errors, lexerResult } = parser.parse('$ > .mixin();');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(String(tree)).toContain('$ > .mixin()');
  });

  it('serializes $if conditional', () => {
    const { tree, errors, lexerResult } = parser.parse('$if ($foo = bar) { .a { color: red; } }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(If');
    expect(String(tree)).toContain('$if');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules).not.toBeNull();
    if (rules) {
      const ifNode = rules.data.find(n => n.type === 'If');
      expect(ifNode && ifNode.type === 'If').toBe(true);
    }
  });

  it('serializes $if with $else', () => {
    const { tree, errors, lexerResult } = parser.parse(`
      $if ($foo = bar) { .a { color: red; } }
      $else { .b { color: blue; } }
    `);
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(If');
    expect(String(tree)).toContain('$if');
    expect(String(tree)).toContain('$else');
  });

  it('serializes @-compose as StyleImport', () => {
    const { tree, errors, lexerResult } = parser.parse('@-compose "./theme.jess";');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (StyleImport
        path:
          (Quoted
            (Any [role=any] './theme.jess')
          )
      `);
    const rules = isNode(tree, N.Rules) ? tree : null;
    const si = rules?.data.find(n => isNode(n, N.StyleImport));
    expect(isNode(si, N.StyleImport) && si.options.type).toBe('compose');
  });

  it('serializes @-compose with namespace', () => {
    const { tree, errors, lexerResult } = parser.parse('@-compose "./theme.jess" as theme;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        namespace: 'theme'
      `);
  });

  it('serializes @-from as JsImport', () => {
    const { tree, errors, lexerResult } = parser.parse('@-from "./tokens.js" import * as foo;');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString(`
      (JsImport
        path:
          (Quoted
            (Any [role=any] './tokens.js')
          )
      `);
    expect(String(tree)).toContain('@-from');
    expect(String(tree)).toContain('import * as foo');
  });

  it('serializes @-from with named imports', () => {
    const { tree, errors, lexerResult } = parser.parse('@-from "./tokens.js" import ( primary, secondary );');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(JsImport');
    expect(String(tree)).toContain('import ( primary, secondary )');
  });

  it('serializes @-export as StyleImport with forward', () => {
    const { tree, errors, lexerResult } = parser.parse('@-export "./theme.jess";');
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

  it('serializes collection as Collection', () => {
    const { tree, errors, lexerResult } = parser.parse('$colors: { primary: red; secondary: blue; };');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Collection');
    // VarDeclarations are invisible; check collection contents via AST
    const rules = isNode(tree, N.Rules) ? tree : null;
    const varDecl = rules?.data.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(varDecl, N.VarDeclaration)).toBe(true);
    if (isNode(varDecl, N.VarDeclaration)) {
      expect(isNode(varDecl.data.value, N.Collection)).toBe(true);
    }
  });

  it('serializes mixin with guard', () => {
    const { tree, errors, lexerResult } = parser.parse('mixin($x) when ($x > 0) { color: red; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Mixin');
    // Guard should be present
    const rules = isNode(tree, N.Rules) ? tree : null;
    if (rules) {
      const mixin = rules.data.find(n => isNode(n, N.Mixin));
      expect(mixin && isNode(mixin, N.Mixin)).toBe(true);
      if (mixin && isNode(mixin, N.Mixin)) {
        expect(mixin.data.guard).toBeDefined();
      }
    }
  });
});
