import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver-types';
import { parseLessDoc } from '@jesscss/less-parser';
import { parseScssDoc } from '@jesscss/scss-parser';
import { createEngine } from '../engine.js';
import { cstSemanticTokens, cstVariableNames, cstDeclaredSymbols } from '../cst-syntactic.js';

// Decode the LSP delta-encoded semantic-token array into absolute tokens.
function decode(data: number[], types: string[]): Array<{ line: number; char: number; length: number; type: string }> {
  const out: Array<{ line: number; char: number; length: number; type: string }> = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const dl = data[i]!;
    const dc = data[i + 1]!;
    if (dl === 0) {
      char += dc;
    } else {
      line += dl;
      char = dc;
    }
    out.push({ line, char, length: data[i + 2]!, type: types[data[i + 3]!] ?? 'unknown' });
  }
  return out;
}

const TYPES = ['comment', 'string', 'keyword', 'enumMember', 'number', 'operator', 'function', 'variable', 'property', 'type', 'class', 'namespace'];

function lessDoc(content: string): TextDocument {
  return TextDocument.create('file:///t.less', 'less', 1, content);
}
function scssDoc(content: string): TextDocument {
  return TextDocument.create('file:///t.scss', 'scss', 1, content);
}

describe('cst-syntactic pure functions', () => {
  describe('cstSemanticTokens', () => {
    it('classifies variable / number / string tokens off the CST', () => {
      const doc = lessDoc('@primary: red;\n.a { width: 10px; content: "x"; color: @primary; }');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      const kinds = new Set(tokens.map(t => t.type));
      expect(kinds.has('variable')).toBe(true);
      expect(kinds.has('number')).toBe(true);
      expect(kinds.has('string')).toBe(true);
    });

    it('classifies the @import keyword as a namespace token', () => {
      const doc = lessDoc('@import "a.less";');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      expect(tokens.some(t => t.type === 'namespace' && t.char === 0 && t.length === '@import'.length)).toBe(true);
    });

    it('splits an interpolated string into string + variable pieces', () => {
      const doc = lessDoc('@import "a-@{theme}-b.less";');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      expect(tokens.filter(t => t.type === 'string').length).toBeGreaterThanOrEqual(3);
      expect(tokens.filter(t => t.type === 'variable').length).toBeGreaterThanOrEqual(1);
    });

    it('emits comment tokens (trivia recovered from source)', () => {
      const doc = lessDoc('/* header */\n.a { color: red; }');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      expect(tokens.some(t => t.type === 'comment' && t.line === 0)).toBe(true);
    });

    it('BUG 3: a leading Less @var is NOT mis-tokenized as a namespace keyword', () => {
      // The `Stylesheet`/`VarDeclaration` slices START with `@primary`, but they
      // are not at-rules — no `namespace` keyword token should be emitted for a
      // file that contains no at-rule.
      const doc = lessDoc('@primary: red;\n.a { color: @primary; }');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      expect(tokens.filter(t => t.type === 'namespace')).toHaveLength(0);
      // The declaration name IS a variable, and the reference IS a variable.
      expect(tokens.filter(t => t.type === 'variable').length).toBeGreaterThanOrEqual(1);
    });

    it('BUG 3: a genuine @import keyword is still a namespace token (allow-list)', () => {
      const doc = lessDoc('@primary: red;\n@import "a.less";');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      // Exactly one namespace token — the `@import`, not the `@primary`.
      const ns = tokens.filter(t => t.type === 'namespace');
      expect(ns).toHaveLength(1);
      expect(ns[0]!.line).toBe(1);
      expect(ns[0]!.length).toBe('@import'.length);
    });

    it('BUG 1: SCSS @mixin/@include get a namespace keyword + a function name token', () => {
      const doc = scssDoc('@mixin foo($a) { color: $a; }\n.x { @include foo(red); }');
      const tokens = decode(cstSemanticTokens(parseScssDoc(doc.getText()).tree, doc, 'scss'), TYPES);
      // `@mixin` and `@include` keywords → namespace.
      expect(tokens.filter(t => t.type === 'namespace').length).toBeGreaterThanOrEqual(2);
      // Each `foo` name → function (the def name on line 0, the call name on line 1).
      const fnTokens = tokens.filter(t => t.type === 'function');
      expect(fnTokens.some(t => t.line === 0)).toBe(true);
      expect(fnTokens.some(t => t.line === 1)).toBe(true);
    });

    it('TOLERANCE: still classifies tokens on an unclosed block', () => {
      // Half-typed: the block never closes. The tolerant CST still yields the
      // variable / number tokens.
      const doc = lessDoc('.a { width: 10px; color: @primary');
      const tokens = decode(cstSemanticTokens(parseLessDoc(doc.getText()).tree, doc, 'less'), TYPES);
      const kinds = new Set(tokens.map(t => t.type));
      expect(kinds.has('number')).toBe(true);
      expect(kinds.has('variable')).toBe(true);
    });
  });

  describe('cstVariableNames', () => {
    it('collects declared Less variable names (bare)', () => {
      const doc = lessDoc('@primary: red;\n@secondary: blue;\n.a { color: @primary; }');
      expect(cstVariableNames(parseLessDoc(doc.getText()).tree, doc)).toEqual(['primary', 'secondary']);
    });

    it('collects declared SCSS variable names (bare)', () => {
      const doc = scssDoc('$primary: red;\n$secondary: blue;');
      expect(cstVariableNames(parseScssDoc(doc.getText()).tree, doc)).toEqual(['primary', 'secondary']);
    });

    it('TOLERANCE: collects names from an unclosed block', () => {
      const doc = lessDoc('@primary: red;\n.a { color: @pr');
      expect(cstVariableNames(parseLessDoc(doc.getText()).tree, doc)).toContain('primary');
    });
  });

  describe('cstDeclaredSymbols', () => {
    it('collects declared variables and mixins (bare identifiers)', () => {
      const doc = lessDoc('@primary: red;\n.button() { color: red; }\n.a { .button(); }');
      const { vars, mixins } = cstDeclaredSymbols(parseLessDoc(doc.getText()).tree, doc);
      expect(vars.has('primary')).toBe(true);
      expect(mixins.has('button')).toBe(true);
    });

    it('BUG 1: collects an SCSS @mixin as a declared mixin (bare name)', () => {
      const doc = scssDoc('$primary: red;\n@mixin foo($a) { color: $a; }\n.x { @include foo(red); }');
      const { vars, mixins } = cstDeclaredSymbols(parseScssDoc(doc.getText()).tree, doc);
      expect(vars.has('primary')).toBe(true);
      expect(mixins.has('foo')).toBe(true);
    });
  });
});

