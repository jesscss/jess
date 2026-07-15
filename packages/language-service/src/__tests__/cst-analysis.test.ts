import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolKind } from 'vscode-languageserver-types';
import { parseCssCst } from '@jesscss/css-parser';
import { parseCssFn } from '@jesscss/css-parser/jess';
import { cstDocumentSymbols, buildCstIndex } from '../cst-analysis.js';

function symbolsOf(text: string) {
  const doc = TextDocument.create('file:///t.css', 'css', 1, text);
  const { tree } = parseCssCst(text);
  return cstDocumentSymbols(tree, doc);
}

// vscode-types SymbolKind is a value map, not a reverse-mappable numeric enum.
const KIND_NAME: Record<number, string> = {
  [SymbolKind.Class]: 'Class',
  [SymbolKind.Namespace]: 'Namespace',
  [SymbolKind.Field]: 'Field',
  [SymbolKind.Variable]: 'Variable'
};
// Flatten to name/kind pairs for terse assertions.
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
  it('produces the outline for valid CSS', () => {
    const syms = symbolsOf('.a { color: red; } @media screen { .b { x: 1 } }');
    expect(flat(syms)).toEqual([
      'Class .a',
      '  Field color',
      'Namespace @media screen',
      '  Class .b',
      '    Field x'
    ]);
  });

  it('nests rulesets under at-rules and rulesets under rulesets (span containment)', () => {
    const syms = symbolsOf('@media print { .card { .inner { c: 1 } } }');
    expect(flat(syms)).toEqual([
      'Namespace @media print',
      '  Class .card',
      '    Class .inner',
      '      Field c'
    ]);
  });

  // The headline win: the AST path dies on half-typed input; the CST path keeps
  // producing the outline, which is exactly when an editor most needs it.
  it('STILL yields symbols on invalid / half-typed input where the eval AST fails', () => {
    const broken = '.foo { color: '; // unclosed declaration + block

    // AST path: parse does not cleanly succeed → no usable tree for features.
    const ast = parseCssFn(broken);
    const astUnusable = !ast.ok || (ast.errors?.length ?? 0) > 0;
    expect(astUnusable).toBe(true);

    // CST path: the tolerant tree still carries the `.foo` ruleset.
    const syms = symbolsOf(broken);
    expect(flat(syms)).toContain('Class .foo');
  });

  it('buildCstIndex.findNodeAtOffset resolves the smallest covering node', () => {
    const text = '.a { color: red }';
    const { tree } = parseCssCst(text);
    const idx = buildCstIndex(tree);
    const at = idx.findNodeAtOffset(text.indexOf('red'));
    expect(at).not.toBeNull();
    // The tightest node over `red` is a value token, well inside the declaration.
    expect(Number(at!.span.start)).toBeGreaterThanOrEqual(text.indexOf('color'));
  });
});
