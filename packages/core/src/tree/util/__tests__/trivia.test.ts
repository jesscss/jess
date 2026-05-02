import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../../context.js';
import { OutputWriter, getPrintOptions } from '../print.js';
import { emitTriviaBoundary, emitTriviaTokens } from '../trivia.js';

const token = (image: string): IToken => ({
  image,
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length,
  tokenType: { name: image.startsWith('//') ? 'LineComment' : 'BlockComment' } as IToken['tokenType']
});

describe('render trivia consumption', () => {
  it('consumes a trivia token run once per print state even with a render context', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = getPrintOptions({ context, writer });
    const tokens = [token('/* once */')];

    emitTriviaTokens(tokens, options);
    emitTriviaTokens(tokens, options);

    expect(writer.toString()).toBe('/* once */');
  });

  it('treats after as a lookup alias when the same run is indexed before another offset', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = getPrintOptions({ context, writer });
    const tokens = [token('/* before */')];
    const trivia = {
      before: new Map([[10, tokens]]),
      after: new Map([[5, tokens]])
    };

    emitTriviaBoundary(trivia, 'post', 5, options);
    emitTriviaBoundary(trivia, 'pre', 10, options);

    expect(writer.toString()).toBe('/* before */');
  });
});
