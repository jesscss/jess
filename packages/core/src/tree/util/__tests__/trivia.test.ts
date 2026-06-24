import { describe, expect, it } from 'vitest';
import { Context } from '../../../context.js';
import { OutputWriter, getPrintOptions } from '../print.js';
import { consumeTrivia, consumeTriviaText, createTriviaMap, emitTriviaTokens, makeTrivia } from '../trivia.js';

// A trivia run is now a source range; build one whose text is exactly `text`.
const run = (text: string) => makeTrivia(text, 0, text.length);

describe('render trivia consumption', () => {
  it('consumes a trivia run once per print state even with a render context', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = getPrintOptions({ context, writer });
    const trivia = createTriviaMap({
      before: new Map([[10, run('/* once */')]]),
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
    // The SAME run object indexed from both sides — emitted once by identity.
    const shared = run('/* before */');
    const trivia = createTriviaMap({
      before: new Map([[10, shared]]),
      after: new Map([[5, shared]])
    });

    emitTriviaTokens(consumeTrivia(trivia, 5, 'after', options), options);
    emitTriviaTokens(consumeTrivia(trivia, 10, 'before', options), options);

    expect(writer.toString()).toBe('/* before */');
  });

  it('serializes consumed trivia text without writing through capture', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = getPrintOptions({ context, writer });
    const trivia = createTriviaMap({
      before: new Map([[10, run('/* once */')]]),
      after: new Map()
    });

    expect(consumeTriviaText(trivia, 10, 'before', options)).toBe('/* once */');
    expect(consumeTriviaText(trivia, 10, 'before', options)).toBe('');
    expect(writer.toString()).toBe('');
  });
});
