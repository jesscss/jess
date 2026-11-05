/**
 * The CSS math functions a built-in's form writes (css-values-4 §10.3, §10.6),
 * computed when every input is known (docs/design/CSS-NATIVE-BUILTINS.md §3.4).
 * `null` from {@link cssMath} leaves the call written out.
 *
 * A form's `round()` steps are ones it chose: `1` in the input's unit, or a power
 * of ten for Less's decimal places, which rounds in base 10 as {@link round} does
 * (V8, whose decimal ties differ from a browser's floats; §2).
 *
 * HARD MODULE BOUNDARY: the value domain.
 */
import { DimensionValueNode } from './node-ctors.js';
import { round } from './round.js';
import { isValueGroupArray, type Dimension, type ValueGroup } from './value-eval.js';

/** A number a form reads, spelled only if something prints it. */
export const formNumber = (number: number, unit = ''): Dimension => new DimensionValueNode(number, unit, '');

export const isDimension = (value: ValueGroup | undefined): value is Dimension =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'Dimension';

const keyword = (value: ValueGroup | undefined): string | undefined =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'Keyword' ? value.text : undefined;

export function cssMath(name: string, args: readonly ValueGroup[]): Dimension | null {
  const [first, second, third] = args;
  if (name === 'round' && isDimension(second) && isDimension(third)) {
    const strategy = keyword(first);
    return strategy === 'up'
      ? formNumber(Math.ceil(second.number / third.number) * third.number, second.unit)
      : strategy === 'down' ? formNumber(Math.floor(second.number / third.number) * third.number, second.unit) : null;
  }
  if (!isDimension(first)) {
    return null;
  }
  switch (name) {
    case 'abs': return formNumber(Math.abs(first.number), first.unit);
    case 'sign': return formNumber(Math.sign(first.number));
    case 'round': return isDimension(second) ? formNumber(round(first.number, -Math.round(Math.log10(second.number))), first.unit) : null;
    case 'rem': return isDimension(second) ? formNumber(first.number % second.number, first.unit) : null;
    default: return null;
  }
}
