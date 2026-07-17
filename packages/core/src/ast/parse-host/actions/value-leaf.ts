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

/**
 * A quoted string `"…"` / `'…'`. The `Quoted` grammar rule is DISTINCT from an
 * ident, so it is tagged `Quoted` and carries its inner value + quote char as
 * `LitFields` — materialize reads them instead of a `QUOTE_RE` re-scan. `escaped`
 * is false by construction: an escaped `~"…"` is a separate `EscapedValue` rule,
 * never this leaf, so the flag is read from the grammar structure, not hardcoded.
 */
function quotedLeaf(args: BuildArgs): t2.Word {
  const bytes = leafBytes(args);
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
