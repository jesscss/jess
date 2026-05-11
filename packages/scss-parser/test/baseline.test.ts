import { describe, it, expect } from 'vitest';
import { Parser } from '../src/index.js';
import { isNode, N, serializeTypes, Condition, TreeContext } from '@jesscss/core';
import { assertValidTree } from './assert-valid-tree.js';

function normalizeOutput(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

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
    const treeStr = result.tree.toString();
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
    const treeStr = result.tree.toString();
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
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      const call = result.tree.value[0];
      expect(isNode(call, N.Call)).toBe(true);
      if (isNode(call, N.Call)) {
        expect(isNode(call.value.name, N.Reference)).toBe(true);
        if (isNode(call.value.name, N.Reference)) {
          expect(call.value.name.options.type).toBe('mixin');
          expect(call.value.name.value.key).toBe('content');
        }
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @content($color, $count) as a mixin call with args', () => {
    const parser = new Parser();
    const result = parser.parse('@content($color, $count);');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      const call = result.tree.value[0];
      expect(isNode(call, N.Call)).toBe(true);
      if (isNode(call, N.Call)) {
        expect(isNode(call.value.name, N.Reference)).toBe(true);
        if (isNode(call.value.name, N.Reference)) {
          expect(call.value.name.options.type).toBe('mixin');
          expect(call.value.name.value.key).toBe('content');
        }
        expect(call.value.args?.value).toHaveLength(2);
      }
    }
    assertValidTree(result.tree);
  });

  it('parses nested property declarations as a Collection-valued declaration', () => {
    const parser = new Parser();
    const result = parser.parse('.a { font: { size: 1rem; weight: bold; } }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Collection');
    expect(serializeTypes(result.tree)).toContainString('size');
    expect(serializeTypes(result.tree)).toContainString('weight');
    assertValidTree(result.tree);
  });

  it('parses nested property declarations with a base value as Sequence(..., Collection)', () => {
    const parser = new Parser();
    const result = parser.parse('.a { margin: auto { left: 1px; right: 2px; } }');
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Sequence');
    expect(serializeTypes(result.tree)).toContainString('(Collection');
    expect(serializeTypes(result.tree)).toContainString('left');
    expect(serializeTypes(result.tree)).toContainString('right');
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
    const out = result.tree.toString();
    expect(out).toContain('$if (');
    expect(out).toContain('$else if (');
    expect(out).toContain('$else');
    assertValidTree(result.tree);
  });

  it('parses @if comparisons using == as a Condition with =', () => {
    const parser = new Parser();
    const result = parser.parse(`@if $a == $b { .x { y: 1; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const out = result.tree.toString();
    expect(out).toContain('$if');
    expect(out).toContain('=');
    expect(out).not.toContain('==');
    // Assert the condition is a real Condition node (not just a serialized '=')
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const ifNode = root.value.find(n => n.type === 'If');
      expect(ifNode && ifNode.type === 'If').toBe(true);
      if (ifNode && ifNode.type === 'If') {
        const cond = ifNode.value.branches[0]?.condition;
        expect(cond && isNode(cond, N.Paren)).toBe(true);
        if (cond && isNode(cond, N.Paren)) {
          expect(cond.value instanceof Condition).toBe(true);
          if (cond.value instanceof Condition) {
            expect(cond.value.negate).not.toBe(true);
          }
        }
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @if comparisons using != as a Condition with = and negate', () => {
    const parser = new Parser();
    const result = parser.parse(`@if $a != $b { .x { y: 1; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const out = result.tree.toString();
    expect(out).toContain('$if');
    expect(out).toContain('not');
    expect(out).toContain('=');
    expect(out).not.toContain('!=');
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const ifNode = root.value.find(n => n.type === 'If');
      expect(ifNode && ifNode.type === 'If').toBe(true);
      if (ifNode && ifNode.type === 'If') {
        const cond = ifNode.value.branches[0]?.condition;
        expect(cond && isNode(cond, N.Paren)).toBe(true);
        if (cond && isNode(cond, N.Paren)) {
          expect(cond.value instanceof Condition).toBe(true);
          if (cond.value instanceof Condition) {
            expect(cond.value.options?.negate).toBe(true);
          }
        }
      }
    }
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
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      expect(root.value.some(n => isNode(n, N.Mixin))).toBe(true);
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS suffix rest params and spread args with trailing commas', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @mixin foo($a, $rest...,) {
        @content;
      }
      @include foo(1, $args...,);
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const serialized = serializeTypes(result.tree);
    expect(serialized).toContainString(`(Rest`);
    expect(serialized).toContainString(`key: 'foo'`);
    assertValidTree(result.tree);
  });

  it('parses @function and rewrites @return into $result declaration', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @function add($a, $b: 2) {
        @return $a;
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const fn = root.value.find(n => isNode(n, N.Func));
      expect(fn && isNode(fn, N.Func)).toBe(true);
      // Ensure $result var exists inside body
      if (fn && isNode(fn, N.Func)) {
        const body = fn.value.body;
        expect(isNode(body, N.Rules)).toBe(true);
        if (isNode(body, N.Rules)) {
          const ret = body.find('declaration', 'result', 'VarDeclaration', { searchParents: false });
          expect(ret).toBeDefined();
        }
      }
    }
    // TODO: enable after Func tree-validation supports function bodies without deep recursion.
  });

  it('parses plain function calls as Call(Reference(type=function, fallbackValue:true)) without Expression', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { color: fn($x); }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    // Structural assertion: the call should not be wrapped in Expression
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      const ruleset = result.tree.value.find(n => isNode(n, N.Ruleset));
      expect(ruleset && isNode(ruleset, N.Ruleset)).toBe(true);
      if (ruleset && isNode(ruleset, N.Ruleset)) {
        const decl = ruleset.value.rules?.value.find(n => isNode(n, N.Declaration));
        expect(decl && isNode(decl, N.Declaration)).toBe(true);
        if (decl && isNode(decl, N.Declaration)) {
          const val = decl.value.value;
          expect(isNode(val, N.Call)).toBe(true);
          if (isNode(val, N.Call)) {
            expect(isNode(val.value.name, N.Reference)).toBe(true);
            if (isNode(val.value.name, N.Reference)) {
              expect(val.value.name.options.type).toBe('function');
              expect(val.value.name.options.fallbackValue).toBe(true);
            }
          }
        }
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @use "foo" as a compose StyleImport', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "foo";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'StyleImport');
      expect(imp && imp.options.type).toBe('compose');
    }
    assertValidTree(result.tree);
  });

  it('parses legacy Sass @import "foo" as an import StyleImport with multiple=true', () => {
    const parser = new Parser();
    const result = parser.parse(`@import "foo";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'StyleImport');
      expect(imp && imp.type === 'StyleImport').toBe(true);
      if (imp && imp.type === 'StyleImport') {
        expect(imp.options.type).toBe('import');
        expect(imp.options.importOptions?.multiple).toBe(true);
        expect(imp.value.path.valueOf()).toBe('foo');
      }
    }
    assertValidTree(result.tree);
  });

  it('parses comma-separated Sass imports as multiple StyleImport nodes', () => {
    const parser = new Parser();
    const result = parser.parse(`@import "a", "b";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imports = root.value.filter(n => n.type === 'StyleImport');
      expect(imports).toHaveLength(2);
      expect(imports.every(n => n.type === 'StyleImport' && n.options.importOptions?.multiple === true)).toBe(true);
      expect(imports.map(n => n.type === 'StyleImport' ? n.value.path.valueOf() : '')).toEqual(['a', 'b']);
    }
    assertValidTree(result.tree);
  });

  it('parses nested Sass @import inside a ruleset', () => {
    const parser = new Parser();
    const result = parser.parse(`.scope { @import "foo"; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const ruleset = root.value.find(n => n.type === 'Ruleset');
      expect(ruleset && isNode(ruleset, N.Ruleset)).toBe(true);
      if (ruleset && isNode(ruleset, N.Ruleset)) {
        const imp = ruleset.value.rules?.value.find(n => n.type === 'StyleImport');
        expect(imp && imp.type === 'StyleImport').toBe(true);
        if (imp && imp.type === 'StyleImport') {
          expect(imp.options.type).toBe('import');
          expect(imp.options.importOptions?.multiple).toBe(true);
          expect(imp.value.path.valueOf()).toBe('foo');
        }
      }
    }
    assertValidTree(result.tree);
  });

  it('preserves plain CSS @import as an AtRule', () => {
    const parser = new Parser();
    const result = parser.parse(`@import "foo.css";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const atRule = root.value.find(n => n.type === 'AtRule');
      expect(atRule && atRule.type === 'AtRule').toBe(true);
      expect(root.value.some(n => n.type === 'StyleImport')).toBe(false);
    }
    assertValidTree(result.tree);
  });

  it('parses @use "foo" as bar (namespace override)', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "foo" as bar;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'StyleImport');
      expect(imp && imp.type === 'StyleImport').toBe(true);
      if (imp && imp.type === 'StyleImport') {
        expect(imp.options.namespace).toBe('bar');
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @use "foo" as * (no namespace)', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "foo" as *;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'StyleImport');
      expect(imp && imp.type === 'StyleImport').toBe(true);
      if (imp && imp.type === 'StyleImport') {
        expect(imp.options.namespace).toBe('*');
      }
    }
    assertValidTree(result.tree);
  });

  it('rewrites @use "sass:map" to a JsImport of "#sass/map"', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "sass:map";`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'JsImport');
      expect(imp).toBeDefined();
      if (imp && imp.type === 'JsImport') {
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
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'StyleImport');
      expect(imp).toBeDefined();
      if (imp && imp.type === 'StyleImport') {
        expect(imp.options.importOptions?.forward).toBe(true);
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @forward "foo" as bar-* (prefixing) and stores forwardAsPrefix', () => {
    const parser = new Parser();
    const result = parser.parse(`@forward "foo" as bar-*;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('@forward with "as <prefix>-*" prefixing is not supported');
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const imp = root.value.find(n => n.type === 'StyleImport');
      expect(imp).toBeDefined();
      if (imp && imp.type === 'StyleImport') {
        expect(imp.options.importOptions?.forward).toBe(true);
        expect(imp.options.importOptions?.forwardAsPrefix).toBe('bar-');
      }
    }
    assertValidTree(result.tree);
  });

  it('parses @forward "foo" show/hide lists and stores forwardShow/forwardHide', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @forward "foo" show $a, mixin-b, fn-c;
      @forward "foo" hide $a, mixin-b, fn-c;
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.message).toContain('@forward with "show"/"hide" lists is not supported');
    expect(result.errors[1]?.message).toContain('@forward with "show"/"hide" lists is not supported');
    const root = result.tree;
    expect(isNode(root, N.Rules)).toBe(true);
    if (isNode(root, N.Rules)) {
      const forwards = root.value.filter(n => isNode(n, N.StyleImport));
      expect(forwards.length).toBeGreaterThanOrEqual(2);
      const show = forwards.find(n => Array.isArray(n.options?.importOptions?.forwardShow));
      const hide = forwards.find(n => Array.isArray(n.options?.importOptions?.forwardHide));
      expect(show?.options?.importOptions?.forwardShow).toEqual(['$a', 'mixin-b', 'fn-c']);
      expect(hide?.options?.importOptions?.forwardHide).toEqual(['$a', 'mixin-b', 'fn-c']);
    }
    assertValidTree(result.tree);
  });

  it('parses @forward with(...) config values (incl interpolation)', () => {
    const parser = new Parser();
    const result = parser.parse(`@forward "foo" with ($a: #{$b});`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(serializeTypes(result.tree)).toContainString('(StyleImport');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS @extend statements', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { @extend .b; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(serializeTypes(result.tree)).toContainString('(Extend');
    assertValidTree(result.tree);
  });

  it('parses Sass placeholder @extend as a global selector lookup (*|\\\\placeholder)', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { @extend %foo; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    // Placeholder token `%foo` becomes `\\foo` and we prefix `*|` for global placeholder lookup.
    expect(serializeTypes(result.tree)).toContainString('(Extend');
    expect(serializeTypes(result.tree)).toContainString('namespace: \'*\'');
    expect(serializeTypes(result.tree)).toContainString('\\foo');
    assertValidTree(result.tree);
  });

  it('parses SCSS @extend with interpolated selector', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { @extend .b-#{$c}; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(serializeTypes(result.tree)).toContainString('(Extend');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('rejects compound @extend targets when only simple selectors are allowed', () => {
    const parser = new Parser();
    const context = new TreeContext({ allowExtendSelectors: ['simple'] });
    const result = parser.parse(`.a { @extend .b.c; }`, 'stylesheet', { context });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('@extend only allows simple selectors');
    expect(result.errors[0]?.message).toContain('compound selector');
  });

  it('allows selector lists when each @extend target is allowed', () => {
    const parser = new Parser();
    const context = new TreeContext({ allowExtendSelectors: ['simple'] });
    const result = parser.parse(`.a { @extend .b, .c; }`, 'stylesheet', { context });

    expect(result.errors).toHaveLength(0);
    expect(serializeTypes(result.tree)).toContainString('(Extend');
    assertValidTree(result.tree);
  });

  it('parses SCSS module-member variable references (ns.$var)', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { color: ns.$c; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`
      (Reference
        target:
          (Reference
            key: 'ns'
          )
        key: 'c'
      )
    `);
    assertValidTree(result.tree);
  });

  it('parses SCSS module-qualified function calls (ns.fn(...))', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { color: ns.fn($x); }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Expression');
    expect(serializeTypes(result.tree)).toContainString('(Call');
    expect(serializeTypes(result.tree)).toContainString('(Reference');
    assertValidTree(result.tree);
  });

  it('parses SCSS module-qualified mixin calls in @include (ns.foo(...))', () => {
    const parser = new Parser();
    const result = parser.parse(`@include ns.foo($x);`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`
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
    assertValidTree(result.tree);
  });

  it('parses SCSS bare mixin calls in @include (foo;)', () => {
    const parser = new Parser();
    const result = parser.parse(`@include foo;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`(Call`);
    expect(serializeTypes(result.tree)).toContainString(`key: 'foo'`);
    assertValidTree(result.tree);
  });

  it('parses SCSS bare module-qualified mixin calls in @include (ns.foo;)', () => {
    const parser = new Parser();
    const result = parser.parse(`@include ns.foo;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`
      (Call
        name: 
          (Reference
            target: 
              (Reference
                key: 'ns'
              )
            key: 'foo'
    `);
    assertValidTree(result.tree);
  });

  it('parses SCSS @include keyword args', () => {
    const parser = new Parser();
    const result = parser.parse(`@include wrap($x: 1, $y: 2);`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`(VarDeclaration`);
    expect(serializeTypes(result.tree)).toContainString(`(Any [role=property] 'x')`);
    expect(serializeTypes(result.tree)).toContainString(`(Any [role=property] 'y')`);
    assertValidTree(result.tree);
  });

  it('serializes @include ns.foo() as $ns > foo()', () => {
    const parser = new Parser();
    const result = parser.parse(`@include ns.foo();`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(result.tree.toString()).toContain('$ns > foo()');
    assertValidTree(result.tree);
  });

  it('parses @include ... using ($c, $n) { ... } as a call with contentNode', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @include wrap(red) using ($c, $n) {
        .child { color: $c; z-index: $n; }
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Mixin');
    const out = normalizeOutput(result.tree.toString());
    expect(out).toContain('$ > wrap(red)');
    expect(out).toContain('.child');
    expect(out).toContain('z-index: $n;');
    assertValidTree(result.tree);
  });

  it('preserves plain CSS @import url(...) in SCSS', () => {
    const parser = new Parser();
    const result = parser.parse(`@import url("foo.css");`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`(AtRule`);
    expect(serializeTypes(result.tree)).toContainString(`'@import'`);
    expect(serializeTypes(result.tree)).toContainString(`(Url`);
    assertValidTree(result.tree);
  });

  it('parses @each $a in $list and serializes as $for ($a of $list)', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @each $a in $list {
        .x { y: $a; }
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    const out = normalizeOutput(result.tree.toString());
    expect(out).toContain('$for ( $ a of $list)');
    assertValidTree(result.tree);
  });

  it('parses @each destructuring ($a, $b in $list) and normalizes to $for ([$a, $b] of $list)', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @each $a, $b in $list {
        .x { y: $a; z: $b; }
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(normalizeOutput(result.tree.toString())).toContain('$for ([ $ a, $ b] of $list)');
    assertValidTree(result.tree);
  });

  it('parses @for ... through ... and normalizes to a Range (inclusive end)', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @for $i from 1 through 3 {
        .x { y: $i; }
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(normalizeOutput(result.tree.toString())).toContain('$for ( $ i of 1 to 3)');
    assertValidTree(result.tree);
  });

  it('parses @for ... to ... and normalizes to a Range (exclusive end)', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @for $i from 1 to 3 {
        .x { y: $i; }
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(normalizeOutput(result.tree.toString())).toContain('$for ( $ i of 1 to <3)');
    assertValidTree(result.tree);
  });

  it('parses escaped SCSS module-qualified mixin-ruleset calls (ns.\\#foo(...))', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { color: ns.\\#foo($x); }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Expression');
    expect(serializeTypes(result.tree)).toContainString('(Call');
    expect(serializeTypes(result.tree)).toContainString('(Reference');
    assertValidTree(result.tree);
  });

  it('parses SCSS $var declarations as VarDeclaration', () => {
    const parser = new Parser();
    const result = parser.parse(`$color: red;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      expect(result.tree.value.some(n => isNode(n, N.VarDeclaration))).toBe(true);
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS $var declarations with recoveryEnabled: true', () => {
    const parser = new Parser({ recoveryEnabled: true });
    const result = parser.parse(`$color: red;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      expect(result.tree.value.some(n => isNode(n, N.VarDeclaration))).toBe(true);
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS $var followed by rule with recoveryEnabled: true', () => {
    const parser = new Parser({ recoveryEnabled: true });
    const result = parser.parse(`$primary: red;\na { color: $primary; }`);
    if (result.errors.length > 0) {
      console.log('Parse errors:', result.errors.map(e => e.message));
    }
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      const varDecls = result.tree.value.filter(n => isNode(n, N.VarDeclaration));
      const rulesets = result.tree.value.filter(n => isNode(n, N.Ruleset));
      expect(varDecls.length).toBeGreaterThan(0);
      expect(rulesets.length).toBeGreaterThan(0);
    }
  });

  it('parses SCSS $var flags !default and !global', () => {
    const parser = new Parser();
    const result = parser.parse(`$x: 1 !default !global;`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    // Structural assertions: flags should map to VarDeclaration options.
    expect(serializeTypes(result.tree, { showOptions: true })).toContainString(`
      (VarDeclaration
    `);
    expect(serializeTypes(result.tree, { showOptions: true })).toContainString(`
      assign: '?:'
    `);
    expect(serializeTypes(result.tree, { showOptions: true })).toContainString(`
      setDefined: true
    `);
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside strings', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { content: "foo #{$bar} baz"; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside selectors', () => {
    const parser = new Parser();
    const result = parser.parse(`.foo-#{$bar} { color: red; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside declaration names', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { #{$prop}: 1; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside custom property names', () => {
    const parser = new Parser();
    const result = parser.parse(`.a { --x-#{$y}: 1; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @include mixin names as an interpolated mixin reference', () => {
    const parser = new Parser();
    const result = parser.parse(`@include foo-#{$bar}();`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      const call = result.tree.value.find(n => isNode(n, N.Call));
      expect(isNode(call, N.Call)).toBe(true);
      if (isNode(call, N.Call)) {
        expect(isNode(call.value.name, N.Reference)).toBe(true);
        if (isNode(call.value.name, N.Reference)) {
          expect(call.value.name.options.type).toBe('mixin');
          expect(isNode(call.value.name.value.key, N.Interpolated)).toBe(true);
        }
      }
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @mixin names as an interpolated mixin name', () => {
    const parser = new Parser();
    const result = parser.parse(`@mixin foo-#{$bar} { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(isNode(result.tree, N.Rules)).toBe(true);
    if (isNode(result.tree, N.Rules)) {
      const mixin = result.tree.value[0];
      expect(isNode(mixin, N.Mixin)).toBe(true);
      if (isNode(mixin, N.Mixin)) {
        expect(isNode(mixin.value.name, N.Interpolated)).toBe(true);
      }
    }
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @media prelude', () => {
    const parser = new Parser();
    const result = parser.parse(`@media #{$cond} { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @supports prelude', () => {
    const parser = new Parser();
    const result = parser.parse(`@supports #{$cond} { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @container prelude', () => {
    const parser = new Parser();
    const result = parser.parse(`@container #{$cond} { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @scope prelude', () => {
    const parser = new Parser();
    const result = parser.parse(`@scope #{$cond} { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @layer names', () => {
    const parser = new Parser();
    const result = parser.parse(`@layer foo-#{$bar} { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses SCSS interpolation inside @use with(...) config values', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "foo" with ($a: #{$b});`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString('(StyleImport');
    expect(serializeTypes(result.tree)).toContainString('(Interpolated');
    assertValidTree(result.tree);
  });

  it('parses @use with(...) config var flags (!default, !global)', () => {
    const parser = new Parser();
    const result = parser.parse(`@use "foo" with ($a: 1 !default, $b: 2 !global);`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    // Smoke: ensure both vars were parsed as VarDeclaration nodes.
    expect(serializeTypes(result.tree)).toContainString('(VarDeclaration');
    // Flags should be preserved on the VarDeclaration options.
    expect(serializeTypes(result.tree, { showOptions: true })).toContainString('assign: \'?:\'');
    expect(serializeTypes(result.tree, { showOptions: true })).toContainString('setDefined: true');
    assertValidTree(result.tree);
  });

  it('parses @debug, @warn, @error diagnostic at-rules', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @debug "Debug message";
      @warn "Warning message";
      @error "Error message";
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    // Diagnostic at-rules should be parsed as Log nodes in the AST
    expect(serializeTypes(result.tree)).toContainString('(Log');
    // They should serialize to empty strings (not supported in Jess syntax)
    const out = result.tree.toString();
    expect(out).not.toContain('@debug');
    expect(out).not.toContain('@warn');
    expect(out).not.toContain('@error');
    assertValidTree(result.tree);
  });

  it('lowers plain @at-root to a null-parent ampersand selector', () => {
    const parser = new Parser();
    const result = parser.parse(`
      @at-root {
        .root-class { color: red; }
      }
    `);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(result.warnings?.length ?? 0).toBe(0);
    expect(serializeTypes(result.tree)).not.toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Ampersand');
    assertValidTree(result.tree);
  });

  it('parses placeholder rulesets', () => {
    const parser = new Parser();
    const result = parser.parse(`%foo { color: red; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(serializeTypes(result.tree)).toContainString(`(BasicSelector`);
    expect(serializeTypes(result.tree)).toContainString(`foo`);
    assertValidTree(result.tree);
  });

  it('lowers @at-root selector shorthand to a null-parent ampersand selector', () => {
    const parser = new Parser();
    const result = parser.parse(`@at-root .root-class { color: red; }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors.map(e => e.message)).toEqual([]);
    expect(result.warnings?.length ?? 0).toBe(0);
    expect(serializeTypes(result.tree)).not.toContainString('(AtRule');
    expect(serializeTypes(result.tree)).toContainString('(Ampersand');
    assertValidTree(result.tree);
  });

  it('parses @at-root filter forms, reports an explicit unsupported error, and continues', () => {
    const parser = new Parser();
    const result = parser.parse(`@at-root (without: media) { .a { color: red; } }`);
    expect(result.lexerResult.errors.length).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('@at-root prelude/filter forms are not yet supported in Jess');
    expect(result.tree).toBeDefined();
    expect(serializeTypes(result.tree)).toContainString('(AtRule');
    assertValidTree(result.tree);
  });
});
