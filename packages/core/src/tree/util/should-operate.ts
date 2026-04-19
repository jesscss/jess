import type { MathMode } from '../../types/modes.js';
import type { Operator } from './calculate.js';
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
  _left: Node,
  _right: Node
): boolean {
  const { mathMode, calcFrames } = state;
  const inParens = isInParens(state.parenFrames);
  const inCalc = calcFrames !== 0;

  if (inCalc) {
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
