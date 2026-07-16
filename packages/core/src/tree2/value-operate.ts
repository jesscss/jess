/**
 * Native, SYNCHRONOUS value operations for the tree2 value domain — the
 * boundary-clean replacement for the adapter's legacy-delegating `operate` /
 * `materialize` / guard leaves. Ported byte-for-byte from the legacy
 * `Dimension.operate` / `Color.operate` (arithmetic + unit conversion +
 * rgb/hsl color math), plus the calc-splice + unoperable-keyword-preserve +
 * unit-clash → `calc()` guards that landed in the adapter.
 *
 * HARD MODULE BOUNDARY: imports only the value domain, the factory, and the free
 * serializer. Being synchronous is also what dissolves the benchmark's
 * async-dispatch throw.
 */
import type { Color, Dimension, EvalModes, ValueObj } from './value-eval.js';
import { makeColorRgb, makeDimension, makeKeyword } from './value-factory.js';

/* --------------------------------------------------------- unit conversion */

const enum Group { Length = 0, Duration = 1, Angle = 2 }
const UNIT_TO_GROUP = new Map<string, Group>([
  ['m', Group.Length], ['cm', Group.Length], ['mm', Group.Length], ['in', Group.Length],
  ['px', Group.Length], ['pt', Group.Length], ['pc', Group.Length],
  ['s', Group.Duration], ['ms', Group.Duration],
  ['rad', Group.Angle], ['deg', Group.Angle], ['grad', Group.Angle], ['turn', Group.Angle],
]);
const CONVERSIONS: Record<Group, Partial<Record<string, number>>> = {
  [Group.Length]: { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, px: 0.0254 / 96, pt: 0.0254 / 72, pc: 0.0254 / 72 * 12 },
  [Group.Duration]: { s: 1, ms: 0.001 },
  [Group.Angle]: { rad: 1 / (2 * Math.PI), deg: 1 / 360, grad: 1 / 400, turn: 1 },
};

function calculate(a: number, op: string, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
  }
  throw new TypeError(`Unknown operator ${op}`);
}

/* ---------------------------------------------------------- color math */

/** UNCLAMPED rgb source for color arithmetic (legacy `Color._rgb`). */
function rgbUnclamped(c: Color): [number, number, number] {
  if (c.hsl) {
    // hslToRgb without the round/clamp the serializer applies.
    const [h, s, l] = c.hsl;
    const hue = h / 360;
    if (s === 0) { const v = l * 255; return [v, v, v]; }
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, hue + 1 / 3) * 255, hue2rgb(p, q, hue) * 255, hue2rgb(p, q, hue - 1 / 3) * 255];
  }
  return [c.rgb[0], c.rgb[1], c.rgb[2]];
}

/** Port of `Color.operate` (color ⊕ dimension | color ⊕ color). */
function colorOperate(a: Color, b: ValueObj, op: string, modes: EvalModes): Color {
  const aRGB = rgbUnclamped(a);
  let newAlpha = a.alpha;
  let out: [number, number, number];
  if (b.kind === 'dimension') {
    const isStrictLike = modes.unitMode === 'strict' || modes.unitMode === 'preserve';
    if (b.unit && isStrictLike) throw new TypeError(`Cannot convert "${b.bytes}" to a color`);
    out = [calculate(aRGB[0], op, b.number), calculate(aRGB[1], op, b.number), calculate(aRGB[2], op, b.number)];
  } else if (b.kind === 'color') {
    const bRGB = rgbUnclamped(b);
    out = [calculate(aRGB[0], op, bRGB[0]), calculate(aRGB[1], op, bRGB[1]), calculate(aRGB[2], op, bRGB[2])];
    newAlpha = a.alpha * (1 - b.alpha) + b.alpha;
  } else {
    throw new TypeError(`Cannot operate on ${b.kind}`);
  }
  return makeColorRgb(out, newAlpha, a.format, a.modernSyntax ? { modernSyntax: true } : undefined);
}

/** Port of `Dimension.operate` (dimension ⊕ dimension), unit-aware. */
function dimensionOperate(a: Dimension, b: Dimension, op: string, modes: EvalModes): Dimension {
  const aVal = a.number;
  let bVal = b.number;
  const aUnit = a.unit;
  const bUnit = b.unit;
  const isStrict = modes.unitMode === 'strict';
  const isPreserve = modes.unitMode === 'preserve';

  if (bVal === 0 && op === '/') throw new TypeError('Cannot divide by zero');

  if (!aUnit || !bUnit) {
    const outUnit = aUnit || bUnit;
    if ((isStrict || isPreserve) && bUnit && op === '/') {
      throw new TypeError('Cannot divide a number by a unit');
    }
    return makeDimension(calculate(aVal, op, bVal), outUnit);
  }

  if (aUnit === bUnit) {
    if (op === '+' || op === '-') return makeDimension(calculate(aVal, op, bVal), aUnit);
    if (isStrict || isPreserve) {
      if (op === '*') throw new TypeError('Cannot multiply two units together');
      return makeDimension(calculate(aVal, op, bVal), ''); // division cancels units
    }
    return makeDimension(calculate(aVal, op, bVal), aUnit);
  }

  const aGroup = UNIT_TO_GROUP.get(aUnit);
  const bGroup = UNIT_TO_GROUP.get(bUnit);
  if (aGroup === undefined || bGroup === undefined || aGroup !== bGroup) {
    if (isStrict || isPreserve) throw new TypeError('Incompatible units. Change the units or use the unit function');
    return makeDimension(calculate(aVal, op, bVal), aUnit);
  }
  const group = CONVERSIONS[bGroup];
  const atomicUnit = group[aUnit];
  const targetUnit = group[bUnit];
  if (atomicUnit === undefined || targetUnit === undefined) {
    throw new TypeError('Incompatible units. Change the units or use the unit function');
  }
  if ((isPreserve || isStrict) && (op === '*' || op === '/')) {
    throw new TypeError('Cannot multiply or divide two units together');
  }
  bVal = bVal / (atomicUnit / targetUnit);
  return makeDimension(calculate(aVal, op, bVal), aUnit);
}

