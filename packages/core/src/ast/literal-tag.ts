/**
 * LITERAL MATERIALIZATION — build a typed value-domain `Value` from an AST
 * value-literal leaf (VALUE-NODE-MODEL-DESIGN, task #44).
 *
 * Post-reshape, every parsed leaf carries its value TYPE in the node `type`
 * (`Keyword`/`Color`/`Dimension`/`Quoted`) plus its verbatim `src`, so a forced
 * (operated / compared / typed-param) literal materializes by reading FIELDS —
 * NOT by re-classifying `src` with a regex (constitution P0). The per-type build
 * bodies (`colorFromSrc`, `dimensionFromFields`, `quotedFromFields`) live here; the
 * serializer's `evalTyped` switch calls them by node type.
 *
 * The byte sniff (`sniffLiteral`) types text the parser never saw: a plain
 * string a JS/legacy plugin or module function returns, a host value, or a
 * sass-spec fixture literal. Text the parser produced is typed from the parse,
 * never through here — including an opaque `Any` leaf, which is opaque bytes
 * (ledger V3), and an eager mixin-argument snapshot, which carries the value it
 * was evaluated to. The tolerant-CST collection-key reader is the one parser
 * reader left, escalated (a CST leaf carries no typed value). The former
 * `LiteralTag` enum / `LitFields` / packed-tag contract are gone — the node type
 * IS the classification.
 */
import type { Color, Value } from './value-eval.js';
import { HEX } from './color.js';
import { makeBool, makeKeyword } from './value-factory.js';
import { ColorValueNode, DimensionValueNode, QuotedValueNode } from './node-ctors.js';
import { namedColor } from './color-names.js';

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/*
 * SYNTHETIC-ONLY classifiers, used solely by the sniff below. A PARSED literal is
 * typed by its node, so it never touches these.
 */
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * The rgb and alpha a hex colour spells: `#` and 3, 4, 6 or 8 hex digits, as the
 * grammar's colour token and {@link HEX_RE} take them. A short digit `d` is the
 * byte `dd`, `d * 17`; the alpha, given by four or eight digits, is its byte over 255.
 */
export function parseHex(hex: string): { rgb: [number, number, number]; alpha: number } {
  const short = hex.length < 6;
  const width = short ? 1 : 2;
  const channel = (i: number): number => parseInt(hex.slice(1 + i * width, 1 + width + i * width), 16) * (short ? 17 : 1);
  return { rgb: [channel(0), channel(1), channel(2)], alpha: hex.length % 4 === 1 ? channel(3) / 255 : 1 };
}

/** Synthetic-only numeric split (no pre-parsed fields): a computed numeric string. */
function dimensionFromString(str: string): Value {
  const m = NUM_RE.exec(str);
  const unit = m?.[1] ?? '';
  return new DimensionValueNode(Number(str.slice(0, str.length - unit.length)), unit, str);
}

/** True when `s` opens and closes with the SAME quote char (`"…"` / `'…'`). */
function isQuotedBytes(s: string): boolean {
  const c = s.charCodeAt(0);
  return s.length >= 2 && (c === 34 /* " */ || c === 39 /* ' */) && s.charCodeAt(s.length - 1) === c;
}

/** A quoted value node from its verbatim bytes (quote char known from the bytes). */
function quotedFromBytes(str: string): Value {
  return new QuotedValueNode(str.slice(1, -1), str[0]!, false, str);
}

/* --------------------------------------------------- typed-leaf materializers */

/**
 * A parsed `Color` leaf → value `Color`. Hex (`#…`) parses its channels; a named
 * color resolves through the shared table (`lighten(red,…)` / `iscolor(blue)`), and
 * the verbatim spelling rides in `src` for byte-faithful emit; a name absent from
 * the table falls through to a plain keyword. The grammar is authoritative that the
 * leaf IS a color, so this reads one byte (`#`) rather than re-classifying.
 */
export function colorFromSrc(src: string): Value {
  if (src.charCodeAt(0) === 35 /* # */) {
    const { rgb, alpha } = parseHex(src);
    return spelledColor(src, rgb, alpha);
  }
  const named = namedColor(src);
  if (named) {
    return spelledColor(src, named.rgb, named.alpha);
  }
  return makeKeyword(src);
}

/**
 * A colour as its author spelled it, a hex or a name, with its channels; the
 * browser runtime builds a recipe's colour name with it too (R8 spec). Its
 * bytes are its spelling, as `serializeColor` writes a colour with a `src`, so
 * it is built without the serializer: a runtime page that reads a hex bundles
 * no colour writer.
 */
