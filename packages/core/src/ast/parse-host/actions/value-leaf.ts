/**
 * Value-leaf family: numeric / color / keyword / quoted / url leaves, captured as
 * HONEST typed value nodes (task #44 — honest typed leaves).
 *
 * Each leaf grammar rule maps to the value node whose `type` IS its value class —
 * `Numeric` → `Dimension`, `Color`/`NamedColor` → `Color`, `Keyword` → `Keyword`,
 * `Quoted` → `Quoted`, `EscapedValue`/`Url` → `Any` (opaque). The parser already
 * decided the class (the grammar RULE), so the build host never re-scans the bytes:
 * a forced (operated / compared / typed-param) literal materializes by reading the
 * node's own fields, never a byte sniff (constitution P0). Only the `Any` leaf's
 * type is honestly unknown, so it (alone) sniffs when forced.
 *
 * Byte-identity: every leaf carries its verbatim source bytes in `src`, and the
 * serializer emits `src` for an inert literal — so output bytes are unchanged. The
 * declaration family consumes a single whole-value leaf; a leaf that is only PART of
 * the value (`1px solid red` → only `red` builds) is left for the declaration's
 * verbatim-bytes fallback, so no value is dropped.
 *
 * These leaves are also the typed OPERANDS the operation / call families consume.
 */
import * as t2 from '../../index.js';
import { type BuildAction, type BuildArgs, sliceSpan } from '../host-context.js';
import { interpFromChildren } from './interp.js';

/** Verbatim source bytes of the leaf's own span. */
function leafBytes(args: BuildArgs): string {
  return sliceSpan(args.ctx, args.span);
}

/** A parseman child leaf `{ _tag:'leaf', value, span }`. */
function leafValue(x: unknown): string | undefined {
  return !!x && typeof x === 'object' && (x as { _tag?: string })._tag === 'leaf'
    ? (x as { value: string }).value
    : undefined;
}

/** A leaf action mapping the leaf's verbatim bytes to its honest value node. */
function leaf(type: string, make: (bytes: string) => t2.ValueNode): BuildAction {
  return { type, build: (args) => make(leafBytes(args)) };
}

/**
 * `1.0px` / `-3px` / `.5s` / `50%` / bare `1` — the grammar rule already SPLIT the
 * number leaf from the unit leaf (`noTrivia(sequence(numPart, optional(unit)))`),
 * so the `Dimension` node carries `{number, unit}` directly; a forced (operated)
 * numeric reads them with no `NUM_RE` re-split. The verbatim source bytes ride in
 * `src` for byte-faithful emit. If the parser ever hands a shape without the clean
 * split, the bytes are re-split into `number`/`unit` as a fallback.
 */
function numericLeaf(args: BuildArgs): t2.ValueNode {
  const bytes = leafBytes(args);
  // The grammar delivers the number leaf then (optionally) the unit leaf — the
  // same split the css-parser `_buildDimension` reads. Filter to leaves so no
  // non-leaf child shifts the indices.
  const leaves = args.children.map(leafValue).filter((v): v is string => v !== undefined);
  if (leaves.length > 0) return t2.dimension(Number(leaves[0]), leaves[1] ?? '', bytes);
  // Fallback (no clean split — the grammar always delivers the number leaf, so this
  // is unreached): emit opaque bytes so a forced value sniffs the numeric shape,
  // byte-identical to the former untagged-materialize path (no host-side regex).
  return t2.any(bytes);
}

/**
 * A quoted string `"…"` / `'…'`. The `Quoted` grammar rule is DISTINCT from an
 * ident, so it is tagged `Quoted` and carries its inner value + quote char as
 * `LitFields` — materialize reads them instead of a `QUOTE_RE` re-scan. `escaped`
 * is false by construction: an escaped `~"…"` is a separate `EscapedValue` rule,
 * never this leaf, so the flag is read from the grammar structure, not hardcoded.
 *
 * A string carrying `@{name}` interpolation becomes an `Interp` template (the
 * literal parts keep the quote chars, including the surrounding quotes) so the
 * reference resolves. The Less `Quoted` grammar rule (§3.3) already SPLIT the string
 * into ordered children — quote/literal chunks + built `LessInterp` ref nodes
 * (`@{name}` → `VarRef`, `@{m[k]}` → `MapAccessor`) — so this CONSUMES those children
 * via the shared `interpFromChildren` seam (P0: no byte re-scan). A plain string with
 * no `@{…}` is one flat leaf → `interpFromChildren` finds no ref and returns `null`,
 * so it stays the byte-identical `Quoted` node.
 */
function quotedLeaf(args: BuildArgs): t2.ValueNode {
  const interp = interpFromChildren(args.children, true);
  if (interp !== null) return interp;
  const bytes = leafBytes(args);
  return t2.quoted(bytes, bytes.slice(1, -1), bytes[0]!, false);
}

/** The interpolation / quoted value the grammar built for the inner string of a
 *  `~"…"` / `~'…'` (`EscapedValue = ~ + Quoted`) — the sole `Interp`/`Quoted`
 *  value child, past the leading `~` leaf. */
function escapedInner(args: BuildArgs): t2.Node | null {
  for (const c of args.children) {
    if (t2.isNode(c) && (c.type === 'Interp' || c.type === 'Quoted')) return c;
  }
  return null;
}

