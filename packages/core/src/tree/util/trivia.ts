import type { IToken } from 'chevrotain';
import type { PrintOptions } from './print.js';
import type { TriviaMap } from '../../types/index.js';
import type { Node } from '../node.js';

type TriviaEmitOptions = Pick<PrintOptions, 'context' | 'emittedTrivia' | 'writer'>;
type TriviaLookup = 'before' | 'after';

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
  const printable = tokens.filter(token => !token.image.startsWith('//'));
  return printable.length > 0 ? printable : undefined;
}

export function emitTriviaTokens(
  tokens: IToken[] | undefined,
  options: TriviaEmitOptions
): void {
  const printable = getPrintableTriviaTokens(tokens, options);
  if (!printable) {
    return;
  }
  const writer = options.writer!;
  for (const token of printable) {
    writer.add(token.image);
  }
}

export function emitCommentTriviaBetweenNodes(
  prev: Node,
  next: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): void {
  const trivia = (
    options.trivia
    ?? prev.treeContext?.opts?.trivia
    ?? next.treeContext?.opts?.trivia
  ) as TriviaMap | undefined;
  const prevEnd = prev.location[3];
  const nextStart = next.location[0];
  if (!trivia || prevEnd === undefined || nextStart === undefined) {
    return;
  }
  for (const offset of [...trivia.before.keys()].sort((a, b) => a - b)) {
    if (offset > prevEnd && offset < nextStart) {
      const tokens = trivia.before.get(offset);
      if (tokens?.some(token => token.tokenType.name !== 'WS')) {
        emitTriviaTokens(consumeTrivia(trivia, offset, 'before', options), options);
      }
    }
  }
}

export function emitCommentTriviaBeforeDelimiter(
  prev: Node,
  next: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): void {
  const trivia = (
    options.trivia
    ?? prev.treeContext?.opts?.trivia
    ?? next.treeContext?.opts?.trivia
  ) as TriviaMap | undefined;
  const prevEnd = prev.location[3];
  const nextStart = next.location[0];
  if (!trivia || prevEnd === undefined || nextStart === undefined) {
    return;
  }
  const tokens = trivia.after.get(prevEnd);
  if (!tokens?.some(token => token.tokenType.name !== 'WS')) {
    return;
  }
  let delimiterOffset: number | undefined;
  for (const [offset, beforeTokens] of trivia.before) {
    if (beforeTokens === tokens && offset > prevEnd && offset < nextStart) {
      delimiterOffset = offset;
      break;
    }
  }
  if (delimiterOffset === undefined) {
    return;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(tokens)) {
    return;
  }
  emittedTrivia.add(tokens);
  emitTriviaTokens(tokens, options);
}

export function emitCommentTriviaAfterNode(
  node: Node,
  options: TriviaEmitOptions & Pick<PrintOptions, 'trivia'>
): void {
  const trivia = (
    options.trivia
    ?? node.treeContext?.opts?.trivia
  ) as TriviaMap | undefined;
  const offset = node.location[3];
  if (!trivia || offset === undefined) {
    return;
  }
  const tokens = trivia.after.get(offset);
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

function hasBeforeLookup(trivia: TriviaMap, tokens: IToken[]): boolean {
  for (const beforeTokens of trivia.before.values()) {
    if (beforeTokens === tokens) {
      return true;
    }
  }
  return false;
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
  const tokens = lookup === 'before'
    ? trivia.before.get(offset)
    : trivia.after.get(offset);
  if (!tokens) {
    return undefined;
  }
  if (lookup === 'after' && hasBeforeLookup(trivia, tokens)) {
    return undefined;
  }
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(tokens)) {
    return undefined;
  }
  emittedTrivia.add(tokens);
  return tokens;
}
