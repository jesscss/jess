import type { IToken } from 'chevrotain';
import type { PrintOptions } from './print.js';
import type { TriviaMap } from '../../types/index.js';

type TriviaEmitOptions = Pick<PrintOptions, 'context' | 'emittedTrivia' | 'writer'>;
type TriviaLookup = 'before' | 'after';

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
