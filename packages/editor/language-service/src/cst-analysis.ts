/**
 * CST-grounded analysis (Option B).
 *
 * The language service historically grounds analysis in the eval AST
 * (a legacy CSS AST parser → `buildJessIndex`), which is non-incremental and — the reason
 * this module exists — dies on invalid input (a failed parse yields no tree, so
 * NO features while you're mid-edit). The incremental, lossless, error-tolerant
 * CST (`parseCssDoc` / `.edit()`) is the correct foundation for syntactic
 * features; the eval AST should be reached for only by genuinely-evaluated ones.
 *
 * SPAN MODEL: parser CST nodes and leaves carry absolute source spans. The
 * index (`buildCstIndex`, owned by `@jesscss/diagnostics-core`) validates and
 * memoizes those offsets once per tree, so feature code can stay positional and
 * avoid per-feature tree walks.
 */
import type { CssCstChild, CssCstNode } from '@jesscss/css-parser';
import { buildCstIndex, type CstIndex, type CstIndexEntry } from '@jesscss/diagnostics-core';
import { SymbolKind, FoldingRangeKind, Position, type DocumentSymbol, type FoldingRange, type Range, type SelectionRange } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

export function cstHasTag(node: CssCstNode, tag: string): boolean {
  return node.tags?.includes(tag) === true;
}

export function cstChildrenOf(node: CssCstNode): readonly CssCstChild[] {
  return node.rules;
}

/*
 * Grammar types (raw `grammarType`, shared across css/less/scss/jess) grouped by
 * the symbol they yield — matching the AST-based `getDocumentSymbols` exactly.
 */
const SELECTOR_TYPES = new Set([
  'SelectorList',
  'SelectorBranch',
  'ComplexSelector',
  'RelativeSelector',
  'CompoundSelector',
  'InterpolatedSelector',
  'BasicSelector',
  'ClassSelector',
  'IdSelector',
  'TypeSelector',
  'UniversalSelector'
]);
const LESS_SELECTOR_TYPES = new Set(['SelectorBranch', 'CompoundSelector']);
const ATRULE_TYPES = new Set(['AtRuleBlock', 'AtRuleStatement', 'UnknownAtRuleBlock', 'QueryAtRuleBlock']);

export function cstIsSelector(node: CssCstNode): boolean {
  return cstHasTag(node, 'Selector') || SELECTOR_TYPES.has(node.grammarType);
}

/*
 * Mixin DEFINITIONS: the shared `MixinDefinition` label in Less/Jess and the
 * SCSS `MixinDefinitionRule` (`@mixin foo`) label.
 */
const MIXIN_TYPES = new Set(['MixinDefinition', 'MixinDefinitionRule']);
const MIXIN_STATEMENT_TYPE = 'MixinStatement';

// Function DEFINITIONS: SCSS `@function`.
const FUNC_TYPES = new Set(['FunctionRule']);

function firstSelectorChild(node: CssCstNode): CssCstNode | null {
  for (const c of cstChildrenOf(node)) {
    if (c._tag === 'node' && cstIsSelector(c)) {
      return c;
    }
  }
  return null;
}

function hasDescendantOfType(node: CssCstNode, grammarType: string): boolean {
  for (const child of cstChildrenOf(node)) {
    if (child._tag !== 'node') {
      continue;
    }
    if (child.grammarType === grammarType || hasDescendantOfType(child, grammarType)) {
      return true;
    }
  }
  return false;
}

function isMixinDefinitionNode(node: CssCstNode): boolean {
  return MIXIN_TYPES.has(node.grammarType)
    || (node.grammarType === MIXIN_STATEMENT_TYPE && hasDescendantOfType(node, 'MixinDefinition'));
}

function onlyTriviaBetween(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      return false;
    }
  }
  return true;
}

