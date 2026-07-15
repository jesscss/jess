/**
 * CST-grounded analysis (Option B).
 *
 * The language service historically grounds analysis in the eval AST
 * (`parseCssFn` → `buildJessIndex`), which is non-incremental and — the reason
 * this module exists — dies on invalid input (a failed parse yields no tree, so
 * NO features while you're mid-edit). The incremental, lossless, error-tolerant
 * CST (`parseCssDoc` / `.edit()`) is the correct foundation for syntactic
 * features; the eval AST should be reached for only by genuinely-evaluated ones.
 *
 * This module is the first slice: a position index over the CST and a
 * CST-grounded `getDocumentSymbols`, so the outline survives half-typed code.
 */
import type { CssCstChild, CssCstNode } from '@jesscss/css-parser';
import { SymbolKind, type DocumentSymbol, type Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export type CstIndexEntry = { node: CssCstNode; start: number; end: number };

/** Position → smallest-covering CST node. Mirrors `buildJessIndex.findNodeAtOffset`. */
export type CstIndex = {
  nodes: CstIndexEntry[];
  findNodeAtOffset(offset: number): CssCstNode | null;
};

function isNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

/** Depth-first collect of every CST node with a span, sorted by position. */
export function buildCstIndex(root: CssCstNode): CstIndex {
  const out: CstIndexEntry[] = [];
  const stack: CssCstNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const s = Number(node.span.start);
    const e = Number(node.span.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      out.push({ node, start: s, end: e });
    }
    for (const child of node.children) {
      if (isNode(child)) {
        stack.push(child);
      }
    }
  }
  out.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  return {
    nodes: out,
    findNodeAtOffset(offset: number) {
      let best: CstIndexEntry | null = null;
      for (const entry of out) {
        if (entry.start <= offset && offset <= entry.end) {
          if (!best || (entry.end - entry.start) <= (best.end - best.start)) {
            best = entry;
          }
        }
      }
      return best?.node ?? null;
    }
  };
}

/** Lossless source slice over a node's span — preserves whitespace (which lives
 * in trivia, not leaves), so `@media print` and `.a .b` keep their spaces. */
function srcOf(src: string, node: CssCstNode): string {
  return src.slice(Number(node.span.start), Number(node.span.end)).trim();
}

function firstChildOfType(node: CssCstNode, grammarTypes: ReadonlySet<string>): CssCstNode | null {
  for (const c of node.children) {
    if (c._tag === 'node' && grammarTypes.has(c.grammarType)) {
      return c;
    }
  }
  return null;
}

const SELECTOR_TYPES = new Set(['SelectorList', 'ComplexSelector', 'CompoundSelector', 'InterpolatedSelector']);
const RULESET_TYPES = new Set(['Ruleset']);
const ATRULE_TYPES = new Set(['AtRuleBlock', 'AtRuleStatement', 'UnknownAtRuleBlock', 'QueryAtRuleBlock']);
const DECL_TYPES = new Set(['Declaration', 'CustomDeclaration']);
const BODY_TYPES = new Set([...RULESET_TYPES, ...ATRULE_TYPES]);

function toRange(doc: TextDocument, start: number, end: number): Range {
  return { start: doc.positionAt(start), end: doc.positionAt(end) };
}

function containsRange(outer: Range, inner: Range): boolean {
  const a = outer.start, b = outer.end, c = inner.start, d = inner.end;
  const ge = (p: Range['start'], q: Range['start']) => p.line > q.line || (p.line === q.line && p.character >= q.character);
  const le = (p: Range['start'], q: Range['start']) => p.line < q.line || (p.line === q.line && p.character <= q.character);
  return le(a, c) && ge(b, d);
}

/**
 * CST-grounded document outline. Walks the position-sorted CST index building a
 * span-containment hierarchy — identical shape to the AST-based
 * `getDocumentSymbols`, but sourced from the tolerant CST so a partial/invalid
 * document still yields its rulesets and at-rules.
 */
export function cstDocumentSymbols(root: CssCstNode, doc: TextDocument): DocumentSymbol[] {
  const src = doc.getText();
  const index = buildCstIndex(root);
  const result: DocumentSymbol[] = [];
  const parents: Array<[DocumentSymbol, Range]> = [];

  const add = (name: string, kind: SymbolKind, node: CssCstNode, nameNode: CssCstNode | null, hasBody: boolean) => {
    const range = toRange(doc, Number(node.span.start), Number(node.span.end));
    let selectionRange: Range = { start: range.start, end: range.start };
    if (nameNode) {
      const nr = toRange(doc, Number(nameNode.span.start), Number(nameNode.span.end));
      if (containsRange(range, nr)) {
        selectionRange = nr;
      }
    }
    const entry: DocumentSymbol = { name: name || '<undefined>', kind, range, selectionRange, children: [] };

    let top = parents.length ? parents[parents.length - 1] : null;
    while (top && !containsRange(top[1], range)) {
      parents.pop();
      top = parents.length ? parents[parents.length - 1] : null;
    }
    if (top) {
      top[0].children!.push(entry);
    } else {
      result.push(entry);
    }
    if (hasBody) {
      parents.push([entry, range]);
    }
  };

  for (const { node } of index.nodes) {
    const gt = node.grammarType;
    if (RULESET_TYPES.has(gt)) {
      const sel = firstChildOfType(node, SELECTOR_TYPES);
      const name = sel ? srcOf(src, sel) : srcOf(src, node).split('{')[0]!.trim();
      add(name || 'ruleset', SymbolKind.Class, node, sel, true);
    } else if (ATRULE_TYPES.has(gt)) {
      const name = srcOf(src, node).split(/[{;]/)[0]!.trim();
      add(name || 'at-rule', SymbolKind.Namespace, node, null, BODY_TYPES.has(gt));
    } else if (DECL_TYPES.has(gt)) {
      const prop = srcOf(src, node).split(':')[0]!.trim();
      // $x:/@x: variable definitions read as Variables; ordinary props as Fields.
      const kind = /^[$@]/.test(prop) ? SymbolKind.Variable : SymbolKind.Field;
      add(prop || 'declaration', kind, node, null, false);
    }
  }
  return result;
}