describe('engine syntactic features are CST-grounded (tolerance)', () => {
  it('getSemanticTokens returns tokens for a half-typed document', () => {
    const engine = createEngine();
    const uri = 'file:///half.less';
    // Missing closing brace: an invalid document mid-edit.
    engine.open(uri, 'less', 1, '@primary: red;\n.a { color: @primary');
    const { data } = engine.getSemanticTokens(uri);
    const tokens = decode(data, TYPES);
    expect(tokens.some(t => t.type === 'variable')).toBe(true);
  });

  it('getCompletions suggests declared variables inside an unclosed block', () => {
    const engine = createEngine();
    const uri = 'file:///half2.less';
    engine.open(uri, 'less', 1, '@primary: red;\n.a { color: @pr');
    const completions = engine.getCompletions(uri, Position.create(1, 14));
    expect(completions.items.map(i => i.label)).toContain('@primary');
  });

  it('getSemanticTokens survives an incremental edit into invalid syntax', () => {
    const engine = createEngine();
    const uri = 'file:///edit.less';
    engine.open(uri, 'less', 1, '@primary: red;\n.a { color: @primary; }');
    // Delete the trailing ` }` so the block is now unclosed.
    engine.change(uri, 2, '@primary: red;\n.a { color: @primary;');
    const { data } = engine.getSemanticTokens(uri);
    expect(decode(data, TYPES).some(t => t.type === 'variable')).toBe(true);
  });
});
