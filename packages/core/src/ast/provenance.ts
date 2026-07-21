/**
 * Parser-authored source spans for canonical AST nodes.
 *
 * AST v2 nodes remain plain semantic data, so source locations live in a side
 * table instead of changing every hot node shape. Parseman reductions provide
 * the exact span; evaluation reads it only when constructing a diagnostic.
 */
export type AstSourceSpan = Readonly<{ start: number; end: number }>;

// Parser packages consume the public `@jesscss/core/ast` subpath while core
// evaluation is also loaded through the package root. Build tools may therefore
// materialize more than one copy of this small module. A process-global symbol
// keeps the one parser-authored side table shared across those module identities
// without adding properties to AST nodes or creating a test-only metadata path.
const spanStoreKey = Symbol.for('jess.ast.source-span-store');
const globalStore = globalThis as typeof globalThis & {
  [spanStoreKey]?: WeakMap<object, AstSourceSpan>;
};
const spans = globalStore[spanStoreKey] ??= new WeakMap<object, AstSourceSpan>();

/** Retain the exact Parseman reduction span for an AST factory result. */
export function withSourceSpan<T extends object>(node: T, span: AstSourceSpan): T {
  spans.set(node, span);
  return node;
}

/** Read a parser-authored span, if the AST node originated in source. */
export function sourceSpanOf(node: object): AstSourceSpan | undefined {
  return spans.get(node);
}
