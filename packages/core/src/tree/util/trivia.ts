import type { IToken } from 'chevrotain';
import type { PrintOptions } from './print.js';
import type { TriviaMap } from '../../types/index.js';

type TriviaEmitOptions = Pick<PrintOptions, 'context' | 'emittedTrivia' | 'writer'>;
type TriviaBoundary = 'pre' | 'post';

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
  const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
  if (emittedTrivia.has(tokens)) {
    return;
  }
  emittedTrivia.add(tokens);
  const writer = options.writer!;
  for (const token of printable) {
    writer.add(token.image);
  }
}

function isBeforeAlias(trivia: TriviaMap, tokens: IToken[]): boolean {
  for (const beforeTokens of trivia.before.values()) {
    if (beforeTokens === tokens) {
      return true;
    }
  }
  return false;
}

export function emitTriviaBoundary(
  trivia: TriviaMap,
  boundary: TriviaBoundary,
  offset: number | undefined,
  options: TriviaEmitOptions
): void {
  if (offset === undefined) {
    return;
  }
  const tokens = boundary === 'pre'
    ? trivia.before.get(offset)
    : trivia.after.get(offset);
  if (!tokens) {
    return;
  }
  if (boundary === 'post' && isBeforeAlias(trivia, tokens)) {
    return;
  }
  emitTriviaTokens(tokens, options);
}
