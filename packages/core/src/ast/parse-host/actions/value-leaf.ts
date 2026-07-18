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

/** A Less identifier byte (`lessInterp` name class: `-_A-Za-z0-9` + non-ASCII). */
function isIdentByte(c: number): boolean {
  return c === 0x2d /* - */ || c === 0x5f /* _ */
    || (c >= 0x30 && c <= 0x39) /* 0-9 */
    || (c >= 0x41 && c <= 0x5a) /* A-Z */
    || (c >= 0x61 && c <= 0x7a) /* a-z */
    || c >= 0x80;
}

/**
 * TODO(tier-b/A4): host-side `@{name}` re-tokenizer for interpolation INSIDE a
 * quoted string (`"http://x@{var}/y"`). WHY — the maintained grammar emits the
 * whole `"…@{…}…"` as ONE opaque `singleStr`/`doubleStr` leaf (interpolation inside
 * a string is not split), so the direct ast/ host re-scans the bytes here, exactly
 * as the legacy bridge does via `_buildStringInterpolation`/`INTERPOLATION_REGEX`.
 * RETIREMENT TRIGGER — the §3.3 `Quoted` grammar split (structured `string | Node[]`);
 * it touches the SHARED css `Quoted` the legacy BuilderHost re-tokenizes, so it
 * lands with the legacy-BuilderHost retirement (reorg A4). This host tokenizer keeps
 * the direct-host string interpolation resolving in the meantime, WITHOUT touching
 * the grammar or the bridge (so bridge byte-identity is unaffected by construction).
 *
 * STRICT (matches the §4.1 owner decision): only a clean `@{ident}` token (no
 * interior whitespace/dot, and NOT nested `@{…@{…}…}`) is a ref; anything else
 * stays a literal chunk. Returns `null` when the string carries no resolvable
 * `@{ident}` token, so the caller keeps the byte-identical plain-`Quoted` path.
 * Quote chars ride in the literal parts, and each ref splices `unquote:true`
 * (Less "unquote-on-interpolation" — `evalInterp` strips one quote layer).
 */
function quotedInterp(bytes: string): t2.Interp | null {
  const parts: t2.InterpPart[] = [];
  let lit = '';
  let sawRef = false;
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    // Detect a clean `@{ident}` token: `@` `{` (`-`? ident-run) `}`.
    if (bytes.charCodeAt(i) === 0x40 /* @ */ && i + 1 < n && bytes.charCodeAt(i + 1) === 0x7b /* { */) {
      let j = i + 2;
      if (j < n && bytes.charCodeAt(j) === 0x2d /* - */) j++;
      const nameStart = j;
      while (j < n && isIdentByte(bytes.charCodeAt(j))) j++;
      if (j > nameStart && j < n && bytes.charCodeAt(j) === 0x7d /* } */) {
        if (lit) { parts.push({ lit }); lit = ''; }
        parts.push({ ref: t2.varRef(bytes.slice(i + 2, j).trim()), unquote: true });
        sawRef = true;
        i = j + 1;
        continue;
      }
    }
    lit += bytes[i]!;
    i++;
  }
  if (!sawRef) return null;
  if (lit) parts.push({ lit });
  return t2.interp(parts);
}

/**
 * A quoted string `"…"` / `'…'`. The `Quoted` grammar rule is DISTINCT from an
 * ident, so it is tagged `Quoted` and carries its inner value + quote char as
 * `LitFields` — materialize reads them instead of a `QUOTE_RE` re-scan. `escaped`
 * is false by construction: an escaped `~"…"` is a separate `EscapedValue` rule,
 * never this leaf, so the flag is read from the grammar structure, not hardcoded.
 *
 * A string carrying `@{name}` interpolation becomes an `Interp` template (the
 * literal parts keep the quote chars) so the reference resolves; a plain string
 * stays the byte-identical `Quoted` node. See `quotedInterp` for the Tier-B note.
 */
function quotedLeaf(args: BuildArgs): t2.ValueNode {
  const bytes = leafBytes(args);
  const interp = quotedInterp(bytes);
  if (interp !== null) return interp;
  return t2.quoted(bytes, bytes.slice(1, -1), bytes[0]!, false);
}

/**
 * An escaped value `~"…"` / `~'…'` (Less "unquote"): the result is the inner
 * string's bytes WITHOUT the surrounding quotes. Interpolation inside the string
 * resolves exactly as in a plain quoted string, but the literal parts carry the
 * INNER bytes only (no quote chars) — so `~"@{a}"` emits the resolved value bare
 * (`blue`), not `"blue"`. A `~"…"` with no `@{ident}` token becomes a plain `Any`
 * of the unquoted inner bytes (`~"@{box"` → the literal `@{box`), which the
 * declaration / variable whole-value path consumes byte-for-byte. The unquoted
 * inner is opaque (`Any`): escaping already stripped its type.
 *
 * An escaped PAREN `~( … )` is a raw-list shape this leaf does not model; it keeps
 * its verbatim `~(…)` bytes (unchanged from the prior no-action behavior).
 */
function escapedLeaf(args: BuildArgs): t2.ValueNode {
  const bytes = leafBytes(args);
  const q = bytes.charCodeAt(1);
  if (q === 0x22 /* " */ || q === 0x27 /* ' */) {
    const inner = bytes.slice(2, -1); // strip the `~` and the surrounding quotes
    return quotedInterp(inner) ?? t2.any(inner);
  }
  return t2.any(bytes);
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
  // `url(...)` — opaque bytes, verbatim, no coercion.
  leaf('Url', t2.any),
];
