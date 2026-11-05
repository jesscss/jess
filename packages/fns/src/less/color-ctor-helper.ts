/**
 * Shared kernels for the COLOR-CONSTRUCTOR fns (`rgb`/`hsl`/`hsv`/… + their
 * `*a` aliases). Boundary-clean re-implementations of the legacy `@jesscss/core`
 * conversion plugins (`percentOf` / `normalizeHue`) over the
 * value-domain `Dimension`.
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import type { Color, Dimension, ValueGroup } from '@jesscss/core/value';
import { groupSeparator, isValueGroupArray } from '@jesscss/core/value';

export { clamp01, percentOf } from '../shared/color/kernels.js';

/**
 * `normalizeHue()`: any angle unit → degrees wrapped to 0-360. `turn`/`rad`/`grad`/
 * `%` convert; `deg`/unitless pass through; an unrecognized unit stays raw (legacy
 * parity: it returns the value unconverted, so we keep the number).
 */
export function normalizeHue(d: Dimension): number {
  const { number, unit } = d;
  let deg: number;
  switch (unit.toLowerCase()) {
    case 'turn':
      deg = number * 360;
      break;
    case 'rad':
      deg = (number * 180) / Math.PI;
      break;
    case 'grad':
      deg = number * 0.9;
      break;
    case '%':
      deg = (number * 360) / 100;
      break;
    case '':
    case 'deg':
      deg = number;
      break;
    default: return number;
  }
  return ((deg % 360) + 360) % 360;
}

/** Whether an arg-list item is a materialized color operand. */
export const isColor = (v: ValueGroup | undefined): v is Color =>
  v !== undefined && !isValueGroupArray(v) && v.type === 'Color';

/** Modern color syntax is signalled by a space / slash separated call. */
export const isModern = (value: ValueGroup): boolean => {
  const separator = groupSeparator(value);
  return separator === ' ' || separator === '/';
};
