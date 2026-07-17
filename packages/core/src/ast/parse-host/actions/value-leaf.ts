/**
 * Value-leaf family: numeric / color / keyword / quoted / url
 * leaves, captured as a `Word` carrying the literal-tag classification the
 * grammar already knows.
 *
 * Each leaf grammar rule (`Numeric`, `Color`, `NamedColor`, `Keyword`, `Quoted`,
 * `Url`) maps to a tree2 `Word` of its verbatim source bytes plus a `LiteralTag`.
 * The tag is the same classification the bridge stamps via `stampLeaf`/`leafTagOf`
 * (VALUE-LITERAL-TAG-SPEC): it rides as a FIELD so `materialize` reads it instead
 * of re-sniffing the bytes. Every leaf tag is fixed by the grammar RULE (`Numeric`
 * → the single numeric `Dimension` tag, `Color` → `ColorHex`, …): the parser
 * already decided the class, so the build host never re-scans the bytes to
 * classify them.
 *
 * Byte-identity: the leaf `Word` is verbatim source bytes, so it serializes
 * exactly as the bridge's raw-bytes `Word` does (serialize emits `.text`; the tag
 * is metadata for eval only). The declaration family consumes a single whole-value
 * leaf; a leaf that is only PART of the value (`1px solid red` → only `red`
 * builds) is left for the declaration's verbatim-bytes fallback, so no value is
 * dropped.
 *
 * These leaves are also the typed OPERANDS the operation / call families
 * consume — the reason F5 is their foundation.
 *
 * NOTE (dense-struct follow-up, plan §4b): the eventual dense value structs
 * (`Dimension{value,unit,rawBytes}`, `Color{…,rawBytes}`) replace the tagged
 * `Word` leaf as part of the Stage-3 lazy-leaf retirement — a tree2 node-set
 * change measured separately. F5 emits the current tagged `Word` (the bridge's
 * shape) so the byte-identity oracle holds during the transition.
 */
import * as t2 from '../../index.js';
import { LiteralTag, type LitFields } from '../../index.js';
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

/** A leaf action producing `word(bytes, tag)`; `tagOf` may inspect the bytes. */
function leaf(type: string, tagOf: (bytes: string) => LiteralTag | undefined): BuildAction {
  return {
    type,
    build: (args) => {
      const bytes = leafBytes(args);
      return t2.word(bytes, tagOf(bytes));
    },
  };
}

/**
 * `1.0px` / `-3px` / `.5s` / `50%` / bare `1` — the grammar rule already SPLIT the
 * number leaf from the unit leaf (`noTrivia(sequence(numPart, optional(unit)))`),
 * so the value node carries `{number, unit}` directly as `LitFields`; a forced
 * (operated) numeric reads it with no `NUM_RE` re-split. The verbatim source bytes
 * still ride in `text` for byte-faithful emit. If the parser ever hands a shape
 * without the clean split, `lit` is omitted and materialize splits as a fallback.
 */
function numericLeaf(args: BuildArgs): t2.Word {
  const bytes = leafBytes(args);
  // The grammar delivers the number leaf then (optionally) the unit leaf — the
  // same split the css-parser `_buildDimension` reads. Filter to leaves so no
  // non-leaf child shifts the indices.
  const leaves = args.children.map(leafValue).filter((v): v is string => v !== undefined);
  const lit: LitFields | undefined =
    leaves.length > 0 ? { number: Number(leaves[0]), unit: leaves[1] ?? '' } : undefined;
  return t2.word(bytes, LiteralTag.Dimension, lit);
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
 * stays the byte-identical tagged `Word`. See `quotedInterp` for the Tier-B note.
 */
function quotedLeaf(args: BuildArgs): t2.Word | t2.Interp {
  const bytes = leafBytes(args);
  const interp = quotedInterp(bytes);
  if (interp !== null) return interp;
  const lit: LitFields = { value: bytes.slice(1, -1), quote: bytes[0]!, escaped: false };
  return t2.word(bytes, LiteralTag.Quoted, lit);
}

export const VALUE_LEAF_ACTIONS: readonly BuildAction[] = [
  { type: 'Numeric', build: numericLeaf },
  // `#fff` / `#AABBCC` — hex color.
  leaf('Color', () => LiteralTag.ColorHex),
  // `red` / `transparent` — the grammar resolved a named color (authoritative
  // even for names outside tree2's own color table).
  leaf('NamedColor', () => LiteralTag.ColorNamed),
  // A bare identifier keyword (`solid`, `auto`) in a typed position.
  leaf('Keyword', () => LiteralTag.Keyword),
  { type: 'Quoted', build: quotedLeaf },
  // `url(...)` — the bridge leaves url untagged; match it (verbatim, no coercion).
  leaf('Url', () => undefined),
];
