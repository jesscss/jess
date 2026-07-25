/**
 * Parser-authored source spans for canonical AST nodes.
 *
 * AST v2 nodes remain plain semantic data, so source locations live in a side
 * table instead of changing every hot node shape. Parseman reductions provide
 * the exact span; evaluation reads it only when constructing a diagnostic.
 */
export type AstSourceSpan = Readonly<{ start: number; end: number }>;

/** Authored separator/trivia facts for a raw ValueSlot array.
 *
 * ValueSlot deliberately stays a plain readonly array in the public AST.  A
 * parser may still retain each exact authored boundary run—ordinary spaces or
 * tabs, comments, line breaks, and continuation indentation—in this side
 * table, rather than adding a dialect-specific field to the array or turning
 * the array back into a SpacedValue node.
 */
export type ValueLayout = readonly string[];

/*
 * Parser packages consume the public `@jesscss/core/ast` subpath while core
 * evaluation is also loaded through the package root. Build tools may therefore
 * materialize more than one copy of this small module. A process-global symbol
 * keeps the one parser-authored side table shared across those module identities
 * without adding properties to AST nodes or creating a test-only metadata path.
 */
const spanStoreKey = Symbol.for('jess.ast.source-span-store');
const globalStore = globalThis as typeof globalThis & {
  [spanStoreKey]?: WeakMap<object, AstSourceSpan>;
};
const spans = globalStore[spanStoreKey] ??= new WeakMap<object, AstSourceSpan>();

const layoutStoreKey = Symbol.for('jess.ast.value-layout-store');
const layoutGlobal = globalThis as typeof globalThis & {
  [layoutStoreKey]?: WeakMap<object, ValueLayout>;
};
const layouts = layoutGlobal[layoutStoreKey] ??= new WeakMap<object, ValueLayout>();

/** Retain the exact Parseman reduction span for an AST factory result. */
export function withSourceSpan<T extends object>(node: T, span: AstSourceSpan): T {
  spans.set(node, span);
  return node;
}

/** Read a parser-authored span, if the AST node originated in source. */
export function sourceSpanOf(node: object): AstSourceSpan | undefined {
  return spans.get(node);
}

/** Retain authored separator/trivia runs for a raw ValueSlot array or List fact.
 *
 * The carrier deliberately remains out-of-band: neither recursive ValueSlot
 * arrays nor the public List shape grows a dialect-specific `separators` field.
 * The same side table can therefore preserve a comma boundary on a List while
 * keeping the semantic payload (`value` + `sep`) minimal.
 */
export function withValueLayout<T extends object>(value: T, separators: ValueLayout): T {
  layouts.set(value, separators);
  return value;
}

/** Read parser-authored separators for a raw ValueSlot array. */
export function valueLayoutOf(value: object): ValueLayout | undefined {
  return layouts.get(value);
}
