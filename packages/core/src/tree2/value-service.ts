/**
 * Shared VALUE-EVAL SERVICE interface (the boundary-safe seam for value math).
 *
 * Owner decision governing this rung: value computation (arithmetic + function
 * calls) is NOT reimplemented inside tree2, nor does tree2 reach into the legacy
 * tree's value methods. Instead tree2 owns the value STRUCTURE (its own `Operation` /
 * `FunctionCall` / `Paren` nodes) and the byte EMISSION of operands, and
 * delegates the MATH to a service it receives as an INJECTED INTERFACE — the
 * only allowed boundary crossing ("context objects cross the boundary").
 *
 * tree2 depends ONLY on this interface. The real implementation lives OUTSIDE
 * `tree2/` (see `tree2-frontend/value-service.ts`) and MAY use the existing fns
 * registry + the legacy tree's operation logic — fine outside the boundary.
 *
 * Contract: operands and results are already-serialized value BYTES. tree2
 * resolves variable references through its own lexical scope and folds nested
 * operations/calls bottom-up (each sub-expression is computed to bytes before
 * the enclosing one), then hands the service the operator/name plus the resolved
 * operand bytes and emits whatever bytes come back.
 */
export interface ValueService {
  /**
   * Compute a binary operation on two already-resolved operand byte strings,
   * e.g. `evaluateOperation('*', '#aaa', '3')` -> `'#ffffff'`.
   */
  evaluateOperation(operator: string, left: string, right: string): string;

  /**
   * Call a function with its already-resolved argument source, e.g.
   * `callFunction('lighten', 'blue, 10%')` -> `'#3333ff'`. `argsSource` is the
   * inner argument text exactly as it should be parsed (separators preserved).
   */
  callFunction(name: string, argsSource: string): string;
}
