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

// Per-sub-component span arrays (`_fieldSpans`/`_valueSpans`) were removed from
// the Node shape: the eval tree keeps only node-level `_spanStart`/`_spanEnd`,
// and authored sub-component whitespace is normalized (comments still round-trip
// via a node-span comment scan — see `commentRunsWithinSpan`). The accessors are
// retained as no-op reads/writes so the css-parser builders that still call them
// keep compiling; the getters always return `undefined`, the setters do nothing.

/** Removed: per-slot field spans are no longer stored. Always `undefined`. */
export function fieldSpansOf(_node: object): (SourceSpan | undefined)[] | undefined {
  return undefined;
}

/** No-op: per-slot field spans are no longer stored on the node. */
export function setFieldSpans(_node: object, _spans: (SourceSpan | undefined)[] | undefined): void {
  // intentionally empty
}

/** Removed: per-segment value spans are no longer stored. Always `undefined`. */
export function valueSpansOf(_node: object): (SourceSpan | undefined)[] | undefined {
  return undefined;
}

/** No-op: per-segment value spans are no longer stored on the node. */
export function setValueSpans(_node: object, _spans: (SourceSpan | undefined)[] | undefined): void {
  // intentionally empty
}
