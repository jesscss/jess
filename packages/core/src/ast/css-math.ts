/**
 * The CSS math functions a built-in's form writes (css-values-4 §10.3, §10.6),
 * computed when every input is known (docs/design/CSS-NATIVE-BUILTINS.md §3.4).
 * `null` from {@link cssMath} leaves the call written out.
 *
 * A `round()` step of `1` or a power of ten below it (Less's decimal places) rounds
 * in base 10 as {@link round} does (V8, whose decimal ties differ from a browser's
 * floats; §2). Any other is Sass's step, a float multiple without its float dust.
 *
 * HARD MODULE BOUNDARY: the value domain.
 */
import { negated } from './math-operand.js';
import { DimensionValueNode } from './node-ctors.js';
import { round } from './round.js';
import { emitValue, isValueGroupArray, type Arithmetic, type Dimension, type EvalValue, type ValueGroup } from './value-eval.js';
import { makeDimension, makeFunctionCall, makeList } from './value-factory.js';
import { groupItems } from './value-list.js';
import { mathOnDeferred, writtenCalcInner } from './value-operate.js';
import { foldUnit, groupOf } from './value-units.js';

/** A number a form reads, spelled only if something prints it. */
export const formNumber = (number: number, unit = ''): Dimension => new DimensionValueNode(number, unit, '');

export const isDimension = (value: ValueGroup | undefined): value is Dimension =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'Dimension';

/** CSS math functions whose result has the type of their arguments (css-values-4 §10.9). */
const TYPE_OF_ARGUMENTS: ReadonlySet<string> = new Set(['calc', 'abs', 'round', 'rem', 'mod', 'min', 'max', 'clamp']);

/** One side's unit: a number written in a math function has it on the parse node, with no value built to read it. */
function sideUnit(math: Arithmetic, side: 'left' | 'right', inForm: boolean): string | undefined {
  const node = math.written?.[side];
  return node?.type === 'Dimension' ? node.unit : knownUnit(math[side], inForm);
}

function arithmeticUnit(math: Arithmetic, inForm: boolean): string | undefined {
  const left = sideUnit(math, 'left', inForm);
  if (math.op === '') {
    return left;
  }
  const right = sideUnit(math, 'right', inForm);
  switch (math.op) {
    case '+':
    case '-':
      return left === undefined || right === undefined || foldUnit(left) === foldUnit(right) || (groupOf(left) !== undefined && groupOf(left) === groupOf(right)) ? left ?? right : undefined;
    case '*':
      return left && right ? undefined : left || right || (left === '' && right === '' ? '' : undefined);
    case '/':
      return right === undefined || right === '' ? left : left !== undefined && foldUnit(left) === foldUnit(right) ? '' : undefined;
    default:
      return undefined;
  }
}

/**
 * The unit an expression proves a value is in, `''` for a number, whatever only
 * the browser knows of it: a sum whose known operands agree (`var(--x) + 1px`),
 * or one dimension times or divided by plain numbers (`var(--x) * 100%`, a factor
 * beside a unit being a number, Q3). `undefined` when nothing proves one:
 * `var(--x)`, `var(--x) * 2`, `1px * var(--x) * 1px`, and any call the compile did
 * not write itself, so `asin()`, `hypot()` and `attr()` take the number form. An
 * exposed variable's `var()` is of its value's type, so it is in that value's unit.
 * `inForm`: inside a built-in's form, whose calls are its own.
 */
export function knownUnit(value: EvalValue, inForm = false): string | undefined {
  if (typeof value === 'string' || isValueGroupArray(value)) {
    return undefined;
  }
  switch (value.type) {
    case 'Dimension':
      return value.numerator !== undefined && (value.numerator.length > 1 || (value.denominator?.length ?? 0) > 0) ? undefined : value.unit;
    case 'Arithmetic':
      return arithmeticUnit(value, inForm);
    case 'FunctionCall':
      if (value.name === 'calc') {
        return knownUnit(value.args, inForm || value.computed);
      }
      if (value.name === 'var') {
        return value.result === 'numeric' ? knownUnit(groupItems(value.args)[1] ?? value.args) : undefined;
      }
      if (!inForm && !value.computed) {
        return undefined;
      }
      if (value.name === 'sign') {
        return '';
      }
      if (TYPE_OF_ARGUMENTS.has(value.name)) {
        for (const argument of groupItems(value.args)) {
          const unit = knownUnit(argument, true);
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
  unit === undefined || unit === '' || isValueGroupArray(value) ? value : mathOnDeferred('/', negated(value), makeDimension(1, unit));

/** Math on what only the browser knows, as a form's slot holds it. */
export const formMath = (op: '*' | '/' | '-', left: ValueGroup, right: ValueGroup): ValueGroup =>
  isValueGroupArray(left) || isValueGroupArray(right) ? left : mathOnDeferred(op, negated(left), negated(right));

/**
 * A CSS math function that reads numbers, of `args` with their unit dropped, in the `unit` its known result keeps: `calc(sqrt(var(--a) / 1px) * 1px)`.
 *
 * TODO(compress-form-math): the call's bytes, and the spelling {@link mathOnDeferred} gives the math around it, are written
 * here with no modes, so under `compress` a form's math is not compressed (`pow(var(--a,4px) / 1px, 0.5)` beside
 * `pow(var(--x),.5)`). Spelling them from structure at output fixes both; tracker issue to be filed.
 */
export function aroundUnit(name: string, args: readonly ValueGroup[], unit: string): ValueGroup {
  const bytes = args.map(arg => (isValueGroupArray(arg) ? null : writtenCalcInner(arg)) ?? emitValue(arg)).join(', ');
  return mathOnDeferred('*', makeFunctionCall(name, makeList(args, ','), `${name}(${bytes})`), makeDimension(1, unit));
}

const keyword = (value: ValueGroup | undefined): string | undefined =>
  value !== undefined && !isValueGroupArray(value) && value.type === 'Keyword' ? value.text : undefined;

function toStep(value: number, step: number): number {
  const places = -Math.round(Math.log10(Math.abs(step)));
  return step > 0 && step <= 1 && 10 ** -places === step ? round(value, places) : Number((round(value / step) * step).toPrecision(15));
}

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
    case 'round': return isDimension(second) ? formNumber(toStep(first.number, second.number), first.unit) : null;
    case 'rem': return isDimension(second) ? formNumber(first.number % second.number, first.unit) : null;
    default: return null;
  }
}
