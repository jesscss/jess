import type { MathMode } from '../../types/modes.js';
import type { Operator } from './calculate.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import type { Node } from '../node.js';

export type MathFrameState = {
  mathMode: MathMode;
  /**
   * Boolean stack. The current frame is the top-most value.
   * - `true` enables Less/Sass "math in parens" semantics
   * - `false` explicitly disables it (e.g. for call args)
   */
  parenFrames: ReadonlyArray<boolean>;
  /** Number stack, modeled as a depth counter */
  calcFrames: number;
};

export function isInParens(parenFrames: ReadonlyArray<boolean>): boolean {
  return parenFrames.at(-1) ?? false;
}

/**
 * Shared calculation decision logic for both eval-time (`Context.shouldOperate`)
 * and parse-time decisions (Less→Jess conversion).
 *
 * This must remain behaviorally equivalent to `Context.shouldOperate`.
 */
export function shouldOperateWithMathFrames(
  state: MathFrameState,
  op: Operator,
  left: Node,
  right: Node
): boolean {
  const { mathMode, calcFrames } = state;
  const inParens = isInParens(state.parenFrames);
  const inCalc = calcFrames !== 0;

  if (inCalc) {
    /** Only collapse safe units */
    if (isNode(left, N.Dimension) && isNode(right, N.Dimension)) {
      const lUnit = left.value.unit;
      const rUnit = right.value.unit;
      if ((op === '+' || op === '-') && lUnit === rUnit) {
        return true;
      }
      /** Can't make square units */
      if (op === '*' && (!lUnit || !rUnit)) {
        return true;
      }
      /** Can't divide by a unit */
      if (op === '/' && !rUnit) {
        return true;
      }
    }

    return false;
  }

  /** Parens for Less/SCSS will set `canOperate` to true */
  if (mathMode === 'always' || inParens) {
    return true;
  }
  if (mathMode === 'parens-division') {
    return op !== '/';
  }
  if (mathMode === 'parens' || mathMode === 'strict') {
    return false;
  }
  return true;
}
