import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../../context.js';
import { OutputWriter, getPrintOptions } from '../print.js';
import { consumeTrivia, createTriviaMap, emitTriviaTokens } from '../trivia.js';

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
    const trivia = createTriviaMap({
      before: new Map([[10, tokens]]),
      after: new Map()
    });

    emitTriviaTokens(consumeTrivia(trivia, 10, 'before', options), options);
    emitTriviaTokens(consumeTrivia(trivia, 10, 'before', options), options);

    expect(writer.toString()).toBe('/* once */');
  });

  it('treats after as a lookup alias when the same run is indexed before another offset', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = getPrintOptions({ context, writer });
    const tokens = [token('/* before */')];
    const trivia = createTriviaMap({
      before: new Map([[10, tokens]]),
      after: new Map([[5, tokens]])
    });

    emitTriviaTokens(consumeTrivia(trivia, 5, 'after', options), options);
    emitTriviaTokens(consumeTrivia(trivia, 10, 'before', options), options);

    expect(writer.toString()).toBe('/* before */');
  });
});
