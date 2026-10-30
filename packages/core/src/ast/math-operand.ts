/**
 * A slash list (`10px / 2`, a slash the math mode did not divide where it was
 * written) is a list wherever it is written or output, and its quotient
 * wherever math or a number is expected — ledger P35, owner 2026-10-30: *"if
 * it's a math calculation or expects a number, then the slash list should
 * have an auto-converting method"*. {@link slashQuotient} is that one
 * conversion: the slash list divides there, left to right, and the division
 * proceeds under the active `unitMode` exactly as the same division written
 * in a group does. `@d: 10px/2; r: @d * 2` is `10px`; `percentage(@d)` is
 * `500%`; `@d > 4px` is true; `font: @f` with `@f: 12px/1.5` stays
 * `12px / 1.5`. A slash written in place as a function argument converts the
 * same way where its parameter takes a number (`percentage(16/17)` is
 * `94.11764706%`; owner 2026-10-30: *"since obviously percentage() does not
 * accept a slash list"*). A slash written in place in a comparison is not
 * divided there (`when (10px/2 = 5px)`): the math mode decides it (P34, V35;
 * owner 2026-10-30: *"we wouldn't compare"*). Math written inside a math
 * function never computes, so it never reaches here.
 *
 * HARD MODULE BOUNDARY: the value domain and the operand rule only.
 */
import { DivisionByZeroError, InvalidOperandError, emitValue, isValueGroupArray, type EvalModes, type Value, type ValueEvaluator, type ValueGroup } from './value-eval.js';
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
 * A value where a number is expected — a parameter typed as a number, a
 * comparison operand: a slash list of numbers is its {@link slashQuotient}.
 * Any other slash list (`12px / normal`), and one with no quotient (`1 / 0`),
 * stays the list, and the site answers it as it answers any other value that
 * is not a number: a guard does not match, a call falls to `functionMode`.
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

/**
 * Whether `node`, a value as written, is a slash list: a slash written in
 * place in a comparison, which the math mode decides (P34, V35), never
 * converted there.
 */
export function isWrittenSlash(node: object): boolean {
  return 'type' in node && node.type === 'List' && 'sep' in node && node.sep === '/';
}
