/**
 * One operand of an operation that computes, as `operate` reads it.
 *
 * A slash list (`10px / 2`, a slash the math mode did not divide where it was
 * written) that becomes an operand of math that computes is a division, so it
 * divides there, left to right, and the operation proceeds on the quotient
 * under the active `unitMode`: `@d: 10px/2; r: @d * 2` is `10px` (ledger P35,
 * FIXTURES, owner 2026-10-29). Read anywhere else it stays the list it is
 * (`font: @f` with `@f: 12px/1.5`). Math written inside a math function never
 * computes, so it never reaches here. The division answers the operand rule
 * as any division that computes does (V36, {@link operandRule}): a keyword
 * side is `eval/invalid-operand` in every dialect.
 *
 * A space sequence is not one value, so no operation is defined on it
 * (`eval/invalid-operand` at the operation). A comma list is one value that
 * `operate` has no arithmetic for, so it answers there.
 *
 * HARD MODULE BOUNDARY: the value domain and the operand rule only.
 */
import { InvalidOperandError, emitValue, isValueGroupArray, type EvalModes, type Value, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { operandRule } from './value-operate.js';

/** What the operand reads from the evaluation lane. */
interface OperandLane {
  readonly modes: EvalModes;
  readonly keepsMath: boolean;
  readonly calcDepth: number;
}

export function mathOperand(value: ValueGroup, op: string, ev: ValueEvaluator, e: OperandLane): Value {
  if (isValueGroupArray(value)) {
    throw new InvalidOperandError(`\`${op}\` is not defined on a list (\`${emitValue(value)}\`).`);
  }
  if (value.type !== 'List' || value.sep !== '/') {
    return value;
  }
  let quotient = mathOperand(value.value[0]!, '/', ev, e);
  for (let i = 1; i < value.value.length; i++) {
    const divisor = mathOperand(value.value[i]!, '/', ev, e);
    quotient = (e.keepsMath || e.calcDepth > 0 ? null : operandRule('/', quotient, divisor, ev)) ?? ev.operate('/', quotient, divisor, e.modes);
  }
  return quotient;
}
