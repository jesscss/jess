import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Color, Dimension, FnCtx, FunctionCall, ValueGroup, Fn } from '@jesscss/core/value';
import { colorRawRgb, defineFunction, FunctionDeclined, groupItems, isValueGroupArray, makeColorRgb, makeDimension, RGB } from '@jesscss/core/value';
import { clamp01, inUnits, isColor, isModern, percentOf } from './color-ctor-helper.js';
import { COLOR_ARG, fractionOf } from './color-form.js';
import { fade as form } from './css-forms.generated.js';
import { requireDimension } from '../shared/math/math-helper.js';

/**
 * `rgb` / `rgba` (alias) — CONSTRUCT an RGB-format color from numeric channels, or
 * REFORMAT an existing color to rgb. Byte-faithful to `less/rgb` for the value-
 * domain-representable cases: r/g/b via `percentOf(255)`, optional alpha via
 * `percentOf(1)`, modern-syntax picked from the call separator.
 *
 * SOURCE-FORMAT preservation (the verbatim rule for color literals): an un-operated
 * constructor keeps its authored spelling — a `%` channel (`rgb(50%, 0, 0)`) stays
 * `50%`, a `%` alpha stays `50%`. The authored percents ride on the `Color`
 * (`rgbPct`/`alphaPct`); an OPERATED result rebuilds without them → canonical
 * channels. Un-representable overloads (relative-color `from`) are out of Tier-B scope.
 */
/** A `%` dimension's authored number (for source-format preservation), else undefined. */
const pctOf = (d: Dimension | undefined): number | undefined =>
  d?.unit === '%' ? d.number : undefined;

/** A channel only the browser knows: a call of no known type, or of a number. */
const isDeferredChannel = (value: ValueGroup): boolean =>
  !isValueGroupArray(value) && value.type === 'FunctionCall' && value.result !== 'color';

/** What CSS takes as an `rgb()` channel or alpha (css-color-4 §5.1). */
const CHANNEL_UNITS: readonly string[] = ['', '%'];

export function makeRgb(value: ValueGroup): Color {
  const items = groupItems(value);
  const modernSyntax = isModern(value);
  const first = items[0];
  if (items.length >= 3 && !isColor(first)) {
    /* `rgb(var(--r), 0, 0)` is CSS as written. Every other channel still has to be a number. */
    if (items.some(isDeferredChannel)) {
      items.forEach((item) => {
        if (!isDeferredChannel(item) && !CHANNEL_UNITS.includes(requireDimension(item).unit)) {
          throw new TypeError('rgb: a channel is a number or a percentage');
        }
      });
      throw new FunctionDeclined();
    }
    const r = percentOf(requireDimension(items[0]), 255);
    const g = percentOf(requireDimension(items[1]), 255);
    const b = percentOf(requireDimension(items[2]), 255);
    const a = items[3] !== undefined ? percentOf(requireDimension(items[3]), 1) : 1;
    const p0 = pctOf(requireDimension(items[0])), p1 = pctOf(requireDimension(items[1])), p2 = pctOf(requireDimension(items[2]));
    const rgbPct = p0 !== undefined || p1 !== undefined || p2 !== undefined ? [p0, p1, p2] : undefined;
    const alphaPct = items[3] !== undefined ? pctOf(requireDimension(items[3])) : undefined;
    return makeColorRgb([r, g, b], a, RGB, { modernSyntax, ...(rgbPct ? { rgbPct } : {}), ...(alphaPct !== undefined ? { alphaPct } : {}) });
  }
  if (items.length < 3 && isColor(first)) {
    return makeColorRgb(colorRawRgb(first), first.alpha, RGB, { modernSyntax });
  }
  throw new Error('Invalid arguments for rgb function');
}

/**
 * The two-slot `rgba(color, alpha)`: `rgb(from color r g b / alpha)`. A
 * substitution or an unknown function may expand to the channels, so that call is
 * CSS as written (docs/design/CSS-NATIVE-BUILTINS.md §3.8).
 */
const colorWithAlpha = /* @__PURE__ */ defineForm('rgba', {
  params: [COLOR_ARG, { type: ['Dimension', 'FunctionCall'] }],
  format: RGB,
  form: (color: ValueGroup | FunctionCall, alpha: Dimension | FunctionCall): FormCall => {
    if ((!isValueGroupArray(color) && color.type === 'FunctionCall' && color.result !== 'color') || (alpha.type === 'FunctionCall' && alpha.result !== 'numeric')) {
      throw new TypeError('rgba: a substitution may hold the channels, so the call is CSS as written');
    }
    return [form, color, alpha.type === 'Dimension' ? makeDimension(clamp01(fractionOf(alpha))) : alpha];
  }
});

/** `rgb()`/`rgba()`: the two-slot overload's form, else the channels or one colour. */
export const rgbBody = (list: ValueGroup, ctx: FnCtx): ReturnType<Fn> => {
  const items = groupItems(list);
  const first = items[0];

  /* An exposed colour is already that colour; a `var()` written here may hold channels (§3.8). */
  return items.length === 2 && !isModern(list)
    ? colorWithAlpha(list, ctx)
    : items.length === 1 && first !== undefined && !isValueGroupArray(first) && first.type === 'FunctionCall' && first.name === 'var' && first.result === 'color' ? first : makeRgb(list);
};

/** What a slot of `rgb()` takes: a list stays a list, and a call is what only the browser knows. */
const SLOT_TYPES = ['List', 'Color', 'Dimension', 'FunctionCall'] as const;

/* No spread: a bundler keeps a pure call whose argument spreads, and this one reaches the evaluator. */
const fitsChannel = (value: ValueGroup): boolean => inUnits(value, CHANNEL_UNITS);
const RGB_SLOT = { type: SLOT_TYPES, fits: fitsChannel } as const;
const RGB_OPTIONAL_SLOT = { type: SLOT_TYPES, fits: fitsChannel, optional: true } as const;

/** The slots of `rgb()` and `rgba()`. */
export const RGB_PARAMS = [RGB_SLOT, RGB_OPTIONAL_SLOT, RGB_OPTIONAL_SLOT, RGB_OPTIONAL_SLOT] as const;

export const rgb: Fn = /* @__PURE__ */ defineFunction('rgb', {
  params: RGB_PARAMS,
  variadic: true,
  body: rgbBody
});
