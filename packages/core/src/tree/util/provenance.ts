/**
 * Source / Parséman-CST provenance side-table — the ONLY home for a node's
 * source spans and CST metadata.
 *
 * Jess `Node`s carry NO provenance fields, getters, setters, or methods. Every
 * bit of it lives in this `WeakMap<Node, Provenance>` and is reached through the
 * free functions below. eval creates millions of source-free nodes that must not
 * pay for provenance; the one hot check (`isSourceFree`, used by `canReuseAsLeaf`)
 * is the `F_HAS_SPAN` flag bit, everything else is a cold side-table read.
 *
 * DO NOT add a node accessor "for convenience" — it context-poisons the whole
 * codebase back toward node-stored provenance. See the `provenance-side-table-only`
 * project memory.
 */

/** A source span — `{start, end}` offsets. The only source-position shape. */
export type SourceSpan = { start: number; end: number };

/** All parse-time provenance for one node. Every field is optional. */
export type Provenance = {
  /** Source start offset. */
  spanStart?: number;
  /** Source end offset. */
  spanEnd?: number;
  /** Per-slot source spans for string-normalized DIRECT children, by `childKeys` order. */
  fieldSpans?: (SourceSpan | undefined)[];
  /** Per-segment source spans for array-`value` children (e.g. selector-list items). */
  valueSpans?: (SourceSpan | undefined)[];
  /** Parséman parse-context snapshot (incremental re-parse re-entry key). */
  cstState?: unknown;
  /** Parséman structural children (CST leaves/nodes/errors in parse order). */
  cstChildren?: ReadonlyArray<{ _tag: string }>;
};

/** Node has source provenance (a span). The one hot flag; kept on `node.flags`. */
export const F_HAS_SPAN = 0b100000000000000;

type Flagged = { flags: number };

const PROV = new WeakMap<object, Provenance>();

function provOf(node: object): Provenance | undefined {
  return PROV.get(node);
}

function ensureProv(node: object): Provenance {
  let p = PROV.get(node);
  if (!p) {
    p = {};
    PROV.set(node, p);
  }
  return p;
}

/** True if the node has no source span (the hot `canReuseAsLeaf` check — flag read). */
export function isSourceFree(node: Flagged): boolean {
  return (node.flags & F_HAS_SPAN) === 0;
}

/** The node's source span, or `undefined` when source-free. */
export function sourceSpanOf(node: object): SourceSpan | undefined {
  const p = PROV.get(node);
  return p?.spanStart === undefined ? undefined : { start: p.spanStart, end: p.spanEnd ?? p.spanStart };
}

/** Source start offset, or `undefined`. */
export function spanStartOf(node: object): number | undefined {
  return PROV.get(node)?.spanStart;
}

/** Source end offset, or `undefined`. */
export function spanEndOf(node: object): number | undefined {
  return PROV.get(node)?.spanEnd;
}

/** Set (or clear, with `undefined`) the node's source span; maintains `F_HAS_SPAN`. */
export function setSourceSpan(node: object & Flagged, span: SourceSpan | undefined): void {
  if (span !== undefined) {
    const p = ensureProv(node);
    p.spanStart = span.start;
    p.spanEnd = span.end;
    node.flags |= F_HAS_SPAN;
  } else {
    node.flags &= ~F_HAS_SPAN;
    const p = PROV.get(node);
    if (p) {
      p.spanStart = undefined;
      p.spanEnd = undefined;
    }
  }
}

/** Copy the source span (and flag) from `src` onto `dst`. Used by placement clones. */
export function copySourceSpan(dst: object & Flagged, src: object): void {
  setSourceSpan(dst, sourceSpanOf(src));
}

/** Per-slot field spans, or `undefined`. */
export function fieldSpansOf(node: object): (SourceSpan | undefined)[] | undefined {
  return PROV.get(node)?.fieldSpans;
}

export function setFieldSpans(node: object, spans: (SourceSpan | undefined)[] | undefined): void {
  if (spans === undefined && !PROV.has(node)) {
    return;
  }
  ensureProv(node).fieldSpans = spans;
}

/** Per-segment value spans, or `undefined`. */
export function valueSpansOf(node: object): (SourceSpan | undefined)[] | undefined {
  return PROV.get(node)?.valueSpans;
}

export function setValueSpans(node: object, spans: (SourceSpan | undefined)[] | undefined): void {
  if (spans === undefined && !PROV.has(node)) {
    return;
  }
  ensureProv(node).valueSpans = spans;
}

/** Parséman CST re-parse state. */
export function cstStateOf(node: object): unknown {
  return PROV.get(node)?.cstState;
}

export function setCstState(node: object, state: unknown): void {
  if (state === undefined && !PROV.has(node)) {
    return;
  }
  ensureProv(node).cstState = state;
}

const EMPTY_CST_CHILDREN: ReadonlyArray<{ _tag: string }> = [];

/** Parséman CST structural children (empty for eval-created nodes). */
export function cstChildrenOf(node: object): ReadonlyArray<{ _tag: string }> {
  return PROV.get(node)?.cstChildren ?? EMPTY_CST_CHILDREN;
}

export function setCstChildren(node: object, children: ReadonlyArray<{ _tag: string }>): void {
  if (children.length === 0 && !PROV.has(node)) {
    return;
  }
  ensureProv(node).cstChildren = children;
}

/** Whether a node has any provenance record. */
export function hasProvenance(node: object): boolean {
  return PROV.has(node);
}

export { provOf as provenanceOf, ensureProv as ensureProvenance };
