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
import { isValueGroupArray, type Dimension, type EvalValue, type ValueGroup } from './value-eval.js';
import { makeDimension } from './value-factory.js';
import { groupItems } from './value-list.js';
import { mathOnDeferred } from './value-operate.js';

/** A number a form reads, spelled only if something prints it. */
export const formNumber = (number: number, unit = ''): Dimension => new DimensionValueNode(number, unit, '');

export const isDimension = (value: ValueGroup | undefined): value is Dimension =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'Dimension';

/** CSS math functions whose result has the type of their arguments (css-values-4 §10.9). */
const TYPE_OF_ARGUMENTS: ReadonlySet<string> = new Set(['calc', 'abs', 'round', 'rem', 'mod', 'min', 'max', 'clamp']);

/**
 * The unit a value's structure says it is in, `''` for a number, whatever only
 * the browser knows of it: `var(--x) + 1px` is a length and `var(--x) * 100%` a
 * percentage, a factor beside a unit being a number (Q3). `undefined` when
 * structure does not say: `var(--x)`, `var(--x) * 2`.
 */
export function knownUnit(value: EvalValue): string | undefined {
  if (typeof value === 'string' || isValueGroupArray(value)) {
    return undefined;
  }
  switch (value.type) {
    case 'Dimension':
      return value.unit;
    case 'Arithmetic': {
      const left = knownUnit(value.left);
      if (value.op === '') {
        return left;
      }
      const right = knownUnit(value.right);
      if (value.op === '/') {
        return right === undefined || right === '' ? left : '';
      }
      if (value.op === '*' && (left === '' || right === '')) {
        return left === '' ? right : left;
      }
      return left ?? right;
    }
    case 'FunctionCall':
      if (value.name === 'sign') {
        return '';
      }
      if (TYPE_OF_ARGUMENTS.has(value.name)) {
        for (const argument of groupItems(value.args)) {
          const unit = knownUnit(argument);
          if (unit !== undefined) {
            return unit;
          }
        }
      }
      return undefined;
    default:
      return undefined;
  }
}

/** A value only the browser knows, its known unit divided out: the number a built-in that drops a unit reads (css-values-4 §10.2). */
export const asNumber = (value: ValueGroup, unit = knownUnit(value)): ValueGroup =>
  unit === undefined || unit === '' || isValueGroupArray(value) ? value : mathOnDeferred('/', value, makeDimension(1, unit));

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
