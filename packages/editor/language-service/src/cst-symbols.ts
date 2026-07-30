/**
 * CST-grounded SYMBOL RESOLUTION (Option B).
 *
 * Pure functions that resolve variable / mixin symbols off the tolerant,
 * incremental CST — the foundation for go-to-definition, find-references, and
 * rename. Historically these ran on the eval AST (`Reference` / `VarDeclaration`
 * / `Mixin` node types + `options.type`), which dies on invalid input. The CST
 * survives half-typed documents, so these features keep working mid-edit.
 *
 * SYMBOL SHAPES (raw `grammarType`, confirmed empirically across less/scss):
 *   - variable reference   → `Reference` / `VariableReference` (`@primary` / `$primary`)
 *   - variable declaration → `VarDeclaration` / `VariableDeclaration` (`@primary: red;`)
 *   - mixin reference      → `SelectorBranch` + `MixinCall` (`.button();`) / `MixinCall` (`@include foo`)
 *   - mixin definition     → `SelectorBranch` + `MixinDefinition`
 *                            (`.button() { … }`) / `MixinDefinition` (`@mixin foo`)
 * A plain selector rule is `SelectorBranch` + `Ruleset`, so a Less mixin is
 * distinguished by the sibling body node after the selector.
 *
 * SPAN MODEL: CST nodes carry absolute spans. Identifiers are sliced from
 * source text over those spans (whitespace lives in trivia, not leaves).
 */
