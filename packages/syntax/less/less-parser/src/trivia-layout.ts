/*
 * Reading a node's trivia log: the layout text before a raw child, and the
 * separators a list captured. Every Less reducer that keeps authored padding
 * reads it through these.
 */
import { triviaTextAt } from '@jesscss/core/ast';

export function sourceFromState(state: unknown): string | undefined {
  return typeof state === 'object'
    && state !== null
    && 'source' in state
    && typeof state.source === 'string'
    ? state.source
    : undefined;
}

export const LESS_NODE_TRIVIA_STRIDE = 4;

export function lessTriviaEntryCount(triviaLog: readonly number[]): number {
  return Math.trunc(triviaLog.length / LESS_NODE_TRIVIA_STRIDE);
}

export function lessTriviaEntryInsertIndex(triviaLog: readonly number[], index: number): number {
  return triviaLog[index * LESS_NODE_TRIVIA_STRIDE + 2] ?? 0;
}

/** Whether any trivia stands before raw child `insertIndex`. */
export function hasTriviaAtInsertIndex(triviaLog: readonly number[], insertIndex: number): boolean {
  return triviaLog.some((value, at) => at % LESS_NODE_TRIVIA_STRIDE === 2 && value === insertIndex);
}

/** The layout text of the trivia before raw child `insertIndex` ({@link triviaTextAt}). */
export function triviaTextAtInsertIndex(
  triviaLog: readonly number[],
  state: unknown,
  insertIndex: number
): string {
  const source = sourceFromState(state);
  return source === undefined ? '' : triviaTextAt(triviaLog, source, insertIndex);
}

export function rawLeafText(entry: unknown): string | undefined {
  return typeof entry === 'object'
    && entry !== null
    && '_tag' in entry
    && entry._tag === 'leaf'
    && 'value' in entry
    && typeof entry.value === 'string'
    ? entry.value
    : undefined;
}

/** `sepBy`/`oneOrMoreSep` contribute their items and nothing else, so a list
 * separator is absent from `children` and present in `rawChildren` — which is
 * the array a trivia insert index has always addressed. Locate the k-th
 * separator's `rawChildren` index by the exact text `field('separator')`
 * captured, matched in source order, so trivia can be read against the array it
 * is indexed against rather than against a `children` array that no longer
 * advances in step with it. */
export function separatorRawIndexes(
  rawChildren: readonly unknown[],
  separators: readonly string[]
): number[] {
  const indexes: number[] = [];
  let next = 0;
  for (let index = 0; index < rawChildren.length && next < separators.length; index += 1) {
    if (rawLeafText(rawChildren[index]) === separators[next]) {
      indexes.push(index);
      next += 1;
    }
  }
  return indexes;
}

/** Trivia around one separator: what sits before it, then the separator, then
 * what sits between it and the item that follows. `rawIndex + 1` is that item —
 * a `sepBy` separator is always followed immediately by one item entry. */
export function separatorWithSurroundingTrivia(
  separator: string,
  rawIndex: number,
  triviaLog: readonly number[],
  state: unknown
): string {
  return triviaTextAtInsertIndex(triviaLog, state, rawIndex)
    + separator
    + triviaTextAtInsertIndex(triviaLog, state, rawIndex + 1);
}