function previousLessSelector(index: CstIndex, source: string, node: CssCstNode): CssCstNode | null {
  const span = index.spanOf(node);
  if (!span) {
    return null;
  }
  let best: CstIndexEntry | null = null;
  for (const entry of index.nodes) {
    if (
      !LESS_SELECTOR_TYPES.has(entry.node.grammarType)
      || entry.end > span.start
      || !onlyTriviaBetween(source, entry.end, span.start)
    ) {
      continue;
    }
    if (
      best === null
      || entry.end > best.end
      || (entry.end === best.end && entry.start < best.start)
      || (entry.end === best.end && entry.start === best.start && entry.node.grammarType === 'SelectorBranch')
    ) {
      best = entry;
    }
  }
  return best?.node ?? null;
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
 * `getDocumentSymbols` (Ruleset→Class, at-rule→Namespace, variable declaration→
 * Variable, mixin/function definition→Function), but sourced from the tolerant CST so a
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
    if (gt === 'Ruleset' || gt === 'NestedRuleset') {
      const sel = firstSelectorChild(node) ?? previousLessSelector(index, src, node);
      const name = sel ? sliceOf(sel) : sliceOf(node).split('{')[0]!.trim();
      add(name || 'ruleset', SymbolKind.Class, node, sel, true);
    } else if (ATRULE_TYPES.has(gt)) {
      const name = sliceOf(node).split(/[{;]/)[0]!.trim();
      add(name || 'at-rule', SymbolKind.Namespace, node, null, true);
    } else if (gt === 'VariableDeclaration') {
      const name = sliceOf(node).split(':')[0]!.trim();
      add(name || 'variable', SymbolKind.Variable, node, null, false);
    } else if (isMixinDefinitionNode(node)) {
      const sel = previousLessSelector(index, src, node);
      const raw = sel ? sliceOf(sel) : sliceOf(node);
      if (!sel && !raw.trim().startsWith('@')) {
        continue;
      }
      const name = raw.split(/[({]/)[0]!.trim();
      add(name || 'mixin', SymbolKind.Function, node, sel, true);
    } else if (FUNC_TYPES.has(gt)) {
      const name = sliceOf(node).split(/[({]/)[0]!.trim();
      add(name || 'function', SymbolKind.Function, node, null, true);
    }
  }
  return result;
}

const FOLD_TYPES = new Set(['Ruleset', 'NestedRuleset', ...ATRULE_TYPES, ...MIXIN_TYPES, ...FUNC_TYPES]);

/** CST-grounded folding: every multi-line structural block. Matches the AST
 * folding set, sourced from the tolerant CST. */
export function cstFoldingRanges(root: CssCstNode, doc: TextDocument): FoldingRange[] {
  const index = buildCstIndex(root);
  const src = doc.getText();
  const out: FoldingRange[] = [];
  const seen = new Set<string>();
  for (const { node, start, end } of index.nodes) {
    if (!FOLD_TYPES.has(node.grammarType) && !isMixinDefinitionNode(node)) {
      continue;
    }
    if (MIXIN_TYPES.has(node.grammarType)) {
      const spanText = src.slice(start, end).trim();
      if (!spanText.startsWith('@') && previousLessSelector(index, src, node) === null) {
        continue;
      }
    }
    const s = doc.positionAt(start);
    const e = doc.positionAt(end);
    if (e.line <= s.line) {
      continue;
    }
    const key = `${s.line}:${e.line}:${node.grammarType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ startLine: s.line, endLine: e.line, kind: FoldingRangeKind.Region });
    if (out.length >= 2000) {
      break;
    }
  }
  out.sort((a, b) => (a.startLine - b.startLine) || (a.endLine - b.endLine));
  return out;
}

/** CST-grounded selection ranges: the nested chain of containing nodes at each
 * position. Purely positional — no node-type knowledge — so it's a direct read
 * off the CST index's absolute spans. */
export function cstSelectionRanges(root: CssCstNode, doc: TextDocument, positions: Position[]): SelectionRange[] {
  const index = buildCstIndex(root);

  const rangesForOffset = (offset: number): Range[] => {
    const containing = index.nodes.filter(e => e.start <= offset && offset <= e.end);
    containing.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const out: Range[] = [];
    const seen = new Set<string>();
    for (const c of containing) {
      const r: Range = { start: doc.positionAt(c.start), end: doc.positionAt(c.end) };
      const key = `${r.start.line}:${r.start.character}:${r.end.line}:${r.end.character}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(r);
      if (out.length >= 50) {
        break;
      }
    }
    return out;
  };

  const toChain = (ranges: Range[]): SelectionRange => {
    if (ranges.length === 0) {
      const zero = Position.create(0, 0);
      return { range: { start: zero, end: zero } };
    }
    let current: SelectionRange = { range: ranges[ranges.length - 1]! };
    for (let i = ranges.length - 2; i >= 0; i--) {
      current = { range: ranges[i]!, parent: current };
    }
    return current;
  };

  return positions.map(pos => toChain(rangesForOffset(doc.offsetAt(pos))));
}
