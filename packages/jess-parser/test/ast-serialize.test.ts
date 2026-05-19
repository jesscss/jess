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
      const varDecl = rules.value.find(n => isNode(n, N.VarDeclaration));
      expect(varDecl && isNode(varDecl, N.VarDeclaration)).toBe(true);
      if (varDecl && isNode(varDecl, N.VarDeclaration)) {
        expect(varDecl.value.name.valueOf()).toBe('foo');
      }
    }
  });

  it('serializes dollar expression as Reference', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(tree.toString()).toContain('$foo');
  });

  it('serializes dollar expression with property access', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo.bar; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(tree.toString()).toContain('$foo');
    expect(tree.toString()).toContain('bar');
  });

  it('serializes dollar expression with function call', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo.bar(arg1, arg2); }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(tree.toString()).toContain('$foo');
  });

  it('serializes dollar expression with array access', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { color: $foo[0]; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(tree.toString()).toContain('$foo');
  });

  it('serializes parenthesized dollar expression', () => {
    const { tree, errors, lexerResult } = parser.parse('.a { width: $(1 + 1)px; }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Expression');
    expect(tree.toString()).toContain('$(1 + 1)');
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
      const mixin = rules.value.find(n => isNode(n, N.Mixin));
      expect(mixin && isNode(mixin, N.Mixin)).toBe(true);
      if (mixin && isNode(mixin, N.Mixin)) {
        expect(mixin.value.name.toTrimmedString()).toBe('mixin');
      }
    }
  });

  it('serializes mixin call expression', () => {
    const { tree, errors, lexerResult } = parser.parse('$ > .mixin();');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(tree.toString()).toContain('$ > .mixin()');
  });

  it('serializes $if conditional', () => {
    const { tree, errors, lexerResult } = parser.parse('$if ($foo = bar) { .a { color: red; } }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(If');
    expect(tree.toString()).toContain('$if');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules).not.toBeNull();
    if (rules) {
      const ifNode = rules.value.find(n => n.type === 'If');
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
    expect(tree.toString()).toContain('$if');
    expect(tree.toString()).toContain('$else');
  });

  it('serializes $while loop', () => {
    const { tree, errors, lexerResult } = parser.parse('$while ($i < 3) { .a { color: red; } }');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(While');
    expect(tree.toString()).toContain('$while');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const whileNode = rules?.value.find(n => n.type === 'While');
    expect(whileNode?.type).toBe('While');
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
    const si = rules?.value.find(n => isNode(n, N.StyleImport));
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
    const rules = isNode(tree, N.Rules) ? tree : null;
    const imported = rules?.value.find(n => isNode(n, N.JsImport));
    expect(isNode(imported, N.JsImport)).toBe(true);
    if (isNode(imported, N.JsImport)) {
      expect(imported.value.path.valueOf()).toBe('./tokens.js');
      expect(imported.options.namespace).toBe('foo');
    }
  });

  it('serializes @-from with named imports', () => {
    const { tree, errors, lexerResult } = parser.parse('@-from "./tokens.js" import ( primary, secondary );');
    expect(lexerResult.errors).toEqual([]);
    expect(errors).toEqual([]);
    assertValidTree(tree);
    expect(serializeTypes(tree)).toContainString('(JsImport');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const imported = rules?.value.find(n => isNode(n, N.JsImport));
    expect(isNode(imported, N.JsImport)).toBe(true);
    if (isNode(imported, N.JsImport)) {
      expect(imported.value.imports).toContain('primary');
      expect(imported.value.imports).toContain('secondary');
    }
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
    const varDecl = rules?.value.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(varDecl, N.VarDeclaration)).toBe(true);
    if (isNode(varDecl, N.VarDeclaration)) {
      expect(isNode(varDecl.value.value, N.Collection)).toBe(true);
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
      const mixin = rules.value.find(n => isNode(n, N.Mixin));
      expect(mixin && isNode(mixin, N.Mixin)).toBe(true);
      if (mixin && isNode(mixin, N.Mixin)) {
        expect(mixin.value.guard).toBeDefined();
      }
    }
  });
});
