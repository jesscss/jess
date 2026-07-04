import { spanStartOf, spanEndOf } from './provenance.js';
import type { FinalPrintOptions, PrintOptions } from './print.js';
import type { TriviaLookup, TriviaMap, Trivia } from '../../types/index.js';
import type { Node } from '../node.js';

type TriviaEmitOptions = Pick<PrintOptions, 'context' | 'emittedTrivia' | 'writer'>;

/**
 * Build a TriviaMap from per-offset run indexes. A run is identified by its
 * source range (`{ start, end, src }`) — its text is sliced on demand at print
 * time, so no per-token objects are allocated. The same run object is shared by
 * its `before` (runEnd) and `after` (runStart) keys, which is what
 * `emittedTrivia` (a `Set<Trivia>`) dedupes on.
 */
export function createTriviaMap(indexes?: {
  before?: Map<number, Trivia>;
  after?: Map<number, Trivia>;
}): TriviaMap {
  const before = indexes?.before ?? new Map<number, Trivia>();
  const after = indexes?.after ?? new Map<number, Trivia>();
  return {
    lookup(offset, direction) {
      if (offset === undefined) {
        return undefined;
      }
      return direction === 'before'
        ? before.get(offset)
        : after.get(offset);
    },
    entries(direction) {
      return direction === 'before'
        ? before.entries()
        : after.entries();
    },
    has(offset, direction) {
      if (offset === undefined) {
        return false;
      }
      return direction === 'before'
        ? before.has(offset)
        : after.has(offset);
    }
  };
}

/**
 * Construct a single trivia run over [start, end) of `src`. `hasComment` is
 * derived once here (a charCode scan, no slice) so the serialization path never
 * re-scans the text. Trivia is only whitespace + comments, so any non-whitespace
 * char in the range means the run carries a comment.
 */
export function makeTrivia(src: string, start: number, end: number): Trivia {
  let hasComment = false;
  for (let i = start; i < end; i++) {
    const c = src.charCodeAt(i);
    // space \t \n \r \f  → whitespace; anything else starts a comment
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) {
      hasComment = true;
      break;
    }
  }
  return { start, end, src, hasComment };
}

function isTriviaMap(value: unknown): value is TriviaMap {
  return typeof value === 'object'
    && value !== null
    && 'lookup' in value
    && typeof value.lookup === 'function'
    && 'entries' in value
    && typeof value.entries === 'function'
    && 'has' in value
    && typeof value.has === 'function';
}

function treeTrivia(node: Node): TriviaMap | undefined {
  const trivia: unknown = node.sourceRoot?._treeContext?.opts?.trivia;
  return isTriviaMap(trivia) ? trivia : undefined;
}

/**
 * The printable text of a run: its raw source slice, with `//` line comments
 * stripped when emitting in a compressed `context` (they cannot survive there).
 * Pure — does not consume the run.
 */
export function printableTriviaText(run: Trivia | undefined, context?: unknown): string {
  if (!run) {
    return '';
  }
  const text = run.src.slice(run.start, run.end);
  return context && run.hasComment ? text.replace(/\/\/[^\n\r]*/g, '') : text;
}

/** True if the run contains a block comment (`/* … *\/`), regardless of context. */
export function triviaHasBlockComment(run: Trivia | undefined): boolean {
  return Boolean(run && run.src.slice(run.start, run.end).includes('/*'));
}

/** The leading whitespace prefix of a run (empty when it starts with a comment). */
function leadingWhitespaceOf(run: Trivia | undefined): string {
  if (!run) {
    return '';
  }
  return /^[ \t\n\r\f]+/.exec(run.src.slice(run.start, run.end))?.[0] ?? '';
}

export function emitTriviaTokens(
  run: Trivia | undefined,
  options: TriviaEmitOptions,
  emitOptions?: { skipLeadingWhitespace?: boolean }
): void {
  let text = printableTriviaText(run, options.context);
  if (!text) {
    return;
  }
  if (emitOptions?.skipLeadingWhitespace) {
    text = text.replace(/^[ \t\n\r\f]+/, '');
    if (!text) {
      return;
    }
  }
  options.writer!.add(text);
}

/**
 * Emits a child node in authored syntax while preserving its leading trivia.
 *
 * This is the direct-writer form of the child-boundary behavior that
 * `Node.toString(...)` historically provided: consume leading trivia for the
 * active print state, then let the node write its syntax into the same writer.
 */
export function emitNodeSourceSyntaxWithTrivia(
  node: Node,
  options: FinalPrintOptions
): void {
  const trivia = options.trivia ?? treeTrivia(node);
  if (trivia && options.trivia !== trivia) {
    options.trivia = trivia;
  }
  const suppressPre = options.suppressBoundaryTrivia === 'pre'
    || options.suppressBoundaryTrivia === 'both';
  if (!suppressPre && trivia) {
    emitTriviaTokens(consumeTrivia(trivia, spanStartOf(node), 'before', options), options);
  }
  node.writeSyntax(options);
}

