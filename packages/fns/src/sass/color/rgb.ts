import type { Fn, FnCtx, ValueGroup } from '@jesscss/core/value';
import { isValueGroupArray, define, checkAny, optional } from '@jesscss/core/value';
import { colorWithAlpha } from '../../less/rgb.js';
import { isColor, makeRgb } from './kernels.js';

const isCall = (value: ValueGroup | undefined): boolean =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'FunctionCall';

/** The channels or a colour with an alpha; a colour or an alpha not known takes the two-slot form (`rgba(currentcolor, .5)`, `rgba(#000, var(--a))`). */
export const rgbBody = (args: readonly ValueGroup[], ctx: FnCtx): ReturnType<Fn> =>
  args.length === 2 && ctx.modern !== true && (!isColor(args[0]) || isCall(args[1])) ? colorWithAlpha(args, ctx) : makeRgb(args, ctx.modern === true);

/**
 * Sass `rgb()` — construct an rgb colour, or re-alpha an existing one.
 *
 * A separate body from Less's, not a re-export: Less preserves the AUTHORED
 * percent spelling of a channel (`rgb(50%, 0, 0)` emits `50%`) while Sass scales
 * it (`rgb(50%,0%,0%)` → `rgb(127.5, 0, 0)`), and Sass clamps channels into
 * 0-255 (`rgb(300,0,0)` → `rgb(255, 0, 0)`, `rgb(-10,0,0)` → `rgb(0, 0, 0)`)
 * where Less does not. Fractions survive the clamp (`rgb(1.5,2.5,3.5)` →
 * `rgb(1.5, 2.5, 3.5)`) — quantization belongs to the output boundary.
 *
 * Overloads covered: three/four positional channels, the space/slash modern form
 * (`rgb(1 2 3 / 0.5)`), and the colour + alpha form (`rgb(#f00, 0.5)`).
 */
export const rgb: Fn = define('rgb', {
  params: [
    { name: 'red', type: 'any', check: checkAny },
    /* @__PURE__ */ optional({ name: 'green', type: 'any', check: checkAny }),
    /* @__PURE__ */ optional({ name: 'blue', type: 'any', check: checkAny }),
    /* @__PURE__ */ optional({ name: 'alpha', type: 'any', check: checkAny })
  ],
  variadic: true,
  body: rgbBody
});

export default rgb;
