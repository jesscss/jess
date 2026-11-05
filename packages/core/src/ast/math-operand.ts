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
import { DivisionByZeroError, InvalidOperandError, UnitArithmeticError, emitValue, isValueGroupArray, type Dimension, type EvalModes, type EvalValue, type FunctionCall, type Value, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { arithmeticOperand } from './value-factory.js';
import { convertible } from './value-units.js';
import { operandRule } from './value-operate.js';

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

/** What a `calc()`'s math computes to, or `undefined` when a leaf of it is not a number. */
function calcValue(value: EvalValue, ev: Divider): Dimension | undefined {
  if (typeof value === 'string' || isValueGroupArray(value)) {
    return undefined;
  }
  switch (value.type) {
    case 'Dimension':
      return value;
    case 'FunctionCall':
      return value.name === 'calc' ? calcValue(value.args, ev) : undefined;
    case 'Arithmetic': {
      const left = calcValue(arithmeticOperand(value, 'left'), ev);
      if (value.op === '') {
        return left;
      }
      const right = left && calcValue(arithmeticOperand(value, 'right'), ev);
      if (left === undefined || right === undefined || ((value.op === '+' || value.op === '-') && !convertible(left.unit, right.unit))) {
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
export function calcOperand(call: FunctionCall, ev: Divider): ValueGroup {
  try {
    return calcValue(call, ev) ?? call;
  } catch (error) {
    if (error instanceof DivisionByZeroError || error instanceof UnitArithmeticError) {
      return call;
    }
    throw error;
  }
}
