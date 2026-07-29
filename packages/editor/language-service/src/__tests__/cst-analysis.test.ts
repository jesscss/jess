import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolKind } from 'vscode-languageserver-types';
import { parseCssDoc } from '@jesscss/css-parser';
import { parseLessDoc } from '@jesscss/less-parser/cst';
import { parseScssDoc } from '@jesscss/scss-parser/cst';
import { cstDocumentSymbols, buildCstIndex } from '../cst-analysis.js';

function symbolsOf(text: string) {
  const doc = TextDocument.create('file:///t.css', 'css', 1, text);

  const tree = parseCssDoc(text).tree;
  return cstDocumentSymbols(tree, doc);
}

function lessSymbolsOf(text: string) {
  const doc = TextDocument.create('file:///t.less', 'less', 1, text);
  return cstDocumentSymbols(parseLessDoc(text).tree, doc);
}

function scssSymbolsOf(text: string) {
  const doc = TextDocument.create('file:///t.scss', 'scss', 1, text);
  return cstDocumentSymbols(parseScssDoc(text).tree, doc);
}

// vscode-types SymbolKind is a value map, not a reverse-mappable numeric enum.
const KIND_NAME: Record<number, string> = {
  [SymbolKind.Class]: 'Class',
  [SymbolKind.Namespace]: 'Namespace',
  [SymbolKind.Variable]: 'Variable',
  [SymbolKind.Function]: 'Function'
};
function flat(syms: ReturnType<typeof cstDocumentSymbols>, depth = 0): string[] {
  const out: string[] = [];
  for (const s of syms) {
    out.push(`${'  '.repeat(depth)}${KIND_NAME[s.kind] ?? s.kind} ${s.name}`);
    if (s.children?.length) {
      out.push(...flat(s.children, depth + 1));
    }
  }
  return out;
}

describe('CST-grounded document symbols (Option B slice)', () => {
  // Matches the AST getDocumentSymbols set: rulesets + at-rules (no plain-decl fields).
  it('produces the outline for valid CSS with nesting', () => {
    const syms = symbolsOf('.a { color: red; } @media screen { .b { x: 1 } }');
    expect(flat(syms)).toEqual([
      'Class .a',
      'Namespace @media screen',
      '  Class .b'
    ]);
  });

  it('nests rulesets under at-rules and rulesets under rulesets (span containment)', () => {
    const syms = symbolsOf('@media print { .card { .inner { c: 1 } } }');
    expect(flat(syms)).toEqual([
      'Namespace @media print',
      '  Class .card',
      '    Class .inner'
    ]);
  });

  it('yields symbols on invalid / half-typed CSS', () => {
    const broken = '.foo { color: '; // unclosed declaration + block
    const syms = symbolsOf(broken);
    expect(flat(syms)).toContain('Class .foo');
  });

  /*
   * BUG 2: Less mixin definitions parse as `MixinOrQualifiedRule`, which the
   * outline dropped (not `Ruleset`, not in MIXIN_TYPES). They must appear as
   * Function symbols; a plain ruleset stays a Class; a bodyless mixin CALL is NOT
   * a definition and is omitted.
   */
  it('lists Less mixin definitions as Function symbols (plain rulesets stay Class)', () => {
    const syms = lessSymbolsOf('.e() { width: 1px; }\n.f(@x) { color: @x; }\n.g { color: red; }\n.h();');
    expect(flat(syms)).toEqual([
      'Function .e',
      'Function .f',
      'Class .g'
    ]);
  });

  /*
   * BUG 1: SCSS `@mixin` / `@function` parse as canonical callable rules,
   * which were absent from MIXIN_TYPES/FUNC_TYPES, so the outline dropped them.
   */
  it('lists SCSS @mixin and @function definitions as Function symbols', () => {
    const syms = scssSymbolsOf('@mixin foo($a) { color: $a; }\n@function bar($n) { @return $n; }\n.g { color: red; }');
    const lines = flat(syms);
    expect(lines).toContain('Function @mixin foo');
    expect(lines).toContain('Function @function bar');
    expect(lines).toContain('Class .g');
  });

  it('buildCstIndex is memoized by tree identity (M4: one build per doc version)', () => {
    const tree = parseCssDoc('.a { x: 1 }').tree;
    const a = buildCstIndex(tree);
    const b = buildCstIndex(tree);
    expect(a).toBe(b); // same tree -> same cached index, no rebuild
    const other = buildCstIndex(parseCssDoc('.b { y: 2 }').tree);
    expect(other).not.toBe(a); // a new tree (a new edit) yields a fresh index
  });

  it('buildCstIndex exposes absolute CST spans', () => {
    const text = '@media screen { .a { color: red } }';
    const idx = buildCstIndex(parseCssDoc(text).tree);
    const at = idx.findNodeAtOffset(text.indexOf('.a'));
    expect(at).not.toBeNull();
    const span = idx.spanOf(at!)!;

    // The node over `.a` must sit where `.a` actually is.
    expect(text.slice(span.start, span.end)).toContain('.a');
  });
});
