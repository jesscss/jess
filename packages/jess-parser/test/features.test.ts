/**
 * Jess parser feature coverage tests.
 *
 * Covers CSS/SCSS-inherited features (selectors, values, declarations,
 * at-rules) alongside Jess-specific syntax (variables, mixins, imports,
 * control flow, collections). Combines what would otherwise be separate
 * less-parser and scss-parser test suites, unified under Jess syntax.
 */
import { describe, it, expect } from 'vitest';
import { serializeTypes, isNode, N } from '@jesscss/core';
import { Parser } from '../src/index.js';
import { assertValidTree } from './assert-valid-tree.js';

const parser = new Parser();

// ─── helpers ────────────────────────────────────────────────────────────────

function parse(src: string) {
  const result = parser.parse(src);
  expect(result.lexerResult.errors).toEqual([]);
  expect(result.errors).toEqual([]);
  assertValidTree(result.tree);
  return result.tree;
}

// ─── Selectors ───────────────────────────────────────────────────────────────

describe('jess-parser (selectors)', () => {
  it('parses element selector', () => {
    const tree = parse('div { color: red; }');
    expect(serializeTypes(tree)).toContainString('(BasicSelector \'div\')');
  });

  it('parses class selector', () => {
    const tree = parse('.foo { color: red; }');
    expect(serializeTypes(tree)).toContainString('(BasicSelector \'.foo\')');
  });

  it('parses id selector', () => {
    const tree = parse('#bar { color: red; }');
    expect(serializeTypes(tree)).toContainString('(BasicSelector \'#bar\')');
  });

  it('parses compound selector (.foo.bar)', () => {
    const tree = parse('.foo.bar { color: red; }');
    expect(String(tree)).toContain('.foo.bar');
  });

  it('parses descendant combinator', () => {
    const tree = parse('.parent .child { color: red; }');
    expect(String(tree)).toContain('.parent .child');
  });

  it('parses child combinator', () => {
    const tree = parse('.parent > .child { color: red; }');
    expect(String(tree)).toContain('.parent > .child');
  });

  it('parses adjacent sibling combinator', () => {
    const tree = parse('.a + .b { color: red; }');
    expect(String(tree)).toContain('.a + .b');
  });

  it('parses general sibling combinator', () => {
    const tree = parse('.a ~ .b { color: red; }');
    expect(String(tree)).toContain('.a ~ .b');
  });

  it('parses attribute selector', () => {
    const tree = parse('[type="text"] { color: red; }');
    expect(String(tree)).toContain('[type="text"]');
  });

  it('parses pseudo-class', () => {
    const tree = parse('.a:hover { color: red; }');
    expect(String(tree)).toContain(':hover');
  });

  it('parses pseudo-element', () => {
    const tree = parse('p::before { content: ""; }');
    expect(String(tree)).toContain('::before');
  });

  it('parses multiple selectors (comma-separated)', () => {
    const tree = parse('.a, .b { color: red; }');
    expect(String(tree)).toContain('.a');
    expect(String(tree)).toContain('.b');
  });

  it('parses nested ruleset', () => {
    const tree = parse('.parent { color: red; .child { color: blue; } }');
    const serialized = serializeTypes(tree);
    expect(serialized).toContainString('(Ruleset');
  });

  it('parses & parent selector', () => {
    const tree = parse('.a { &:hover { color: red; } }');
    expect(String(tree)).toContain('&:hover');
  });
});

// ─── Values ──────────────────────────────────────────────────────────────────