export function emitCommentTriviaBetweenNodes(
  prev: Node,
  next: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): boolean {
  const trivia = (
    options.trivia
    ?? treeTrivia(prev)
    ?? treeTrivia(next)
  );
  const prevEnd = spanEndOf(prev);
  if (!trivia || prevEnd === undefined || spanStartOf(next) === undefined) {
    return false;
  }
  const run = trivia.lookup(prevEnd, 'after');
  if (!run?.hasComment) {
    return false;
  }
  const consumed = consumeTrivia(trivia, prevEnd, 'after', options);
  if (!consumed) {
    return false;
  }
  emitTriviaTokens(consumed, options);
  return true;
}

export function emitCommentTriviaBeforeDelimiter(
  prev: Node,
  next: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): void {
  const trivia = (
    options.trivia
    ?? treeTrivia(prev)
    ?? treeTrivia(next)
  );
  const prevEnd = spanEndOf(prev);
  if (!trivia || prevEnd === undefined || spanStartOf(next) === undefined) {
    return;
  }
  const run = trivia.lookup(prevEnd, 'after');
  if (!run?.hasComment) {
    return;
  }
  emitTriviaTokens(consumeTrivia(trivia, prevEnd, 'after', options), options);
}

export function emitCommentTriviaAfterNode(
  node: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): void {
  const trivia = (
    options.trivia
    ?? treeTrivia(node)
  );
  const offset = spanEndOf(node);
  if (!trivia || offset === undefined) {
    return;
  }
  const run = trivia.lookup(offset, 'after');
  if (!run?.hasComment) {
    return;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(run)) {
    return;
  }
  emittedTrivia.add(run);
  emitTriviaTokens(run, options);
}

/**
 * Like `emitCommentTriviaAfterNode`, but keyed by an explicit source offset —
 * for a string component (e.g. a bare declaration/at-rule name) that carries no
 * own node span; the offset comes from the owning node's `fieldSpans` slot.
 */
export function emitCommentTriviaAfterOffset(
  trivia: TriviaMap | undefined,
  offset: number | undefined,
  options: TriviaEmitOptions
): void {
  if (!trivia || offset === undefined) {
    return;
  }
  const run = trivia.lookup(offset, 'after');
  if (!run?.hasComment) {
    return;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(run)) {
    return;
  }
  emittedTrivia.add(run);
  emitTriviaTokens(run, options);
}

export function consumeTrivia(
  trivia: TriviaMap,
  offset: number | undefined,
  lookup: TriviaLookup,
  options: TriviaEmitOptions
): Trivia | undefined {
  if (offset === undefined) {
    return undefined;
  }
  const run = trivia.lookup(offset, lookup);
  if (!run) {
    return undefined;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(run)) {
    return undefined;
  }
  emittedTrivia.add(run);
  return run;
}

export function consumeTriviaText(
  trivia: TriviaMap,
  offset: number | undefined,
  lookup: TriviaLookup,
  options: TriviaEmitOptions
): string {
  return printableTriviaText(consumeTrivia(trivia, offset, lookup, options), options.context);
}

export function consumeTriviaBetween(
  trivia: TriviaMap | undefined,
  prev: Node,
  next: Node,
  options: TriviaEmitOptions
): Trivia | undefined {
  const prevEnd = spanEndOf(prev);
  const nextStart = spanStartOf(next);
  if (!trivia || prevEnd === undefined || nextStart === undefined || prevEnd > nextStart) {
    return undefined;
  }
  const run = trivia.lookup(nextStart, 'before');
  if (!run || run.start < prevEnd || run.end > nextStart) {
    return undefined;
  }
  return consumeTrivia(trivia, nextStart, 'before', options);
}

/**
 * Like consumeTriviaBetween, but for string components that carry no own node
 * location — the surrounding offsets come from the owning node's valueSpans.
 */
export function consumeTriviaBetweenOffsets(
  trivia: TriviaMap | undefined,
  prevEnd: number | undefined,
  nextStart: number | undefined,
  options: TriviaEmitOptions
): Trivia | undefined {
  if (!trivia || prevEnd === undefined || nextStart === undefined
    || prevEnd < 0 || nextStart < 0 || prevEnd > nextStart) {
    return undefined;
  }
  const run = trivia.lookup(nextStart, 'before');
  if (!run || run.start < prevEnd || run.end > nextStart) {
    return undefined;
  }
  return consumeTrivia(trivia, nextStart, 'before', options);
}

/** The leading-whitespace image of a run, or '' — for newline-preservation checks. */
export function triviaLeadingWhitespace(run: Trivia | undefined): string {
  return leadingWhitespaceOf(run);
}
