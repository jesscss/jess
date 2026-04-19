import type { IToken } from 'chevrotain';
import type { PrintOptions } from './print.js';

type TriviaEmitOptions = Pick<PrintOptions, 'context' | 'emittedTrivia' | 'writer'>;

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
  if (!options.context) {
    const emittedTrivia = options.emittedTrivia ?? (options.emittedTrivia = new Set());
    if (emittedTrivia.has(printable)) {
      return;
    }
    emittedTrivia.add(printable);
  }
  const writer = options.writer!;
  for (const token of printable) {
    writer.add(token.image);
  }
}