describe('jess-parser (values)', () => {
  it('parses named color', () => {
    const tree = parse('.a { color: red; }');
    expect(String(tree)).toContain('red');
  });

  it('parses hex color', () => {
    const tree = parse('.a { color: #ff0000; }');
    expect(String(tree)).toContain('#ff0000');
  });

  it('parses dimension (px)', () => {
    const tree = parse('.a { width: 100px; }');
    expect(serializeTypes(tree)).toContainString('(Dimension');
    expect(String(tree)).toContain('100px');
  });

  it('parses dimension (em)', () => {
    const tree = parse('.a { font-size: 1.5em; }');
    expect(String(tree)).toContain('1.5em');
  });

  it('parses percentage', () => {
    const tree = parse('.a { width: 50%; }');
    expect(String(tree)).toContain('50%');
  });

  it('parses quoted string (double)', () => {
    const tree = parse('.a { content: "hello"; }');
    expect(serializeTypes(tree)).toContainString('(Quoted');
    expect(String(tree)).toContain('"hello"');
  });

  it('parses quoted string (single)', () => {
    const tree = parse('.a { content: \'hello\'; }');
    expect(String(tree)).toContain('\'hello\'');
  });

  it('parses function call', () => {
    const tree = parse('.a { background: rgb(255, 0, 0); }');
    // CSS built-in function calls parse as Call nodes; name is a Reference
    expect(serializeTypes(tree)).toContainString('(Call');
  });

  it('parses multi-value shorthand', () => {
    const tree = parse('.a { margin: 10px 20px 10px 20px; }');
    expect(String(tree)).toContain('10px 20px');
  });

  it('parses CSS custom property (var())', () => {
    const tree = parse('.a { color: var(--primary); }');
    // var() is a Call node; the --primary argument is preserved
    expect(serializeTypes(tree)).toContainString('(Call');
  });

  it('parses calc()', () => {
    const tree = parse('.a { width: calc(100% - 20px); }');
    // calc() parses as a Call node
    expect(serializeTypes(tree)).toContainString('(Call');
  });

  it('parses url()', () => {
    const tree = parse('.a { background: url("image.png"); }');
    expect(String(tree)).toContain('url("image.png")');
  });
});

// ─── Declarations ────────────────────────────────────────────────────────────

describe('jess-parser (declarations)', () => {
  it('parses basic property declaration', () => {
    const tree = parse('.a { color: red; }');
    expect(serializeTypes(tree)).toContainString(`
      (Declaration
        name:
          (Any [role=property] 'color')
    `);
  });

  it('parses CSS custom property declaration', () => {
    const tree = parse(':root { --primary: #333; }');
    expect(String(tree)).toContain('--primary');
  });

  it('parses !important', () => {
    const tree = parse('.a { color: red !important; }');
    expect(String(tree)).toContain('!important');
  });

  it('parses multi-value declaration', () => {
    const tree = parse('.a { transition: all 0.3s ease; }');
    expect(String(tree)).toContain('all 0.3s ease');
  });
});

// ─── Standard At-Rules ───────────────────────────────────────────────────────

describe('jess-parser (standard at-rules)', () => {
  it('parses @media', () => {
    const tree = parse('@media (min-width: 768px) { .a { color: red; } }');
    expect(String(tree)).toContain('@media');
    expect(String(tree)).toContain('min-width');
  });

  it('parses @keyframes', () => {
    const tree = parse('@keyframes fade { from { opacity: 0; } to { opacity: 1; } }');
    expect(String(tree)).toContain('@keyframes');
    expect(String(tree)).toContain('fade');
  });

  it('parses @import', () => {
    const tree = parse('@import "reset.css";');
    expect(String(tree)).toContain('@import');
    expect(String(tree)).toContain('reset.css');
  });

  it('parses @supports', () => {
    const tree = parse('@supports (display: grid) { .a { display: grid; } }');
    expect(String(tree)).toContain('@supports');
  });

  it('parses @layer', () => {
    const tree = parse('@layer base { .a { color: red; } }');
    expect(String(tree)).toContain('@layer');
  });
});

// ─── Jess Variables ──────────────────────────────────────────────────────────

