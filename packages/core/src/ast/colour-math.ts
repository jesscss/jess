/**
 * Colour maths with one side only the browser knows (ledger V39, owner
 * 2026-11-16: *"Write relative colour (Recommended)"*): the known rule
 * ({@link colorOperate} in `value-operate.ts`), per channel on 0–255 rgb, as a
 * relative colour over an unknown colour (`@c + #111` is
 * `rgb(from var(--c, #c00) clamp(0, r + 17, 255) … / 1)`) or an `rgb()` over
 * an unknown number (`#111 * var(--k)` is `rgb(clamp(0, 17 * var(--k), 255) …)`).
 * The known rule clamps once, at output, so a result carries each channel's
 * maths before its clamp, and maths on it extends that maths:
 * `((@c * 2) - #111)` is `clamp(0, (r * 2) - 17, 255)`.
 *
 * HARD MODULE BOUNDARY: the value domain.
 */
import { formatNumber } from '@jesscss/patch-css';
import { compressDimensionBytes } from './compress.js';
import { knownUnit } from './css-math.js';
import { coerceNamedColorKeyword } from './literal-tag.js';
import { emitValue, isValueGroupArray, type Value } from './value-eval.js';
import { colorRawRgb, makeComputedColor, makeKeyword, makeList } from './value-factory.js';
import { isColourOnDeferred, writtenCalcInner } from './value-operate.js';

/**
 * One side of colour maths: the origin only the browser knows it reads (`''` for
 * none), each channel's maths before its clamp, whether that maths is more than
 * one term, its alpha (`undefined` for a number, which is no colour), and the
 * alpha's value when known.
 */
interface Side {
  readonly origin: string;
  readonly channels: readonly string[];
  readonly compound: boolean;
  readonly alpha: string | undefined;
  readonly knownAlpha: number | undefined;
}

/** The items of a result's arguments: origin, three channels, alpha, and whether the channels are compound. */
const CARRIED = 6;

/** The sides a result of {@link colourOnDeferred} carries in its arguments, read back. */
function carried(v: Value): Side | undefined {
  if (v.type !== 'FunctionCall' || !v.computed || v.name !== 'rgb' || isValueGroupArray(v.args) || v.args.type !== 'List' || v.args.value.length !== CARRIED) {
    return undefined;
  }
  const items = v.args.value.map(item => (!isValueGroupArray(item) && item.type === 'Keyword' ? item.bytes : undefined));
  const [origin, r, g, b, alpha, compound] = items;
  return origin === undefined || r === undefined || g === undefined || b === undefined || alpha === undefined || compound === undefined
    ? undefined
    : { origin, channels: [r, g, b], compound: compound === '1', alpha, knownAlpha: undefined };
}

/** A number only the browser knows, its known unit divided out, as the known rule reads a number's magnitude with its unit unread. */
function unknownNumber(v: Value): Side {
  const inner = writtenCalcInner(v);
  const unit = knownUnit(v);
  const spelled = inner ?? emitValue(v);
  const channel = unit === undefined || unit === '' ? spelled : `${inner === null ? spelled : `(${spelled})`} / 1${unit}`;
  return { origin: '', channels: [channel, channel, channel], compound: inner !== null || channel !== spelled, alpha: undefined, knownAlpha: undefined };
}

function sideOf(v: Value, num: (n: number) => string): Side {
  const result = carried(v);
  if (result !== undefined) {
    return result;
  }
  if (v.type === 'FunctionCall' && v.result === 'color') {
    return { origin: emitValue(v), channels: ['r', 'g', 'b'], compound: false, alpha: 'alpha', knownAlpha: undefined };
  }
  const known = coerceNamedColorKeyword(v);
  if (known.type === 'Color') {
    return { origin: '', channels: colorRawRgb(known).map(num), compound: false, alpha: num(known.alpha), knownAlpha: known.alpha };
  }
  if (known.type === 'Dimension') {
    const n = num(known.number);
    return { origin: '', channels: [n, n, n], compound: false, alpha: undefined, knownAlpha: undefined };
  }
  return unknownNumber(v);
}

/** The alpha of colour maths: a number keeps the colour's, and one on the left reads as an opaque colour; a second colour gives `a·(1 − bα) + bα`, `bα` the known one. */
function alphaOf(left: Side, right: Side, num: (n: number) => string): string {
  if (left.alpha === undefined) {
    return '1';
  }
  if (right.alpha === undefined) {
    return left.alpha;
  }
  const [known, other] = left.knownAlpha !== undefined ? [left.knownAlpha, right.alpha] : [right.knownAlpha ?? 1, left.alpha];
  return known === 1 ? '1' : known === 0 ? other : `${other.includes(' ') ? `(${other})` : other} * ${num(1 - known)} + ${num(known)}`;
}

const term = (channel: string, compound: boolean): string => (compound ? `(${channel})` : channel);
const alphaSlot = (alpha: string): string => ` / ${alpha.includes(' ') ? `calc(${alpha})` : alpha}`;

/**
 * Colour maths with one side only the browser knows ({@link isColourOnDeferred}),
 * written as the known rule computes it; `undefined` otherwise. Compressed, its
 * numbers and commas are as a built-in's CSS form's (§3.5).
 */
export function colourOnDeferred(op: string, left: Value, right: Value, compress: boolean): Value | undefined {
  if (!isColourOnDeferred(left, right)) {
    return undefined;
  }
  const sep = compress ? ',' : ', ';
  const num = (n: number): string => (compress ? compressDimensionBytes(formatNumber(n)) : formatNumber(n));
  const l = sideOf(left, num);
  const r = sideOf(right, num);
  const channels = l.channels.map((a, i) => {
    const b = r.channels[i]!;
    return op === '%' ? `rem(${a}${sep}${b})` : `${term(a, l.compound)} ${op} ${term(b, r.compound)}`;
  });
  const origin = l.origin || r.origin;
  const alpha = alphaOf(l, r, num);
  const slot = (origin !== '' && alpha === 'alpha') || (origin === '' && alpha === '1') ? '' : alphaSlot(alpha);
  const bytes = `rgb(${origin === '' ? '' : `from ${origin} `}${channels.map(c => `clamp(0${sep}${c}${sep}255)`).join(' ')}${slot})`;
  const terms = [origin, ...channels, alpha, op === '%' ? '0' : '1'].map(makeKeyword);
  return makeComputedColor(bytes, makeList(terms, ';'));
}