/** Drop the surrounding quote chars from an interpolated string's literal parts
 *  (the Less "unquote" of an escaped `~"@{a}"`): the first part is a literal that
 *  opens with the quote char and the last is a literal that closes with it (the
 *  grammar wraps the leaves in `literal('"')…literal('"')`), so strip those two
 *  chars and drop any part that empties out. Refs keep their `unquote` flag. */
function unquoteInterp(interp: t2.Interp): t2.Interp {
  const parts = interp.parts.map((p) => ({ ...p }));
  const first = parts[0];
  if (first !== undefined && 'lit' in first) first.lit = first.lit.slice(1);
  const last = parts[parts.length - 1];
  if (last !== undefined && 'lit' in last) last.lit = last.lit.slice(0, -1);
  return t2.interp(parts.filter((p) => !('lit' in p) || p.lit !== ''));
}

/**
 * An escaped value `~"…"` / `~'…'` (Less "unquote"): the result is the inner
 * string's bytes WITHOUT the surrounding quotes. Interpolation inside the string
 * resolves exactly as in a plain quoted string, but the literal parts carry the
 * INNER bytes only (no quote chars) — so `~"@{a}"` emits the resolved value bare
 * (`blue`), not `"blue"`. A `~"…"` with no `@{ident}` token becomes an ESCAPED
 * `Quoted` whose `src` is the unquoted inner bytes (`~"3"` → `3`, `~"@{box"` → the
 * literal `@{box`), so the declaration / variable whole-value path emits it
 * byte-for-byte (inert emit is `node.src`, unchanged from the prior `Any`).
 *
 * The escaped `Quoted` is OPAQUE, NOT numeric: unlike a plain `Any` it does NOT
 * sniff its bytes to a value type, so `~"4"` stays an escaped string (materialize
 * → `Quoted{escaped:true}`) and is NOT coerced to `Dimension(4)`. Guard comparison
 * (`value-guards.ts`) then treats a number-vs-escaped `<`/`>` as not-comparable and
 * `=` as a `toCSS` string equality — matching less.js (`3 = ~"3"` true, no spurious
 * `5 > ~"4"`). Escaping stripped the type: the value is a bare string, not a number.
 *
 * Consumes the inner `Quoted`/`Interp` the §3.3 grammar built (P0: no byte
 * re-scan). An escaped PAREN `~( … )` is a raw-list shape this leaf does not model;
 * it keeps its verbatim `~(…)` bytes (unchanged from the prior no-action behavior).
 */
function escapedLeaf(args: BuildArgs): t2.ValueNode {
  const inner = escapedInner(args);
  if (inner !== null) {
    if (inner.type === 'Interp') return unquoteInterp(inner);
    // `src` = the bare inner bytes (byte-identical inert emit); `escaped: true`
    // marks it opaque so materialize builds a `Quoted{escaped}`, never a sniff.
    if (inner.type === 'Quoted') return t2.quoted(inner.value, inner.value, inner.quote, true);
  }
  return t2.any(leafBytes(args));
}

/**
 * `url(...)` — opaque bytes VERBATIM, except a body that carries Less resolution:
 *   • `url("…@{x}…")` — the §3.3 `Quoted` grammar structured the string into an
 *     `Interp` (quote chars ride in the literal parts). Wrap those parts in
 *     `url(` … `)` so the reference resolves (`url("@{b}/x") → url("/img/x")`),
 *     reusing the shared `interpFromChildren` seam (P0 — no byte re-scan here).
 *   • `url(@var)` — a bare variable `Reference` body: splice the variable's value
 *     WITHOUT unquoting (`@a: 'x'` → `url('x')`), matching Less.
 * A plain `url("/p.svg")` (flat `Quoted`) or unquoted `url(image.png)` (`urlInner`
 * leaf) has no reference, so it stays the byte-identical verbatim `Any`.
 */
function urlLeaf(args: BuildArgs): t2.ValueNode {
  const bytes = leafBytes(args);
  // Exactly one body node exists (the grammar's `url(` / `)` / url-token are leaves).
  const body = args.children.find(t2.isNode);
  if (body === undefined) return t2.any(bytes); // unquoted / empty url() → verbatim
  if (body.type === 'Interp') {
    return t2.interp([{ lit: 'url(' }, ...body.parts, { lit: ')' }]);
  }
  if (body.type === 'VarRef' || body.type === 'PropRef'
    || body.type === 'VarIndirect' || body.type === 'MapAccessor') {
    return t2.interp([{ lit: 'url(' }, { ref: body, unquote: false }, { lit: ')' }]);
  }
  return t2.any(bytes); // flat Quoted / placeholder → verbatim
}

export const VALUE_LEAF_ACTIONS: readonly BuildAction[] = [
  { type: 'Numeric', build: numericLeaf },
  // `#fff` / `#AABBCC` — hex color (materialize distinguishes hex via `src[0]==='#'`).
  leaf('Color', t2.color),
  // `red` / `transparent` — the grammar resolved a named color (authoritative
  // even for names outside tree2's own color table).
  leaf('NamedColor', t2.color),
  // A bare identifier keyword (`solid`, `auto`) in a typed position.
  leaf('Keyword', t2.keyword),
  { type: 'Quoted', build: quotedLeaf },
  // `~"…"` / `~'…'` — escaped (unquoted-output) string with interpolation.
  { type: 'EscapedValue', build: escapedLeaf },
  // `url(...)` — verbatim, except an interpolated / variable body (see `urlLeaf`).
  { type: 'Url', build: urlLeaf },
];
