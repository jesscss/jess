/**
 * VALUE-LITERAL TYPE TAG (per docs/future/core-architecture/VALUE-LITERAL-TAG-SPEC.md).
 *
 * A small numeric tag that rides on a packed literal value, carrying the PARSER's
 * classification so a forced (operated / compared / typed-param) literal
 * materializes to a typed `ValueObj` via a `switch` on the tag — NOT by
 * re-classifying the bytes with a regex/charCode heuristic. This is the spec's
 * `LIT_*` enum + `materializeLiteral` table, homed boundary-clean under `tree2/`
 * (the value path forbids importing `../tree`; when the legacy value-literal-tag
 * workstream lands `tree/util/literal-tag.ts`, these constants are the shared
 * cross-package contract).
 *
 * A real (non-`const`) enum on purpose: the tag crosses the core↔parser package
 * boundary, where a `const enum` under `isolatedModules` won't inline reliably
 * (mirrors `ColorFormat`).
 */
import type { ValueObj } from './value-eval.js';
import { HEX } from './serialize-value.js';
import { makeBool, makeColorRgb, makeDimension, makeKeyword } from './value-factory.js';
import { namedColor } from './color-names.js';

export enum LiteralTag {
  /** ident/keyword (`solid`,`auto`) — default + safe fallback for untagged strings. */
  Keyword = 0,
  /**
   * Any numeric literal → value `Dimension` (unit may be `''`). ONE tag for the
   * whole numeric family: the grammar rule (`Numeric`) is authoritative that the
   * leaf is a number, and `materialize` treats united and unitless numbers
   * identically (`dimensionFromString`), so there is no Dimension-vs-Num split to
   * re-decide from the bytes.
   */
  Dimension = 1,
  /**
   * @deprecated Bridge-legacy alias of `Dimension` (SAME value → one numeric tag).
   * Only `bridge.ts` / legacy `tree2-frontend/value-eval.ts` still name it, and
   * both are the double-build being deleted (constitution P1). New code uses
   * `Dimension`.
   */
  Num = 1,
  /** `T.Color` (`#…`) → `Color` (verbatim node). */
  ColorHex = 3,
  /** color-table ident / `transparent` → named `Color`. */
  ColorNamed = 4,
  /** `true`/`false` (less) → `Bool`. */
  Bool = 5,
  /** verbatim fallback / role-typed `Any` → keyword, no coercion. */
  Any = 6,
  /**
   * A quoted string (`"…"` / `'…'`) → value `Quoted`. The parser tokenizes a
   * string leaf DISTINCT from an ident, so the class rides on this tag rather than
   * a `QUOTE_RE` re-scan at materialize; the inner value + quote char + real
   * escaped flag ride in `LitFields`. Fits the 3-bit kind space (`LIT_TAG_MASK`),
   * below the reserved `LIT_ALREADY_MINIMAL` bit.
   */
  Quoted = 7,
}

/**
 * The pre-classified leaf payload the PARSER already resolved, carried on the
 * value leaf so `materializeLiteral` READS it instead of re-splitting the bytes
 * with a regex (constitution P0 — core never re-derives what the parser knows).
 * A numeric leaf carries `number`+`unit` (the grammar split them at
 * tokenization); a quoted leaf carries the inner `value`, the `quote` char, and
 * the real `escaped` flag. The tag discriminates which shape is present;
 * consumers narrow with an `in` guard (no cast).
 */
export type LitFields =
  | { readonly number: number; readonly unit: string }
  | { readonly value: string; readonly quote: string; readonly escaped: boolean };

/**
 * The kind occupies the low 3 bits (values 0-6). Bit 3 is RESERVED for compressed
 * mode (not used yet): `LIT_ALREADY_MINIMAL` marks a verbatim value that is
 * already minimal (dart-sass `compressed` would leave it unchanged), so the
 * future minifier can skip it. Reserving the bit now is free; adding it to the
 * packed struct later is a reshape. Consumers mask with `LIT_TAG_MASK`.
 */
export const LIT_TAG_MASK = 0b111;
export const LIT_ALREADY_MINIMAL = 1 << 3; // 8 — reserved, unused

// SYNTHETIC-ONLY classifiers. A PARSED literal reaches materialize already
// classified (its `LitFields` / `tag`), so it never touches these. They fire only
// for a genuinely-synthetic string with no parse origin — a computed / joined
// fragment or a re-split list piece (`tagForWord` / `sniffLiteral`) — which the
// parser never saw, so classifying it here is not re-deriving parser output.
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Byte-identical port of `parseHexString` (tree/color.ts). */
export function parseHex(hex: string): { rgb: [number, number, number]; alpha: number } {
  const hexValue = hex.slice(1);
  const rgba: number[] = [];
  if (hexValue.length >= 6) {
    const chunks = hexValue.match(/.{2}/g) ?? [];
    chunks.forEach((c, i) => {
      if (i < 3) rgba.push(parseInt(c, 16));
      else rgba.push(parseInt(c, 16) / 255);
    });
  } else {
    hexValue.split('').forEach((c, i) => {
      if (i < 3) rgba.push(parseInt(c + c, 16));
      else rgba.push(parseInt(c + c, 16) / 255);
    });
  }
  const [r = 0, g = 0, b = 0, a = 1] = rgba;
  return { rgb: [r, g, b], alpha: a };
}