export function spelledColor(src: string, rgb: readonly [number, number, number], alpha: number): Color {
  const c: Mutable<Color> = new ColorValueNode(rgb, alpha, HEX, src);
  c.src = src;
  return c;
}

/**
 * Coerce a named-color `Keyword` VALUE to its `Color` at a POINT OF USE
 * (arithmetic operand, a `Color`-typed function parameter, a color type
 * predicate). Convergence keeps `red` a `Keyword` node so an un-operated
 * `color: red` still emits its verbatim bytes; a keyword that names a CSS color
 * only becomes a `Color` where its colour-ness is actually consulted. A keyword
 * that is not a named color, and any non-keyword value, passes through
 * untouched.
 */
export function coerceNamedColorKeyword(value: Value): Value {
  if (value.type === 'Keyword' && namedColor(value.text) !== undefined) {
    return colorFromSrc(value.text);
  }
  return value;
}

/**
 * A parsed `Dimension` leaf → value `Dimension`, reading the pre-split
 * `number`/`unit` (never re-splitting `src`). Un-operated dimensions preserve their
 * SOURCE spelling verbatim (`1.0px`→`1.0px`, `2PX`→`2PX`).
 *
 * The ONE rewrite is a SPELLING rule, not a precision one: Less serializes a
 * leading-decimal dimension canonically (`.3s` → `0.3s`, `-.3s` → `-0.3s`) even when
 * it has not participated in arithmetic. It is applied by INSERTING the `0`, not by
 * reformatting the number — so the authored digits survive it (`.50000px` →
 * `0.50000px`, never `0.5px`). Running the source through the number policy here
 * would make an un-operated literal answer to a rule that governs computed values.
 *
 * There used to be a second rewrite — a source whose value could not survive the 8-dp
 * canonical floor was DENOISED to the rounded form, which silently turned an authored
 * `0.00000000123456789` into `0`. Its only justification was matching a serializer
 * floor that no longer exists, and it contradicted verbatim preservation outright, so
 * it is gone: an un-operated literal now keeps its exact value.
 */
export function dimensionFromFields(number: number, unit: string, src: string): Value {
  const numericStart = src.charCodeAt(0) === 0x2d /* - */ ? 1 : 0;
  if (Number.isFinite(number) && src.charCodeAt(numericStart) === 0x2e /* . */) {
    const bytes = numericStart === 0 ? `0${src}` : `-0${src.slice(1)}`;
    return new DimensionValueNode(number, unit, bytes);
  }
  return new DimensionValueNode(number, unit, src);
}

/** A parsed `Quoted` leaf → value `Quoted`, reading its pre-split fields. */
export function quotedFromFields(value: string, quote: string, escaped: boolean, src: string): Value {
  return new QuotedValueNode(value, quote, escaped, src);
}

/* --------------------------------------------------------------- sniff path */

/**
 * Classify + build a string the parser never typed by sniffing its bytes. A
 * quoted-looking string materializes as a quoted value; `true`/`false` as a
 * value-domain `Bool` (guard booleanness — no AST `Bool` node exists); a numeric /
 * hex shape as its typed value, a colour name too when `named` is given; else
 * a keyword.
 */
function sniffBuild(text: string, named?: typeof namedColor): Value {
  const c0 = text.charCodeAt(0);
  if (c0 === 35 /* # */ && HEX_RE.test(text)) {
    const { rgb, alpha } = parseHex(text);
    return spelledColor(text, rgb, alpha);
  }

  // Numeric: ONE family (united or unitless — no split).
  if ((c0 >= 48 && c0 <= 57) || c0 === 43 || c0 === 45 || c0 === 46) {
    if (NUM_RE.test(text)) {
      return dimensionFromString(text);
    }
  }
  if (text === 'true' || text === 'false') {
    return makeBool(text === 'true');
  }

  // A bare identifier that names a CSS color materializes as a Color.
  if (named !== undefined && /^[a-zA-Z][a-zA-Z0-9]*$/.test(text)) {
    const color = named(text);
    if (color) {
      return spelledColor(text, color.rgb, color.alpha);
    }
  }
  return isQuotedBytes(text) ? quotedFromBytes(text) : makeKeyword(text);
}

/**
 * Type a string the parser never saw — a JS/legacy plugin or module function's
 * plain string result, a host value, a tolerant-CST leaf with no AST: trim, then
 * sniff.
 */
export function sniffLiteral(str: string): Value {
  return sniffBuild(str.trim(), namedColor);
}

/** {@link sniffLiteral} without the colour-name table: a name stays the keyword it spells, as the compile reads one. */
export function sniffUnnamed(str: string): Value {
  return sniffBuild(str.trim());
}
