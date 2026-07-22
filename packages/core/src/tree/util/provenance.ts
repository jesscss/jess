/**
 * Source provenance — a node's source spans.
 *
 * The node-level span lives in INLINE fixed-shape fields on the `Node` base
 * class (`_spanStart`, `_spanEnd`), declared there initialized to `undefined`
 * so the hidden class stays monomorphic. This module owns the free-function
 * surface that reads/writes those fields; callers NEVER touch the fields
 * directly. eval creates millions of source-free nodes that must not pay for
 * provenance; the one hot check (`isSourceFree`, used by `canReuseAsLeaf`) is
 * the `F_HAS_SPAN` flag bit, everything else is a cold field read.
 *
 * Per-slot spans (`valueSpans`/`fieldSpans`) are SPARSE — carried only by
 * source-parsed multi-member nodes, zero eval nodes — so they are NOT Node
 * fields: they live in module-level WeakMaps below, gated by their own flag
 * bits (`F_HAS_VALUESPANS`/`F_HAS_FIELDSPANS`).
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

/**
 * Node carries per-slot VALUE spans (multi-member selector lists / value
 * arrays). Sparse — set ONLY on source-parsed multi-member nodes; zero eval
 * nodes carry it. Gates the `valueSpansOf`/`valueSpanAt` WeakMap lookup so
 * non-carrying nodes pay only a bitwise-and.
 */
// Bit 16 is F_MERGE_SUPPRESSED (node-base.ts); per-slot span flags take bits 17/18.
export const F_HAS_VALUESPANS = 0b100000000000000000;
/** Node carries per-slot FIELD spans (e.g. a declaration's `value` field). Sparse; same gating discipline as `F_HAS_VALUESPANS`. */
export const F_HAS_FIELDSPANS = 0b1000000000000000000;

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

/** Copy the source span and flag from `src` onto `dst` without allocating a span object. */
export function copySpanFields(dst: object & Flagged, src: object): void {
  const source = fieldsOf(src);
  const start = source._spanStart;
  const target = fieldsOf(dst);
  if (start === undefined) {
    dst.flags &= ~F_HAS_SPAN;
    target._spanStart = undefined;
    target._spanEnd = undefined;
    return;
  }
  target._spanStart = start;
  target._spanEnd = source._spanEnd ?? start;
  dst.flags |= F_HAS_SPAN;
}

/* =========================
 * Eval-error source location
 * ========================= */

/**
 * A thrown error, viewed through the optional source-location fields the eval
 * dispatch stamps onto it. Plain runtime errors (`ReferenceError`, `TypeError`,
 * …) raised deep in eval carry no source position; the central eval seam stamps
 * the offending node's span + source so the top-level catch can render a real
 * code frame instead of the `1:1`/empty-frame fallback.
 */
interface EvalErrorLocationCarrier {
  _jessEvalSpanStart?: number;
  _jessEvalSpanEnd?: number;
  _jessEvalSource?: string;
}

/** The resolved eval location previously stamped onto an error, if any. */
export interface EvalErrorLocation {
  spanStart: number;
  spanEnd?: number;
  source?: string;
}

/**
 * Stamp the offending `node`'s source span (and its file `source`) onto a thrown
 * error so a downstream catch can point the code frame at the real location.
 *
 * Called from the central eval dispatch on the COLD error path only. The FIRST
 * (innermost) source-bearing node to unwind past wins: as the error propagates
 * up through each ancestor's eval, the ancestor sees a location already present
 * and leaves it untouched. A source-free node (eval-derived, no span) stamps
 * nothing, so the nearest authored ancestor supplies the position.
 */
export function stampEvalErrorLocation(err: unknown, node: object, source: string | undefined): void {
  if (err === null || typeof err !== 'object') {
    return;
  }
  const start = spanStartOf(node);
  if (start === undefined) {
    return;
  }
  const carrier = err as EvalErrorLocationCarrier;
  if (carrier._jessEvalSpanStart !== undefined) {
    return; // a deeper (innermost) node already stamped the precise location
  }
  carrier._jessEvalSpanStart = start;
  carrier._jessEvalSpanEnd = spanEndOf(node);
  carrier._jessEvalSource = source;
}

/** Read back the eval location an earlier `stampEvalErrorLocation` attached, if present. */
export function readEvalErrorLocation(err: unknown): EvalErrorLocation | undefined {
  if (err === null || typeof err !== 'object') {
    return undefined;
  }
  const carrier = err as EvalErrorLocationCarrier;
  const spanStart = carrier._jessEvalSpanStart;
  if (spanStart === undefined) {
    return undefined;
  }
  return { spanStart, spanEnd: carrier._jessEvalSpanEnd, source: carrier._jessEvalSource };
}