/** Synthetic-only numeric split (no `LitFields`): a computed numeric string. */
function dimensionFromString(str: string): ValueObj {
  const m = NUM_RE.exec(str);
  const unit = m?.[1] ?? '';
  return { type: 'Dimension', number: Number(str.slice(0, str.length - unit.length)), unit, bytes: str };
}

/** True when `s` opens and closes with the SAME quote char (`"…"` / `'…'`). */
function isQuotedBytes(s: string): boolean {
  const c = s.charCodeAt(0);
  return s.length >= 2 && (c === 34 /* " */ || c === 39 /* ' */) && s.charCodeAt(s.length - 1) === c;
}

/** A quoted `ValueObj` from its verbatim bytes (quote char known from the bytes). */
function quotedFromBytes(str: string): ValueObj {
  return { type: 'Quoted', value: str.slice(1, -1), quote: str[0]!, escaped: false, bytes: str };
}

/**
 * Materialize a literal (its verbatim bytes) to a typed `ValueObj`, driven by the
 * TAG + the parser's `LitFields` — a `switch`, no regex sniff. When the parser
 * carried the split (`lit`) the numeric / quoted fields are read directly; only a
 * genuinely-synthetic string (no `lit`) falls back to a byte split. The result is
 * a FRESH object handed to the operated/compared slot; it is never stored back
 * (projection-not-mutation).
 *
 * A `LIT_COLOR_NAMED` word resolves to a `Color` through the shared color-name
 * table (`color-names.ts`), so operated/compared named colors (`lighten(red,…)`,
 * `iscolor(blue)`) behave like the legacy `Color`. The verbatim spelling rides in
 * `node` for byte-faithful emit; a name absent from the table falls through to a
 * plain keyword.
 */
export function materializeLiteral(str: string, tag: LiteralTag, lit?: LitFields): ValueObj {
  switch (tag & LIT_TAG_MASK) {
    // One numeric tag (`Num` is a same-value alias of `Dimension`).
    case LiteralTag.Dimension:
      // Parser carried the number/unit split → read it; else split a synthetic.
      if (lit && 'number' in lit) return { type: 'Dimension', number: lit.number, unit: lit.unit, bytes: str };
      return dimensionFromString(str);
    case LiteralTag.ColorHex: {
      const { rgb, alpha } = parseHex(str);
      return makeColorRgb(rgb, alpha, HEX, { node: str });
    }
    case LiteralTag.ColorNamed: {
      const named = namedColor(str);
      if (named) return makeColorRgb(named.rgb, named.alpha, HEX, { node: str });
      return makeKeyword(str);
    }
    case LiteralTag.Bool:
      return makeBool(str === 'true');
    case LiteralTag.Quoted:
      // Parser classified the string leaf → read its quote/value/escaped fields;
      // a synthetic quoted (no `lit`) recovers them from the bytes (no regex).
      if (lit && 'value' in lit) return { type: 'Quoted', value: lit.value, quote: lit.quote, escaped: lit.escaped, bytes: str };
      return quotedFromBytes(str);
    case LiteralTag.Any:
    case LiteralTag.Keyword:
    default:
      // Untagged / verbatim-`Any` leaf: a quoted-looking string still materializes
      // as a quoted value (byte-identical to the former `QUOTE_RE`), else keyword.
      return isQuotedBytes(str) ? quotedFromBytes(str) : makeKeyword(str);
  }
}

/**
 * SYNTHETIC-only classifier for a `Word` with no producer-stamped `tag` — a
 * computed / joined fragment forced onto the typed path. The parser never saw
 * this string, so classifying its bytes here is NOT re-deriving parser output
 * (constitution P0): a PARSED literal always arrives tagged (+ `LitFields`) and
 * bypasses this entirely. A quoted-looking synthetic string is left `Keyword`;
 * `materializeLiteral`'s default recovers its quotedness from the bytes.
 */
export function tagForWord(text: string): LiteralTag {
  const c0 = text.charCodeAt(0);
  if (c0 === 35 /* # */ && HEX_RE.test(text)) return LiteralTag.ColorHex;
  // Numeric: ONE tag for the whole family (united or unitless — no split).
  if ((c0 >= 48 && c0 <= 57) || c0 === 43 || c0 === 45 || c0 === 46) {
    if (NUM_RE.test(text)) return LiteralTag.Dimension;
  }
  if (text === 'true' || text === 'false') return LiteralTag.Bool;
  // A bare identifier that names a CSS color materializes as a Color (parity with
  // the adapter's `sniff`, which resolves named colors before falling to keyword).
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(text) && namedColor(text)) return LiteralTag.ColorNamed;
  return LiteralTag.Keyword;
}

/**
 * Untagged fallback (spec §3 `sniffStringTerminal`): classify a SYNTHETIC / COMPUTED
 * string that carries no parse tag (e.g. a joined `Concat`/`Interp` result forced
 * in a typed position). Delegates to `tagForWord` + `materializeLiteral` so there is
 * one classification path.
 */
export function sniffLiteral(str: string): ValueObj {
  const b = str.trim();
  return materializeLiteral(b, tagForWord(b));
}
