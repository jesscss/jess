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
 * SPAN MODEL: the incremental `ParseDoc` CST stores PARENT-RELATIVE spans (for
 * cheap `.edit()`), so a node's absolute offset is `parentAbsStart +
 * node.span.start`. `buildCstIndex` accumulates that once and hands every
 * consumer absolute offsets via `spanOf`.
 */
import type { CssCstChild, CssCstNode } from '@jesscss/css-parser';
import { SymbolKind, type DocumentSymbol, type Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export type CstIndexEntry = { node: CssCstNode; start: number; end: number };

/** Position → smallest-covering CST node, with absolute spans. Mirrors the AST
 * `buildJessIndex`, but over the tolerant CST. */
export type CstIndex = {
  nodes: CstIndexEntry[];
  /** Absolute [start,end) of a node, resolved from parent-relative spans. */
  spanOf(node: CssCstNode): { start: number; end: number } | undefined;
  findNodeAtOffset(offset: number): CssCstNode | null;
};

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

/** Depth-first collect, accumulating parent-relative spans into absolute
 * offsets, sorted by position. */
export function buildCstIndex(root: CssCstNode): CstIndex {
  const out: CstIndexEntry[] = [];
  const abs = new Map<CssCstNode, [number, number]>();
  const walk = (node: CssCstNode, base: number) => {
    const s = base + Number(node.span.start);
    const e = base + Number(node.span.end);
    abs.set(node, [s, e]);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      out.push({ node, start: s, end: e });
    }
    for (const child of node.children) {
      if (isCstNode(child)) {
        walk(child, s);
      }
    }
  };
  walk(root, 0);
  out.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  return {
    nodes: out,
    spanOf(node) {
      const a = abs.get(node);
      return a ? { start: a[0], end: a[1] } : undefined;
    },
    findNodeAtOffset(offset) {
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

// Grammar types (raw `grammarType`, shared across css/less/scss/jess) grouped by
// the symbol they yield — matching the AST-based `getDocumentSymbols` exactly.
const SELECTOR_TYPES = new Set(['SelectorList', 'ComplexSelector', 'CompoundSelector', 'InterpolatedSelector', 'BasicSelector']);
const ATRULE_TYPES = new Set(['AtRuleBlock', 'AtRuleStatement', 'UnknownAtRuleBlock', 'QueryAtRuleBlock']);
const MIXIN_TYPES = new Set(['Mixin', 'MixinDefinition']);
const FUNC_TYPES = new Set(['Func', 'FunctionDefinition']);

function firstSelectorChild(node: CssCstNode): CssCstNode | null {
  for (const c of node.children) {
    if (c._tag === 'node' && SELECTOR_TYPES.has(c.grammarType)) {
      return c;
    }
  }
  return null;
}

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
 * CST-grounded document outline. Same symbol set + hierarchy as the AST-based
 * `getDocumentSymbols` (Ruleset→Class, at-rule→Namespace, VarDeclaration→
 * Variable, Mixin/Func→Function), but sourced from the tolerant CST so a
 * partial/invalid document still yields its structure. Names are sliced
 * losslessly from source (whitespace lives in trivia, not leaves).
 */
export function cstDocumentSymbols(root: CssCstNode, doc: TextDocument): DocumentSymbol[] {
  const src = doc.getText();
  const index = buildCstIndex(root);
  const result: DocumentSymbol[] = [];
  const parents: Array<[DocumentSymbol, Range]> = [];

  const sliceOf = (node: CssCstNode): string => {
    const s = index.spanOf(node);
    return s ? src.slice(s.start, s.end).trim() : '';
  };

  const add = (name: string, kind: SymbolKind, node: CssCstNode, nameNode: CssCstNode | null, hasBody: boolean) => {
    const span = index.spanOf(node);
    if (!span) {
      return;
    }
    const range = toRange(doc, span.start, span.end);
    let selectionRange: Range = { start: range.start, end: range.start };
    const nameSpan = nameNode ? index.spanOf(nameNode) : undefined;
    if (nameSpan) {
      const nr = toRange(doc, nameSpan.start, nameSpan.end);
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
    if (gt === 'Ruleset') {
      const sel = firstSelectorChild(node);
      const name = sel ? sliceOf(sel) : sliceOf(node).split('{')[0]!.trim();
      add(name || 'ruleset', SymbolKind.Class, node, sel, true);
    } else if (ATRULE_TYPES.has(gt)) {
      const name = sliceOf(node).split(/[{;]/)[0]!.trim();
      add(name || 'at-rule', SymbolKind.Namespace, node, null, true);
    } else if (gt === 'VarDeclaration') {
      const name = sliceOf(node).split(':')[0]!.trim();
      add(name || 'variable', SymbolKind.Variable, node, null, false);
    } else if (MIXIN_TYPES.has(gt)) {
      const name = sliceOf(node).split(/[({]/)[0]!.trim();
      add(name || 'mixin', SymbolKind.Function, node, null, true);
    } else if (FUNC_TYPES.has(gt)) {
      const name = sliceOf(node).split(/[({]/)[0]!.trim();
      add(name || 'function', SymbolKind.Function, node, null, true);
    }
  }
  return result;
}