// Per-slot span arrays (`_valueSpans`/`_fieldSpans`) are SPARSE — they exist
// only on source-parsed multi-member selector lists / value arrays and on the
// declaration `value` field. Storing them as Node fields would deoptimize the
// MILLIONS of source-free eval nodes (every one would carry two `undefined`
// slots, growing the shared hidden class). So they live OFF the Node shape, in
// module-level WeakMaps keyed by the node, gated by a flag bit so a non-carrying
// node pays only a bitwise-and to skip the lookup. Each entry is a FLAT PACKED
// SMI array `[start0, end0, start1, end1, …]` (V8 PACKED_SMI_ELEMENTS) — no
// per-slot `{start,end}` objects. A leaner `valueSpanAt`/`fieldSpanAt` reads one
// slot directly from the flat array; the array-shaped `valueSpansOf`/
// `fieldSpansOf` reconstruct `{start,end}` objects lazily for the few callers
// that still want the whole array.

const VALUE_SPANS = new WeakMap<object, number[]>();
const FIELD_SPANS = new WeakMap<object, number[]>();

/** Pack `(SourceSpan|undefined)[]` into a flat `[start,end,…]` SMI array; `undefined` slots become `-1,-1`. */
function packSpans(spans: ReadonlyArray<SourceSpan | undefined>): number[] {
  const flat = new Array<number>(spans.length * 2);
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    flat[i * 2] = s === undefined ? -1 : s.start;
    flat[i * 2 + 1] = s === undefined ? -1 : s.end;
  }
  return flat;
}

/** Reconstruct `(SourceSpan|undefined)[]` from a flat SMI array; `-1` starts read back as `undefined`. */
function unpackSpans(flat: number[]): (SourceSpan | undefined)[] {
  const out = new Array<SourceSpan | undefined>(flat.length / 2);
  for (let i = 0; i < out.length; i++) {
    const start = flat[i * 2]!;
    out[i] = start === -1 ? undefined : { start, end: flat[i * 2 + 1]! };
  }
  return out;
}

/** Read one span slot directly from a flat array (no whole-array rebuild). */
function spanAt(flat: number[] | undefined, i: number): SourceSpan | undefined {
  if (flat === undefined || i < 0 || i * 2 >= flat.length) {
    return undefined;
  }
  const start = flat[i * 2]!;
  return start === -1 ? undefined : { start, end: flat[i * 2 + 1]! };
}

/** Per-slot field spans as an array, or `undefined` when the node carries none. */
export function fieldSpansOf(node: Flagged): (SourceSpan | undefined)[] | undefined {
  if ((node.flags & F_HAS_FIELDSPANS) === 0) {
    return undefined;
  }
  const flat = FIELD_SPANS.get(node);
  return flat === undefined ? undefined : unpackSpans(flat);
}

/** One field span by index (leaner than rebuilding the whole array). */
export function fieldSpanAt(node: Flagged, i: number): SourceSpan | undefined {
  if ((node.flags & F_HAS_FIELDSPANS) === 0) {
    return undefined;
  }
  return spanAt(FIELD_SPANS.get(node), i);
}

/** Store (or clear, when empty) per-slot field spans; maintains `F_HAS_FIELDSPANS`. */
export function setFieldSpans(node: object & Flagged, spans: ReadonlyArray<SourceSpan | undefined> | undefined): void {
  if (spans !== undefined && spans.length > 0) {
    FIELD_SPANS.set(node, packSpans(spans));
    node.flags |= F_HAS_FIELDSPANS;
  } else {
    node.flags &= ~F_HAS_FIELDSPANS;
    FIELD_SPANS.delete(node);
  }
}

/** Per-slot value spans as an array, or `undefined` when the node carries none. */
export function valueSpansOf(node: Flagged): (SourceSpan | undefined)[] | undefined {
  if ((node.flags & F_HAS_VALUESPANS) === 0) {
    return undefined;
  }
  const flat = VALUE_SPANS.get(node);
  return flat === undefined ? undefined : unpackSpans(flat);
}

/** One value span by index (leaner than rebuilding the whole array). */
export function valueSpanAt(node: Flagged, i: number): SourceSpan | undefined {
  if ((node.flags & F_HAS_VALUESPANS) === 0) {
    return undefined;
  }
  return spanAt(VALUE_SPANS.get(node), i);
}

/** Store (or clear, when empty) per-slot value spans; maintains `F_HAS_VALUESPANS`. */
export function setValueSpans(node: object & Flagged, spans: ReadonlyArray<SourceSpan | undefined> | undefined): void {
  if (spans !== undefined && spans.length > 0) {
    VALUE_SPANS.set(node, packSpans(spans));
    node.flags |= F_HAS_VALUESPANS;
  } else {
    node.flags &= ~F_HAS_VALUESPANS;
    VALUE_SPANS.delete(node);
  }
}
