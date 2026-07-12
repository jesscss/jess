import type { IToken } from 'chevrotain';
import type { FinalPrintOptions, PrintOptions } from './print.js';
import type { TriviaLookup, TriviaMap } from '../../types/index.js';
import type { Node } from '../node.js';

type TriviaEmitOptions = Pick<PrintOptions, 'context' | 'emittedTrivia' | 'writer'>;

export function createTriviaMap(indexes?: {
  before?: Map<number, IToken[]>;
  after?: Map<number, IToken[]>;
}): TriviaMap {
  const before = indexes?.before ?? new Map<number, IToken[]>();
  const after = indexes?.after ?? new Map<number, IToken[]>();
  const runs = new Set<IToken[]>();
  for (const tokens of before.values()) {
    runs.add(tokens);
  }
  for (const tokens of after.values()) {
    runs.add(tokens);
  }
  return {
    runs,
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

function isTriviaMap(value: unknown): value is TriviaMap {
  return typeof value === 'object'
    && value !== null
    && 'runs' in value
    && value.runs instanceof Set
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

export function isLineCommentTriviaToken(token: IToken): boolean {
  return token.tokenType.name === 'LineComment';
}

export function isBlockCommentTriviaToken(token: IToken): boolean {
  return token.tokenType.name === 'Comment' || token.tokenType.name === 'BlockComment';
}

/**
 * Trivia is file-context owned whitespace/comments between source offsets.
 * A serializer may look up the continuous run before or after a given offset,
 * but the run is consumed once for the active print state regardless of which
 * side found it first.
 */
export function getPrintableTriviaTokens(
  tokens: IToken[] | undefined,
  options?: Pick<PrintOptions, 'context'>
): IToken[] | undefined {
  if (!tokens?.length) {
    return undefined;
  }
  if (!options?.context) {
    return tokens;
  }
  const printable = tokens.filter(token => !isLineCommentTriviaToken(token));
  return printable.length > 0 ? printable : undefined;
}

export function emitTriviaTokens(
  tokens: IToken[] | undefined,
  options: TriviaEmitOptions,
  emitOptions?: { skipLeadingWhitespace?: boolean }
): void {
  let printable = getPrintableTriviaTokens(tokens, options);
  if (!printable) {
    return;
  }
  if (emitOptions?.skipLeadingWhitespace) {
    printable = printable.filter((token, index) => {
      return index > 0 || token.tokenType.name !== 'WS';
    });
  }
  const writer = options.writer!;
  for (const token of printable) {
    writer.add(token.image);
  }
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
    emitTriviaTokens(consumeTrivia(trivia, node.location[0], 'before', options), options);
  }
  node.writeSyntax(options);
}

export function emitCommentTriviaBetweenNodes(
  prev: Node,
  next: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): void {
  const trivia = (
    options.trivia
    ?? treeTrivia(prev)
    ?? treeTrivia(next)
  );
  const prevEnd = prev.location[3];
  if (!trivia || prevEnd === undefined || next.location[0] === undefined) {
    return;
  }
  const tokens = trivia.lookup(prevEnd, 'after');
  if (!tokens?.some(token => token.tokenType.name !== 'WS')) {
    return;
  }
  emitTriviaTokens(consumeTrivia(trivia, prevEnd, 'after', options), options);
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
  const prevEnd = prev.location[3];
  if (!trivia || prevEnd === undefined || next.location[0] === undefined) {
    return;
  }
  const tokens = trivia.lookup(prevEnd, 'after');
  if (!tokens?.some(token => token.tokenType.name !== 'WS')) {
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
  const offset = node.location[3];
  if (!trivia || offset === undefined) {
    return;
  }
  const tokens = trivia.lookup(offset, 'after');
  if (!tokens?.some(token => token.tokenType.name !== 'WS')) {
    return;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(tokens)) {
    return;
  }
  emittedTrivia.add(tokens);
  emitTriviaTokens(tokens, options);
}

export function consumeTrivia(
  trivia: TriviaMap,
  offset: number | undefined,
  lookup: TriviaLookup,
  options: TriviaEmitOptions
): IToken[] | undefined {
  if (offset === undefined) {
    return undefined;
  }
  const tokens = trivia.lookup(offset, lookup);
  if (!tokens) {
    return undefined;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(tokens)) {
    return undefined;
  }
  emittedTrivia.add(tokens);
  return tokens;
}

export function consumeTriviaText(
  trivia: TriviaMap,
  offset: number | undefined,
  lookup: TriviaLookup,
  options: TriviaEmitOptions
): string {
  return getPrintableTriviaTokens(consumeTrivia(trivia, offset, lookup, options), options)
    ?.map(token => token.image)
    .join('') ?? '';
}

export function consumeTriviaBetween(
  trivia: TriviaMap | undefined,
  prev: Node,
  next: Node,
  options: TriviaEmitOptions
): IToken[] | undefined {
  const prevEnd = prev.location[3];
  const nextStart = next.location[0];
  if (!trivia || prevEnd === undefined || nextStart === undefined || prevEnd > nextStart) {
    return undefined;
  }
  const tokens = trivia.lookup(nextStart, 'before');
  if (!tokens?.length) {
    return undefined;
  }
  const isBetween = tokens.every((token) => {
    return token.startOffset !== undefined
      && token.endOffset !== undefined
      && token.startOffset > prevEnd
      && token.endOffset < nextStart;
  });
  return isBetween ? consumeTrivia(trivia, nextStart, 'before', options) : undefined;
}