import type { CssCstNode } from '@jesscss/css-parser';
import type { Location, Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { buildCstIndex, type CstIndexEntry } from './cst-analysis.js';

const VAR_REF_TYPES = new Set(['Reference', 'VariableReference']);
const VAR_DECL_TYPES = new Set(['VarDeclaration', 'VariableDeclaration']);

// A mixin CALL site: Less/Jess selector + `MixinCall` / SCSS `@include foo`.
const MIXIN_REF_TYPES = new Set(['MixinCall']);

/*
 * A mixin/function DEFINITION: shared Less/Jess `MixinDefinition`, SCSS
 * `@mixin foo`, and SCSS `@function bar`.
 * `@include`/`@mixin` are DISTINCT grammarTypes (call vs def); `mixinNameOf`
 * strips the differing keyword so both resolve to the same bare `matchName`.
 */
const MIXIN_DEF_TYPES = new Set(['MixinDefinition', 'FunctionRule']);
const MIXIN_SELECTOR_TYPES = new Set(['SelectorBranch', 'Compound']);

/** A variable/mixin symbol resolved from a cursor position. */
export type CstSymbol = {
  kind: 'variable' | 'mixin';

  /** `reference` = a use site, `definition` = the declaration. */
  role: 'reference' | 'definition';

  /** Name used for cross-site matching: bare (no sigil) for variables, the
   * selector-with-combinator (no parens) for mixins — mirrors the AST matcher. */
  matchName: string;

  /** Bare identifier to narrow to inside a span (sigil / combinator / parens
   * stripped) — what rename rewrites and prepareRename echoes as placeholder. */
  refineIdent: string;
};

/** Target shape the def/reference collectors match against. */
export type CstSymbolTarget = Pick<CstSymbol, 'kind' | 'matchName'>;

function toRange(doc: TextDocument, start: number, end: number): Range {
  return {
    start: doc.positionAt(Math.max(0, start)),
    end: doc.positionAt(Math.max(Math.max(0, start), end))
  };
}

/** Bare variable name from a `Reference`/`VariableReference` (`@primary`) or variable declaration
 * (`@primary: red;`) slice: take the head before any `:`, drop the sigil. */
function varNameOf(slice: string): string {
  const head = slice.split(':')[0] ?? slice;
  return head.trim().replace(/^[$@]/, '').trim();
}

/** Cross-site match name for a mixin/function. For Less this is the
 * selector-with-combinator (`.button`) from a `MixinCall`/`MixinDefinition`;
 * for SCSS it is the bare name after the `@mixin`/`@include`/`@function` keyword
 * (`foo`), so a `@mixin foo` def and its `@include foo` calls share one name. */
function mixinNameOf(slice: string): string {
  const head = slice.split(/[({]/)[0]!.trim();
  return head.replace(/^@(?:mixin|include|function)\s+/, '').trim();
}

/** Strip a mixin name to its bare identifier (drop leading `.`/`#`, trailing `()`). */
function mixinIdentOf(name: string): string {
  return name.replace(/^[.#]/, '').replace(/\(\s*\)\s*$/, '').trim();
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

function previousMixinSelector(entries: readonly CstIndexEntry[], source: string, start: number): CstIndexEntry | null {
  let best: CstIndexEntry | null = null;
  for (const entry of entries) {
    if (
      !MIXIN_SELECTOR_TYPES.has(entry.node.grammarType)
      || entry.end > start
      || !onlyTriviaBetween(source, entry.end, start)
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
  return best;
}

function followingMixinBody(entries: readonly CstIndexEntry[], source: string, selector: CstIndexEntry): CstIndexEntry | null {
  let best: CstIndexEntry | null = null;
  for (const entry of entries) {
    if (
      (!MIXIN_REF_TYPES.has(entry.node.grammarType) && !MIXIN_DEF_TYPES.has(entry.node.grammarType))
      || entry.start < selector.end
      || !onlyTriviaBetween(source, selector.end, entry.start)
    ) {
      continue;
    }
    if (best === null || entry.start < best.start || (entry.start === best.start && entry.end < best.end)) {
      best = entry;
    }
  }
  return best;
}

function mixinNameForEntry(entries: readonly CstIndexEntry[], source: string, entry: CstIndexEntry): string {
  const slice = source.slice(entry.start, entry.end);
  if (slice.trim().startsWith('@') || entry.node.grammarType === 'FunctionRule') {
    return mixinNameOf(slice);
  }
  const selector = previousMixinSelector(entries, source, entry.start);
  return selector === null ? mixinNameOf(slice) : source.slice(selector.start, selector.end).trim();
}

function mixinRangeEntry(entries: readonly CstIndexEntry[], source: string, entry: CstIndexEntry): CstIndexEntry {
  const slice = source.slice(entry.start, entry.end);
  if (slice.trim().startsWith('@') || entry.node.grammarType === 'FunctionRule') {
    return entry;
  }
  return previousMixinSelector(entries, source, entry.start) ?? entry;
}

function isNameChar(ch: string): boolean {
  return ch === '-' || ch === '_' || (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

function sourceVariableSymbolAtOffset(source: string, offset: number): CstSymbol | null {
  if (source.length === 0) {
    return null;
  }
  const pos = Math.min(Math.max(0, offset), source.length);
  let start = pos;
  while (start > 0 && isNameChar(source.charAt(start - 1))) {
    start--;
  }
  if (start > 0 && (source.charAt(start - 1) === '@' || source.charAt(start - 1) === '$')) {
    start--;
  } else if (start >= 2 && source.slice(start - 2, start) === '--') {
    start -= 2;
  }

  let end = pos;
  while (end < source.length && isNameChar(source.charAt(end))) {
    end++;
  }

  if (start >= end || offset < start || offset > end) {
    return null;
  }

  const slice = source.slice(start, end);
  const hasSigil = (slice.startsWith('@') || slice.startsWith('$')) && slice.length > 1;
  const isCustomProperty = slice.startsWith('--') && slice.length > 2;
  if (!hasSigil && !isCustomProperty) {
    return null;
  }

  const name = varNameOf(slice);
  if (!name) {
    return null;
  }
  return { kind: 'variable', role: 'reference', matchName: name, refineIdent: name };
}

/**
 * Resolve the innermost variable/mixin symbol whose absolute span covers
 * `offset`. There are no parent pointers on CST nodes, so instead of walking up
 * we pick the SMALLEST symbol-typed index entry that contains the offset — which
 * is exactly the enclosing reference/declaration the AST version reached by
 * climbing to a `Reference`/`Mixin`.
 */
export function cstSymbolAtOffset(root: CssCstNode, doc: TextDocument, offset: number): CstSymbol | null {
  const index = buildCstIndex(root);
  const src = doc.getText();
  let best: { node: CssCstNode; start: number; end: number } | null = null;
  for (const entry of index.nodes) {
    const gt = entry.node.grammarType;
    const isMixinSelector = MIXIN_SELECTOR_TYPES.has(gt) && followingMixinBody(index.nodes, src, entry) !== null;
    const isSymbol = VAR_REF_TYPES.has(gt) || VAR_DECL_TYPES.has(gt) || MIXIN_REF_TYPES.has(gt) || MIXIN_DEF_TYPES.has(gt) || isMixinSelector;
    if (!isSymbol) {
      continue;
    }
    if (entry.start <= offset && offset <= entry.end) {
      if (!best || (entry.end - entry.start) <= (best.end - best.start)) {
        best = entry;
      }
    }
  }
  if (!best) {
    return sourceVariableSymbolAtOffset(src, offset);
  }
  const gt = best.node.grammarType;
  const slice = src.slice(best.start, best.end);
  if (VAR_REF_TYPES.has(gt)) {
    const name = varNameOf(slice);
    return { kind: 'variable', role: 'reference', matchName: name, refineIdent: name };
  }
  if (VAR_DECL_TYPES.has(gt)) {
    const name = varNameOf(slice);
    return { kind: 'variable', role: 'definition', matchName: name, refineIdent: name };
  }
  const selectorBody = MIXIN_SELECTOR_TYPES.has(gt) ? followingMixinBody(index.nodes, src, best) : null;
  const mixinEntry = selectorBody ?? best;
  const mn = MIXIN_SELECTOR_TYPES.has(gt)
    ? src.slice(best.start, best.end).trim()
    : mixinNameForEntry(index.nodes, src, mixinEntry);
  const ident = mixinIdentOf(mn);
  if (selectorBody !== null && MIXIN_REF_TYPES.has(selectorBody.node.grammarType)) {
    return { kind: 'mixin', role: 'reference', matchName: mn, refineIdent: ident };
  }
  if (MIXIN_REF_TYPES.has(gt)) {
    return { kind: 'mixin', role: 'reference', matchName: mn, refineIdent: ident };
  }
  return { kind: 'mixin', role: 'definition', matchName: mn, refineIdent: ident };
}

/** Find the DEFINITION of `target` within one document's CST (declaration for a
 * variable, mixin definition for a mixin). Returns the whole-node span. */
export function cstFindDefinitionInDoc(root: CssCstNode, doc: TextDocument, uri: string, target: CstSymbolTarget): Location | null {
  const index = buildCstIndex(root);
  const src = doc.getText();
  for (const entry of index.nodes) {
    const gt = entry.node.grammarType;
    if (target.kind === 'variable') {
      if (VAR_DECL_TYPES.has(gt) && varNameOf(src.slice(entry.start, entry.end)) === target.matchName) {
        return { uri, range: toRange(doc, entry.start, entry.end) };
      }
    } else if (MIXIN_DEF_TYPES.has(gt) && mixinNameForEntry(index.nodes, src, entry) === target.matchName) {
      const rangeEntry = mixinRangeEntry(index.nodes, src, entry);
      return { uri, range: toRange(doc, rangeEntry.start, rangeEntry.end) };
    }
  }
  return null;
}

/** Collect every reference AND the declaration of `target` within one
 * document's CST, appending node-level spans to `out`. */
export function cstCollectReferencesInDoc(root: CssCstNode, doc: TextDocument, uri: string, target: CstSymbolTarget, out: Location[]): void {
  const index = buildCstIndex(root);
  const src = doc.getText();
  for (const entry of index.nodes) {
    const gt = entry.node.grammarType;
    const slice = src.slice(entry.start, entry.end);
    let hit = false;
    if (target.kind === 'variable') {
      hit = (VAR_REF_TYPES.has(gt) || VAR_DECL_TYPES.has(gt)) && varNameOf(slice) === target.matchName;
    } else {
      hit = (MIXIN_REF_TYPES.has(gt) || MIXIN_DEF_TYPES.has(gt)) && mixinNameForEntry(index.nodes, src, entry) === target.matchName;
    }
    if (hit) {
      const rangeEntry = target.kind === 'mixin' ? mixinRangeEntry(index.nodes, src, entry) : entry;
      out.push({ uri, range: toRange(doc, rangeEntry.start, rangeEntry.end) });
    }
  }
}