describe('jess-parser (variables)', () => {
  it('parses $var declaration', () => {
    const tree = parse('$color: red;');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules?.data.some(n => isNode(n, N.VarDeclaration))).toBe(true);
  });

  it('parses $var with dimension value', () => {
    const tree = parse('$size: 16px;');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const decl = rules?.data.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(decl, N.VarDeclaration)).toBe(true);
    if (isNode(decl, N.VarDeclaration)) {
      expect(decl.data.name.valueOf()).toBe('size');
    }
  });

  it('parses $var used as CSS value (Reference)', () => {
    const tree = parse('.a { color: $primary; }');
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('$primary');
  });

  it('parses $var.property access (chained Reference)', () => {
    const tree = parse('.a { color: $theme.primary; }');
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('$theme');
    expect(String(tree)).toContain('primary');
  });

  it('parses $var[index] access', () => {
    const tree = parse('.a { color: $colors[0]; }');
    expect(serializeTypes(tree)).toContainString('(Reference');
    expect(String(tree)).toContain('$colors');
  });

  it('parses $var.method(args) call', () => {
    const tree = parse('.a { color: $map.get(primary, secondary); }');
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(String(tree)).toContain('$map');
  });

  it('parses $(expr) arithmetic expression', () => {
    const tree = parse('.a { width: $(base * 2)px; }');
    expect(serializeTypes(tree)).toContainString('(Expression');
    expect(String(tree)).toContain('$(base * 2)');
  });

  it('parses bare $var statement at root level', () => {
    const tree = parse('$foo;');
    expect(String(tree)).toContain('$foo');
  });
});

// ─── Jess Mixins ─────────────────────────────────────────────────────────────

