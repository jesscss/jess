/**
 * A slash list (`10px / 2`, a slash the math mode did not divide where it was
 * written) is a list wherever it is written or output, and its quotient only
 * where its use is unambiguous — ledger P35, owner 2026-10-30: *"the only time
 * we can do division is when the use is unambiguous"*. {@link slashQuotient}
 * is that one conversion: the slash list divides there, left to right, and the
 * division proceeds under the active `unitMode` exactly as the same division
 * written in a group does. It is unambiguous in two places: as one operand of
 * math, which a reference always is (`@d: 1/2; percentage(@d + 1)` is `150%`,
 * {@link mathOperand}), and as the whole argument of a parameter typed as a
 * number (`percentage(16/17)` is `94.11764706%`, {@link numberOperand}).
 * Nowhere else: `font: @f` with `@f: 12px/1.5` stays `12px / 1.5`, and a
 * comparison never converts (`when (@d = 0.5)` does not match `@d: 1/2`). A
 * slash written in place beside other math is kept as written by the parser
 * (`12px / 1 + 1`), so it never reaches here as a number. Math written inside
 * a math function never computes, so it never reaches here either.
 *
 * HARD MODULE BOUNDARY: the value domain and the operand rule only.
 */
import { isMathFunctionName } from './math-functions.js';
import { DivisionByZeroError, InvalidOperandError, emitValue, isValueGroupArray, joinGroup, type Dimension, type EvalModes, type EvalValue, type FunctionCall, type Value, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { arithmeticOperand, makeDimension, withFields } from './value-factory.js';
import { convertible } from './value-units.js';
import { isMathOnDeferred, keptMathOf, mathOnDeferred, operandRule, operate, remOn, spelledCompressed, validateFinalUnits, writtenCalcInner } from './value-operate.js';

type Divider = Pick<ValueEvaluator, 'operate' | 'sassOperands' | 'sassCalculations'>;

/**
 * The quotient of a slash list, or `value` itself when it is not one. With
 * `checked`, each division first answers the operand rule as any division
 * that computes does (V36, {@link operandRule}): a keyword side is
 * `eval/invalid-operand`.
 */
export function slashQuotient(value: Value, ev: Divider, modes: EvalModes, checked: boolean): Value {
  if (value.type !== 'List' || value.sep !== '/') {
    return value;
  }
  let quotient = side(value.value[0]!, ev, modes, checked);
  for (let i = 1; i < value.value.length; i++) {
    const divisor = side(value.value[i]!, ev, modes, checked);
    if (checked && isMathOnDeferred(quotient, divisor)) {
      throw new InvalidOperandError(`\`${emitValue(quotient)} / ${emitValue(divisor)}\`: a slash list with a value only the browser knows has no quotient.`);
    }
    quotient = (checked ? operandRule('/', quotient, divisor, ev) : null) ?? ev.operate('/', quotient, divisor, modes);
  }
  return quotient;
}

function side(value: ValueGroup, ev: Divider, modes: EvalModes, checked: boolean): Value {
  if (isValueGroupArray(value)) {
    throw new InvalidOperandError(`\`/\` is not defined on a list (\`${emitValue(value)}\`).`);
  }
  return slashQuotient(value, ev, modes, checked);
}

/** What the operand reads from the evaluation lane. */
interface OperandLane {
  readonly modes: EvalModes;
  readonly keepsMath: boolean;
  readonly calcDepth: number;
}

/**
 * One operand of an operation that computes, as `operate` reads it: a slash
 * list is its {@link slashQuotient}, checked unless the operation keeps its
 * math (V36). A space sequence is not one value, so no operation is defined
 * on it (`eval/invalid-operand` at the operation). A comma list is one value
 * that `operate` has no arithmetic for, so it answers there.
 */
export function mathOperand(value: ValueGroup, op: string, ev: Divider, e: OperandLane): Value {
  if (isValueGroupArray(value)) {
    throw new InvalidOperandError(`\`${op}\` is not defined on a list (\`${emitValue(value)}\`).`);
  }
  return slashQuotient(value, ev, e.modes, !(e.keepsMath || e.calcDepth > 0));
}

/** Whether `value` is a number, or a slash list of numbers. */
const numeric = (value: ValueGroup): boolean =>
  !isValueGroupArray(value) && (value.type === 'Dimension' || (value.type === 'List' && value.sep === '/' && value.value.every(numeric)));

/**
 * The whole argument of a parameter typed as a number: a slash list of
 * numbers is its {@link slashQuotient}. Any other slash list (`12px / normal`,
 * `1 / 2 + 1` kept as written), and one with no quotient (`1 / 0`), stays the
 * list, and the call answers it as it answers any other value that is not a
 * number: it falls to `functionMode`.
 */
export function numberOperand(value: ValueGroup, ev: Divider, modes: EvalModes): ValueGroup {
  if (isValueGroupArray(value) || value.type !== 'List' || value.sep !== '/' || !numeric(value)) {
    return value;
  }
  try {
    return slashQuotient(value, ev, modes, false);
  } catch (error) {
    if (error instanceof DivisionByZeroError) {
      return value;
    }
    throw error;
  }
}

/** CSS's own rule for the units in a `calc()`: two that do not convert have no value the compile knows, and are no error to find out. */
const CSS_UNITS: EvalModes = { unitMode: 'strict' };

/** Whether CSS math types `left op right`: a sum over units that convert, a product with at most one unit, a quotient by a number. It has no `%` (css-values-4 §10.9). */
function cssTyped(op: string, left: Dimension, right: Dimension): boolean {
  switch (op) {
    case '+':
    case '-': return convertible(left.unit, right.unit);
    case '*': return left.unit === '' || right.unit === '';
    case '/': return right.unit === '' && right.number !== 0;
    default: return false;
  }
}

/**
 * What a `calc()`'s math computes to, or `undefined` when CSS math does not type
 * it or a leaf of it is not a number. Kept math never computes: every one holds
 * a value only the browser knows or units that do not convert.
 */
function calcValue(value: EvalValue, ev: Divider): Dimension | undefined {
  if (typeof value === 'string' || isValueGroupArray(value)) {
    return undefined;
  }
  switch (value.type) {
    case 'Dimension':
      return value.numerator !== undefined && (value.numerator.length > 1 || (value.denominator?.length ?? 0) > 0) ? undefined : value;
    case 'FunctionCall':
      return value.name === 'calc' ? calcValue(value.args, ev) : undefined;
    case 'Arithmetic': {
      if (value.kept) {
        return undefined;
      }
      if (value.op === '') {
        return calcValue(arithmeticOperand(value, 'left'), ev);
      }
      const right = calcValue(arithmeticOperand(value, 'right'), ev);
      const left = right && calcValue(arithmeticOperand(value, 'left'), ev);
      if (left === undefined || right === undefined || !cssTyped(value.op, left, right)) {
        return undefined;
      }
      const out = ev.operate(value.op, left, right, CSS_UNITS);
      return out.type === 'Dimension' ? out : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The whole argument of a parameter typed as a number: an authored `calc()` the
 * compile can compute is the number it computes to (`percentage(calc(0.5 + 0.5))`
 * is `100%`). One with a leaf only the browser knows, or units that do not
 * convert (`calc(1px + 1em)`, V18), stays the `calc()`.
 */
export const calcOperand = (call: FunctionCall, ev: Divider): ValueGroup => calcValue(call, ev) ?? call;

const MINUS_ONE = /* @__PURE__ */ makeDimension(-1, '');

/** What only the browser knows, written with a glued minus (`-var(--x)`, one function token to CSS), as the math it means: `calc(-1 * var(--x))`. */
function negated(v: Value): Value {
  if (v.type !== 'FunctionCall' || v.name.charCodeAt(0) !== 45) {
    return v;
  }
  const name = v.name.slice(1);
  return name === 'var' || isMathFunctionName(name) ? negatedMath(withFields(v, { name, bytes: v.bytes.slice(1) })) : v;
}

const negatedMath = (v: Value): Value => mathOnDeferred('*', MINUS_ONE, v);

/** The result of a built-in written with a glued minus (`-percentage(var(--x))`), negated when it is a form of a number only the browser knows; otherwise `undefined`, and the call is written out as before. */
export const negatedCall = (value: EvalValue): Value | undefined =>
  typeof value === 'object' && !isValueGroupArray(value) && value.type === 'FunctionCall' && value.computed && value.result === 'numeric' ? negatedMath(value) : undefined;

const isKnownOther = (v: Value): boolean =>
  v.type !== 'Dimension' && v.type !== 'FunctionCall' && v.type !== 'Arithmetic';

/** A `/` no group asked to divide (Less `math: always`) beside a known value that is no number is CSS's separator (`url(a.png) center / var(--s)`). */
export const slashSeparates = (left: Value, right: Value): boolean => isKnownOther(left) || isKnownOther(right);

/**
 * A value in a call written out: a group of math on what only the browser knows
 * is a `calc()` at any depth of a space or slash list, there being no `(...)` in
 * CSS (`translate((var(--a) * 2), 1px)`, `hsl((var(--h) + 1) 50% 50%)`).
 */
export function writtenCallValue(v: ValueGroup, emit: (v: ValueGroup) => string): string {
  if (isValueGroupArray(v)) {
    return joinGroup(v, ' ', item => writtenCallValue(item, emit));
  }
  if (v.type === 'List' && v.sep === '/') {
    return joinGroup(v.value, ' / ', item => writtenCallValue(item, emit));
  }
  return v.type === 'Arithmetic' && v.op === '' ? `calc${v.bytes}` : emit(v);
}

/**
 * An operation outside `.scss` over operands that are not two known numbers. Math
 * on what only the browser knows is a `calc()` wherever it is math (V38), under
 * the unit check known math answers; a `%` is `rem()`. Under `compress` kept math
 * writes its numbers compressed (§3.5). `keeps`: the math is CSS's or not reached
 * as math ({@link Lane.keepsMath}), so a written operation stays as written.
 */
export function operated(op: string, left: Value, right: Value, modes: EvalModes, keeps: boolean): Value {
  const deferred = isMathOnDeferred(left, right);
  if (!deferred && keptMathOf(left) === undefined && keptMathOf(right) === undefined && (op !== '%' || (writtenCalcInner(left) === null && writtenCalcInner(right) === null))) {
    return operate(op, left, right, modes);
  }
  validateFinalUnits(left, modes);
  validateFinalUnits(right, modes);
  const l = modes.compress === true ? spelledCompressed(negated(left)) : negated(left);
  const r = modes.compress === true ? spelledCompressed(negated(right)) : negated(right);
  if (op === '%') {
    return remOn(l, r, modes);
  }
  return !deferred || keeps ? operate(op, l, r, modes) : mathOnDeferred(op, l, r);
}

/** Arithmetic a math function holds as written, unless it is a `%` over what only the browser knows, which CSS math has no operator for ({@link remOn}). */
export const writtenPercent = (op: string, left: EvalValue, right: EvalValue, modes: EvalModes, ev: Pick<ValueEvaluator, 'sassCalculations'>): Value | undefined =>
  op === '%' && ev.sassCalculations !== true && typeof left === 'object' && typeof right === 'object' && !isValueGroupArray(left) && !isValueGroupArray(right) && isMathOnDeferred(left, right)
    ? remOn(left, right, modes)
    : undefined;