/** Dimension ⊕ Color: coerce the dimension to a color, then color-operate. */
function dimensionAsColor(a: Dimension, b: Color, op: string, modes: EvalModes): Color {
  const isStrictLike = modes.unitMode === 'strict' || modes.unitMode === 'preserve';
  if (a.unit && isStrictLike) throw new TypeError(`Cannot convert "${a.bytes}" to a color`);
  const thisColor = makeColorRgb([a.number, a.number, a.number], 1, b.format ?? 1 /* RGB */);
  return colorOperate(thisColor, b, op, modes);
}

/* -------------------------------------------------------- calc guards */

const CALC_WRAP_RE = /^calc\(([\s\S]*)\)$/;
const calcInner = (bytes: string): string | null => {
  const m = CALC_WRAP_RE.exec(bytes.trim());
  return m ? m[1]! : null;
};

/**
 * Native binary operation. Reproduces the adapter's guard order byte-for-byte:
 *   1. a `calc(...)` keyword operand → splice its inner expression (flat calc),
 *   2. an un-operable keyword operand → preserve source `l op r`,
 *   3. else native arithmetic; a unit-clash `TypeError` in `preserve` mode →
 *      `calc(l op r)` fallback.
 */
export function nativeOperate(op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj {
  // Guard 1: calc-wrapper keyword operand → flat calc splice.
  const leftInner = left.kind === 'keyword' ? calcInner(left.bytes) : null;
  const rightInner = right.kind === 'keyword' ? calcInner(right.bytes) : null;
  if (leftInner !== null || rightInner !== null) {
    return makeKeyword(`calc(${leftInner ?? left.bytes} ${op} ${rightInner ?? right.bytes})`);
  }
  // Guard 2: an un-operable keyword operand → preserve source.
  if (left.kind === 'keyword' || right.kind === 'keyword') {
    return makeKeyword(`${left.bytes} ${op} ${right.bytes}`);
  }
  try {
    if (left.kind === 'dimension' && right.kind === 'dimension') {
      return dimensionOperate(left, right, op, modes);
    }
    if (left.kind === 'dimension' && right.kind === 'color') {
      return dimensionAsColor(left, right, op, modes);
    }
    if (left.kind === 'color') {
      return colorOperate(left, right, op, modes);
    }
    throw new TypeError(`Cannot operate on ${left.kind}`);
  } catch (err) {
    if (err instanceof TypeError && modes.unitMode === 'preserve') {
      return makeKeyword(`calc(${left.bytes} ${op} ${right.bytes})`);
    }
    throw err;
  }
}

/* -------------------------------------------------------------- guards */

/** Guard comparison (`@a > 0`) on typed operands. Port of the adapter's guardCmp. */
export function nativeGuardCmp(op: string, left: ValueObj, right: ValueObj): boolean {
  if (left.kind === 'dimension' && right.kind === 'dimension') {
    const a = left.number, b = right.number;
    switch (op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '=': return a === b;
    }
  }
  const a = left.bytes, b = right.bytes;
  switch (op) {
    case '=': return a === b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
  }
  return false;
}

/**
 * Guard type-predicate (`iscolor(@a)` / `isnumber(@a)` / …) evaluated natively by
 * kind. Covers the foundation's predicate set; predicates that key off legacy
 * machinery are out of foundation scope (return `false`).
 */
export function nativeGuardCall(name: string, args: readonly ValueObj[]): boolean {
  const a = args[0];
  if (a === undefined) return false;
  switch (name.toLowerCase()) {
    case 'iscolor': return a.kind === 'color';
    case 'isnumber': return a.kind === 'dimension';
    case 'isstring': return a.kind === 'quoted';
    case 'iskeyword': return a.kind === 'keyword';
    case 'ispixel': return a.kind === 'dimension' && a.unit === 'px';
    case 'ispercentage': return a.kind === 'dimension' && a.unit === '%';
    case 'isem': return a.kind === 'dimension' && a.unit === 'em';
    case 'isunit': {
      const u = args[1];
      const want = u === undefined ? '' : u.kind === 'quoted' ? u.value : u.bytes;
      return a.kind === 'dimension' && a.unit === want;
    }
    default: return false;
  }
}
