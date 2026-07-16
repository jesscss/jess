/**
 * [tree2-native] Value-leaf family (F5): numeric / color / keyword / quoted / url
 * leaves, captured as a `Word` carrying the literal-tag classification the
 * grammar already knows.
 *
 * Each leaf grammar rule (`Numeric`, `Color`, `NamedColor`, `Keyword`, `Quoted`,
 * `Url`) maps to a tree2 `Word` of its verbatim source bytes plus a `LiteralTag`.
 * The tag is the same classification the bridge stamps via `stampLeaf`/`leafTagOf`
 * (VALUE-LITERAL-TAG-SPEC): it rides as a FIELD so `materialize` reads it instead
 * of re-sniffing the bytes. `tagForWord` is the shared byte→tag path for the
 * numeric/hex cases; the grammar type is authoritative for named-color / keyword /
 * quoted, which the bytes alone can misclassify.
 *
 * Byte-identity: the leaf `Word` is verbatim source bytes, so it serializes
 * exactly as the bridge's raw-bytes `Word` does (serialize emits `.text`; the tag
 * is metadata for eval only). The declaration family consumes a single whole-value
 * leaf; a leaf that is only PART of the value (`1px solid red` → only `red`
 * builds) is left for the declaration's verbatim-bytes fallback, so no value is
 * dropped.
 *
 * These leaves are also the typed OPERANDS the operation / call families (F6/F7)
 * consume — the reason F5 is their foundation.
 *
 * NOTE (dense-struct follow-up, plan §4b): the eventual dense value structs
 * (`Dimension{value,unit,rawBytes}`, `Color{…,rawBytes}`) replace the tagged
 * `Word` leaf as part of the Stage-3 lazy-leaf retirement — a tree2 node-set
 * change measured separately. F5 emits the current tagged `Word` (the bridge's
 * shape) so the byte-identity oracle holds during the transition.
 */
import * as t2 from '../../tree2/index.js';
import { LiteralTag, tagForWord } from '../../tree2/index.js';
import { type BuildAction, type BuildArgs, sliceSpan } from '../host-context.js';

/** Verbatim source bytes of the leaf's own span. */
function leafBytes(args: BuildArgs): string {
  return sliceSpan(args.ctx, args.span);
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

export const VALUE_LEAF_ACTIONS: readonly BuildAction[] = [
  // `1.0px` / `-3px` / `.5s` / `50%` → Dimension; bare `1` / `0` → Num.
  leaf('Numeric', tagForWord),
  // `#fff` / `#AABBCC` — hex color.
  leaf('Color', () => LiteralTag.ColorHex),
  // `red` / `transparent` — the grammar resolved a named color (authoritative
  // even for names outside tree2's own color table).
  leaf('NamedColor', () => LiteralTag.ColorNamed),
  // A bare identifier keyword (`solid`, `auto`) in a typed position.
  leaf('Keyword', () => LiteralTag.Keyword),
  // A quoted string rides as `Any` (no coercion; materialize keeps it verbatim).
  leaf('Quoted', () => LiteralTag.Any),
  // `url(...)` — the bridge leaves url untagged; match it (verbatim, no coercion).
  leaf('Url', () => undefined),
];
