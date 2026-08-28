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
 * The ONLY node that sniffs is the opaque `Any` leaf (and a genuinely-synthetic /
 * computed string with no parse origin): its value type is honestly unknown, so
 * `materializeAny` / `sniffLiteral` classify the bytes. A PARSED typed literal never
 * touches the sniff. The former `LiteralTag` enum / `LitFields` / packed-tag
 * contract are gone — the node type IS the classification.
 */
import type { Value } from './value-eval.js';
import { HEX } from './color.js';
import { makeColorRgb, makeKeyword } from './value-factory.js';
import { namedColor } from './color-names.js';

/*
 * SYNTHETIC-ONLY classifiers, used solely by the `Any` / computed-string sniff. A
 * PARSED literal reaches materialize already typed (its node), so it never touches
 * these; classifying a genuinely-synthetic string here is not re-deriving parser
 * output (the parser never saw it).
 */
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Byte-identical port of `parseHexString` (tree/color.ts). */
export function parseHex(hex: string): { rgb: [number, number, number]; alpha: number } {
  const hexValue = hex.slice(1);
  const rgba: number[] = [];
  if (hexValue.length >= 6) {
    const chunks = hexValue.match(/.{2}/g) ?? [];
    chunks.forEach((c, i) => {
      if (i < 3) {
        rgba.push(parseInt(c, 16));
      } else {
        rgba.push(parseInt(c, 16) / 255);
      }
    });
  } else {
    hexValue.split('').forEach((c, i) => {
      if (i < 3) {
        rgba.push(parseInt(c + c, 16));
      } else {
        rgba.push(parseInt(c + c, 16) / 255);
      }
    });
  }
  const [r = 0, g = 0, b = 0, a = 1] = rgba;
  return { rgb: [r, g, b], alpha: a };
}

/** Synthetic-only numeric split (no pre-parsed fields): a computed numeric string. */
function dimensionFromString(str: string): Value {
  const m = NUM_RE.exec(str);
  const unit = m?.[1] ?? '';
  return { type: 'Dimension', number: Number(str.slice(0, str.length - unit.length)), unit, bytes: str };
}

/** True when `s` opens and closes with the SAME quote char (`"…"` / `'…'`). */
function isQuotedBytes(s: string): boolean {
  const c = s.charCodeAt(0);
  return s.length >= 2 && (c === 34 /* " */ || c === 39 /* ' */) && s.charCodeAt(s.length - 1) === c;
}

/** A quoted value node from its verbatim bytes (quote char known from the bytes). */
function quotedFromBytes(str: string): Value {
  return { type: 'Quoted', value: str.slice(1, -1), quote: str[0]!, escaped: false, bytes: str };
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
    return makeColorRgb(rgb, alpha, HEX, { src });
  }
  const named = namedColor(src);
  if (named) {
    return makeColorRgb(named.rgb, named.alpha, HEX, { src });
  }
  return makeKeyword(src);
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
    return { type: 'Dimension', number, unit, bytes };
  }
  return { type: 'Dimension', number, unit, bytes: src };
}

/** A parsed `Quoted` leaf → value `Quoted`, reading its pre-split fields. */
export function quotedFromFields(value: string, quote: string, escaped: boolean, src: string): Value {
  return { type: 'Quoted', value, quote, escaped, bytes: src };
}

/* --------------------------------------------------------------- sniff path */

/**
 * Classify + build a SYNTHETIC / opaque string (the `Any` leaf, or a computed /
 * joined fragment forced onto the typed path) by sniffing its bytes. A quoted-
 * looking string materializes as a quoted value; `true`/`false` as a value-domain
 * `Bool` (guard booleanness — no AST `Bool` node exists); a numeric / hex / named-
 * color shape as its typed value; else a keyword. This is the ONLY byte sniff.
 */
function sniffBuild(text: string): Value {
  const c0 = text.charCodeAt(0);
  if (c0 === 35 /* # */ && HEX_RE.test(text)) {
    const { rgb, alpha } = parseHex(text);
    return makeColorRgb(rgb, alpha, HEX, { src: text });
  }

  // Numeric: ONE family (united or unitless — no split).
  if ((c0 >= 48 && c0 <= 57) || c0 === 43 || c0 === 45 || c0 === 46) {
    if (NUM_RE.test(text)) {
      return dimensionFromString(text);
    }
  }
  if (text === 'true' || text === 'false') {
    return { type: 'Bool', value: text === 'true', bytes: text };
  }

  // A bare identifier that names a CSS color materializes as a Color.
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(text)) {
    const named = namedColor(text);
    if (named) {
      return makeColorRgb(named.rgb, named.alpha, HEX, { src: text });
    }
  }
  return isQuotedBytes(text) ? quotedFromBytes(text) : makeKeyword(text);
}

/**
 * Materialize an opaque `Any` leaf: sniff its verbatim `src` with NO trim (byte-
 * identical to the former untagged-literal typed path).
 */
export function materializeAny(src: string): Value {
  return sniffBuild(src);
}

/**
 * Materialize a SYNTHETIC / COMPUTED string that carries no node type (a joined
 * `Sequence`/`Interpolation` result forced in a typed position): trim, then sniff. This is
 * the `ValueEvaluator.materialize` seam body.
 */
export function sniffLiteral(str: string): Value {
  return sniffBuild(str.trim());
}
