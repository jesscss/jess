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
 *   - variable reference   → `Reference`            (`@primary` / `$primary`)
 *   - variable declaration → `VarDeclaration`       (`@primary: red;`)
 *   - mixin reference      → `MixinCall`            (`.button();`)
 *   - mixin definition     → `MixinOrQualifiedRule` (`.button() { … }`)
 * A plain selector rule is `Ruleset`, so a mixin definition (which carries
 * `MixinArgs`) is cleanly distinguished by its grammarType.
 *
 * SPAN MODEL: the CST stores parent-relative spans, so absolute offsets come
 * from `buildCstIndex(root).spanOf` only. Identifiers are sliced from SOURCE
 * text over those absolute spans (whitespace lives in trivia, not leaves).
 */
import type { CssCstNode } from '@jesscss/css-parser';
import type { Location, Range } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { buildCstIndex } from './cst-analysis.js';

const VAR_REF = 'Reference';
const VAR_DECL = 'VarDeclaration';
const MIXIN_REF_TYPES = new Set(['MixinCall']);
const MIXIN_DEF_TYPES = new Set(['MixinOrQualifiedRule', 'MixinDefinition', 'Mixin']);

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

/** Bare variable name from a `Reference` (`@primary`) or `VarDeclaration`
 * (`@primary: red;`) slice: take the head before any `:`, drop the sigil. */
function varNameOf(slice: string): string {
  const head = slice.split(':')[0] ?? slice;
  return head.trim().replace(/^[$@]/, '').trim();
}

/** Selector-with-combinator mixin name from a `MixinCall` (`.button();`) or
 * `MixinOrQualifiedRule` (`.button() { … }`) slice: the head before `(`/`{`. */
function mixinNameOf(slice: string): string {
  return slice.split(/[({]/)[0]!.trim();
}

/** Strip a mixin name to its bare identifier (drop leading `.`/`#`, trailing `()`). */
function mixinIdentOf(name: string): string {
  return name.replace(/^[.#]/, '').replace(/\(\s*\)\s*$/, '').trim();
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
    const isSymbol = gt === VAR_REF || gt === VAR_DECL || MIXIN_REF_TYPES.has(gt) || MIXIN_DEF_TYPES.has(gt);
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
    return null;
  }
  const gt = best.node.grammarType;
  const slice = src.slice(best.start, best.end);
  if (gt === VAR_REF) {
    const name = varNameOf(slice);
    return { kind: 'variable', role: 'reference', matchName: name, refineIdent: name };
  }
  if (gt === VAR_DECL) {
    const name = varNameOf(slice);
    return { kind: 'variable', role: 'definition', matchName: name, refineIdent: name };
  }
  const mn = mixinNameOf(slice);
  const ident = mixinIdentOf(mn);
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
      if (gt === VAR_DECL && varNameOf(src.slice(entry.start, entry.end)) === target.matchName) {
        return { uri, range: toRange(doc, entry.start, entry.end) };
      }
    } else if (MIXIN_DEF_TYPES.has(gt) && mixinNameOf(src.slice(entry.start, entry.end)) === target.matchName) {
      return { uri, range: toRange(doc, entry.start, entry.end) };
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
      hit = (gt === VAR_REF || gt === VAR_DECL) && varNameOf(slice) === target.matchName;
    } else {
      hit = (MIXIN_REF_TYPES.has(gt) || MIXIN_DEF_TYPES.has(gt)) && mixinNameOf(slice) === target.matchName;
    }
    if (hit) {
      out.push({ uri, range: toRange(doc, entry.start, entry.end) });
    }
  }
}
