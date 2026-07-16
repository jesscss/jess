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

export enum LiteralTag {
  /** ident/keyword (`solid`,`auto`) — default + safe fallback for untagged strings. */
  Keyword = 0,
  /** `T.Dimension`, `Signed`+unit → value `Dimension`. */
  Dimension = 1,
  /** `T.Number`, `MathConstant` → unitless value `Dimension`. */
  Num = 2,
  /** `T.Color` (`#…`) → `Color` (verbatim node). */
  ColorHex = 3,
  /** color-table ident / `transparent` → named `Color`. */
  ColorNamed = 4,
  /** `true`/`false` (less) → `Bool`. */
  Bool = 5,
  /** verbatim fallback / role-typed `Any` → keyword, no coercion. */
  Any = 6,
}

/**
 * The kind occupies the low 3 bits (values 0-6). Bit 3 is RESERVED for compressed
 * mode (not used yet): `LIT_ALREADY_MINIMAL` marks a verbatim value that is
 * already minimal (dart-sass `compressed` would leave it unchanged), so the
 * future minifier can skip it. Reserving the bit now is free; adding it to the
 * packed struct later is a reshape. Consumers mask with `LIT_TAG_MASK`.
 */
export const LIT_TAG_MASK = 0b111;
export const LIT_ALREADY_MINIMAL = 1 << 3; // 8 — reserved, unused

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const QUOTE_RE = /^(['"])([\s\S]*)\1$/;

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

function dimensionFromString(str: string): ValueObj {
  const m = NUM_RE.exec(str);
  const unit = m?.[1] ?? '';
  return { kind: 'dimension', number: Number(str.slice(0, str.length - unit.length)), unit, bytes: str };
}

/**
 * Materialize a literal (its verbatim bytes) to a typed `ValueObj`, driven by the
 * TAG — a `switch`, no regex sniff. The result is a FRESH object handed to the
 * operated/compared slot; it is never stored back (projection-not-mutation).
 *
 * NOTE (tree2 bridge gap): tree2's AST collapses value literals into verbatim
 * `Word` nodes, so `LIT_COLOR_NAMED` cannot resolve to a `Color` without a shared
 * color-name table — it stays a `Keyword` in the foundation (named-color color-ops
 * are scoped out). When the producer/bridge propagates the parser's finer
 * classification (spec §5), named colors materialize here.
 */
export function materializeLiteral(str: string, tag: LiteralTag): ValueObj {
  switch (tag & LIT_TAG_MASK) {
    case LiteralTag.Dimension:
    case LiteralTag.Num:
      return dimensionFromString(str);
    case LiteralTag.ColorHex: {
      const { rgb, alpha } = parseHex(str);
      return makeColorRgb(rgb, alpha, HEX, { node: str });
    }
    case LiteralTag.Bool:
      return makeBool(str === 'true');
    case LiteralTag.ColorNamed:
    case LiteralTag.Any:
    case LiteralTag.Keyword:
    default: {
      const q = QUOTE_RE.exec(str);
      if (q) return { kind: 'quoted', value: q[2]!, quote: q[1]!, escaped: false, bytes: str };
      return makeKeyword(str);
    }
  }
}

/**
 * Recover the literal tag for a tree2 `Word` leaf from its bytes. tree2's bridge
 * collapses dimensions/colors/keywords into verbatim `Word` nodes and does NOT
 * carry the parser's finer classification, so the tag is derived here. When the
 * bridge/producer stamps the tag (spec §5), this becomes a direct field read.
 * `Kind.Dimension` AST nodes DO carry their class — those are tagged from `Kind`,
 * not here.
 */
export function tagForWord(text: string): LiteralTag {
  const c0 = text.charCodeAt(0);
  if (c0 === 35 /* # */ && HEX_RE.test(text)) return LiteralTag.ColorHex;
  if ((c0 >= 48 && c0 <= 57) || c0 === 43 || c0 === 45 || c0 === 46) {
    const m = NUM_RE.exec(text);
    if (m) return m[1] ? LiteralTag.Dimension : LiteralTag.Num;
  }
  if (text === 'true' || text === 'false') return LiteralTag.Bool;
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