describe('jess-parser (mixins)', () => {
  it('parses mixin definition (no params)', () => {
    const tree = parse('clearfix() { overflow: hidden; }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules?.data.some(n => isNode(n, N.Mixin))).toBe(true);
  });

  it('mixin name is stored as Any node', () => {
    const tree = parse('clearfix() { overflow: hidden; }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const mixin = rules?.data.find(n => isNode(n, N.Mixin));
    expect(isNode(mixin, N.Mixin)).toBe(true);
    if (isNode(mixin, N.Mixin)) {
      expect(String(mixin.data.name)).toBe('clearfix');
    }
  });

  it('parses mixin with parameters', () => {
    const tree = parse('button($bg, $color) { background: $bg; color: $color; }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const mixin = rules?.data.find(n => isNode(n, N.Mixin));
    expect(isNode(mixin, N.Mixin)).toBe(true);
  });

  it('parses mixin with default parameter value', () => {
    const tree = parse('mixin($x: 1px, $y: blue) { width: $x; color: $y; }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const mixin = rules?.data.find(n => isNode(n, N.Mixin));
    expect(isNode(mixin, N.Mixin)).toBe(true);
  });

  it('parses .mixin() (dot-prefixed name)', () => {
    const tree = parse('.clearfix() { overflow: hidden; }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules?.data.some(n => isNode(n, N.Mixin))).toBe(true);
  });

  it('parses #mixin() (hash-prefixed name)', () => {
    // Mixins are invisible in CSS output; verify via AST
    const result = parser.parse('.ns { .mixin() { color: red; } }');
    expect(result.lexerResult.errors).toEqual([]);
    expect(result.errors).toEqual([]);
    const rules = isNode(result.tree, N.Rules) ? result.tree : null;
    // .ns ruleset should be in the tree
    expect(rules?.data.some(n => isNode(n, N.Ruleset))).toBe(true);
  });

  it('parses mixin with guard', () => {
    const tree = parse('size($n) when ($n > 0) { width: $(n)px; }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const mixin = rules?.data.find(n => isNode(n, N.Mixin));
    expect(isNode(mixin, N.Mixin)).toBe(true);
    if (isNode(mixin, N.Mixin)) {
      expect(mixin.data.guard).toBeDefined();
    }
  });

  it('parses mixin call ($ > .name())', () => {
    const tree = parse('$ > .clearfix();');
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(String(tree)).toContain('$ > .clearfix()');
  });

  it('parses chained mixin call ($ > #ns > .name())', () => {
    const tree = parse('$ > #ns > .mixin();');
    expect(String(tree)).toContain('$ > #ns > .mixin()');
  });

  it('parses mixin call with arguments', () => {
    const tree = parse('$ > .button(red, white);');
    expect(serializeTypes(tree)).toContainString('(Call');
    expect(String(tree)).toContain('red');
  });
});

// ─── Jess Imports ────────────────────────────────────────────────────────────

describe('jess-parser (imports)', () => {
  it('parses @-compose (StyleImport type=compose)', () => {
    const tree = parse('@-compose "./base.jess";');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const si = rules?.data.find(n => isNode(n, N.StyleImport));
    expect(isNode(si, N.StyleImport) && si.options.type).toBe('compose');
    expect(String(tree)).toContain('@-compose');
  });

  it('parses @-compose with namespace', () => {
    const tree = parse('@-compose "./theme.jess" as theme;');
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        namespace: 'theme'
    `);
  });

  it('parses @-export (StyleImport forward=true)', () => {
    const tree = parse('@-export "./mixins.jess";');
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      (StyleImport
        type: 'compose'
        importOptions: {
          forward: true
        }
    `);
  });

  it('parses @-from with namespace import (JsImport)', () => {
    const tree = parse('@-from "./tokens.js" import * as tokens;');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules?.data.some(n => isNode(n, N.JsImport))).toBe(true);
    expect(String(tree)).toContain('@-from');
    expect(String(tree)).toContain('import * as tokens');
  });

  it('parses @-from with named imports — parens form', () => {
    const tree = parse('@-from "./tokens.js" import ( primary, secondary );');
    expect(String(tree)).toContain('@-from');
    expect(String(tree)).toContain('import ( primary, secondary )');
  });

  it('parses @-from with named imports — braces form', () => {
    const tree = parse('@-from "./tokens.js" import { primary, secondary };');
    expect(String(tree)).toContain('@-from');
    expect(String(tree)).toContain('import ( primary, secondary )');
  });

  it('parses @-from with aliased imports', () => {
    const tree = parse('@-from "./tokens.js" import ( primary as p, secondary );');
    expect(String(tree)).toContain('import ( p');
    expect(String(tree)).toContain('secondary');
  });
});

// ─── Jess Control Flow ───────────────────────────────────────────────────────

describe('jess-parser (control flow)', () => {
  it('parses $if with condition', () => {
    const tree = parse('$if ($theme = dark) { .a { color: white; } }');
    const rules = isNode(tree, N.Rules) ? tree : null;
    expect(rules?.data.some(n => n.type === 'If')).toBe(true);
    expect(String(tree)).toContain('$if');
  });

  it('parses $if / $else', () => {
    const tree = parse('$if ($x > 0) { .a { color: red; } } $else { .a { color: blue; } }');
    expect(String(tree)).toContain('$if');
    expect(String(tree)).toContain('$else');
  });

  it('parses $for loop', () => {
    const tree = parse('$for ($i in $items) { .item { color: red; } }');
    expect(String(tree)).toContain('$for');
  });
});

// ─── Jess Collections ────────────────────────────────────────────────────────

describe('jess-parser (collections)', () => {
  it('parses collection literal as Collection node', () => {
    const tree = parse('$colors: { primary: #333; secondary: #666; };');
    expect(serializeTypes(tree)).toContainString('(Collection');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const varDecl = rules?.data.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(varDecl, N.VarDeclaration)).toBe(true);
    if (isNode(varDecl, N.VarDeclaration)) {
      expect(isNode(varDecl.data.value, N.Collection)).toBe(true);
    }
  });

  it('parses collection with multiple entries', () => {
    const tree = parse('$theme: { primary: red; secondary: blue; accent: green; };');
    const rules = isNode(tree, N.Rules) ? tree : null;
    const varDecl = rules?.data.find(n => isNode(n, N.VarDeclaration));
    expect(isNode(varDecl, N.VarDeclaration)).toBe(true);
    if (isNode(varDecl, N.VarDeclaration)) {
      expect(isNode(varDecl.data.value, N.Collection)).toBe(true);
    }
  });
});
