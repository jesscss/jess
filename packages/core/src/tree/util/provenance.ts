/**
 * Source provenance — a node's source spans.
 *
 * The data lives in INLINE fixed-shape fields on the `Node` base class
 * (`_spanStart`, `_spanEnd`, `_fieldSpans`, `_valueSpans`), declared there
 * initialized to `undefined` so the hidden class stays monomorphic. This
 * module owns the free-function surface that reads/writes those fields;
 * callers NEVER touch the fields directly. eval
 * creates millions of source-free nodes that must not pay for provenance; the
 * one hot check (`isSourceFree`, used by `canReuseAsLeaf`) is the `F_HAS_SPAN`
 * flag bit, everything else is a cold field read.
 */

/** A source span — `{start, end}` offsets. The only source-position shape. */
export type SourceSpan = { start: number; end: number };

/**
 * The inline provenance fields on the `Node` base class. Every field is
 * optional and defaults to `undefined`. The concrete storage is declared on the
 * class body in `node-base.ts` (fixed-shape/monomorphic); this shape is only the
 * accessor contract for the free functions below.
 */
type ProvenanceFields = {
  /** Runtime flags bitmask (carries `F_HAS_SPAN`). */
  flags: number;
  /** Source start offset. */
  _spanStart: number | undefined;
  /** Source end offset. */
  _spanEnd: number | undefined;
  /** Per-slot source spans for string-normalized DIRECT children, by `childKeys` order. */
  _fieldSpans: (SourceSpan | undefined)[] | undefined;
  /** Per-segment source spans for array-`value` children (e.g. selector-list items). */
  _valueSpans: (SourceSpan | undefined)[] | undefined;
};

/** Node has source provenance (a span). The one hot flag; kept on `node.flags`. */
export const F_HAS_SPAN = 0b100000000000000;

type Flagged = { flags: number };

/**
 * View a node through its inline provenance fields. Every `Node` structurally
 * carries these (declared on the base class), so the single narrowing assertion
 * is sound; centralizing it keeps the per-accessor bodies plain field reads.
 */
function fieldsOf(node: object): ProvenanceFields {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return node as ProvenanceFields;
}

/** True if the node has no source span (the hot `canReuseAsLeaf` check — flag read). */
export function isSourceFree(node: Flagged): boolean {
  return (node.flags & F_HAS_SPAN) === 0;
}

/** The node's source span, or `undefined` when source-free. */
export function sourceSpanOf(node: object): SourceSpan | undefined {
  const p = fieldsOf(node);
  const start = p._spanStart;
  if (start === undefined) {
    return undefined;
  }
  return { start, end: p._spanEnd ?? start };
}

/** Source start offset, or `undefined`. */
export function spanStartOf(node: object): number | undefined {
  return fieldsOf(node)._spanStart;
}

/** Source end offset, or `undefined`. */
export function spanEndOf(node: object): number | undefined {
  return fieldsOf(node)._spanEnd;
}

/** Set (or clear, with `undefined`) the node's source span; maintains `F_HAS_SPAN`. */
export function setSourceSpan(node: object & Flagged, span: SourceSpan | undefined): void {
  const p = fieldsOf(node);
  if (span !== undefined) {
    p._spanStart = span.start;
    p._spanEnd = span.end;
    node.flags |= F_HAS_SPAN;
  } else {
    node.flags &= ~F_HAS_SPAN;
    p._spanStart = undefined;
    p._spanEnd = undefined;
  }
}

/** Copy the source span (and flag) from `src` onto `dst`. Used by placement clones. */
export function copySourceSpan(dst: object & Flagged, src: object): void {
  setSourceSpan(dst, sourceSpanOf(src));
}

/** Per-slot field spans, or `undefined`. */
export function fieldSpansOf(node: object): (SourceSpan | undefined)[] | undefined {
  return fieldsOf(node)._fieldSpans;
}

export function setFieldSpans(node: object, spans: (SourceSpan | undefined)[] | undefined): void {
  fieldsOf(node)._fieldSpans = spans;
}

/** Per-segment value spans, or `undefined`. */
export function valueSpansOf(node: object): (SourceSpan | undefined)[] | undefined {
  return fieldsOf(node)._valueSpans;
}

export function setValueSpans(node: object, spans: (SourceSpan | undefined)[] | undefined): void {
  fieldsOf(node)._valueSpans = spans;
}
