import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Any } from '../../../index.js';
import { Context } from '../../../context.js';
import { consumeTrivia, createTriviaMap, emitTriviaTokens } from '../trivia.js';
import { OutputWriter, getPrintOptions } from '../print.js';

const token = (image: string, name = 'WS'): IToken => ({
  image,
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length,
  tokenType: { name } as IToken['tokenType']
});

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('TriviaMap serialization', () => {
  it('keeps explicit writer print states detached from context print state', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = { context, writer };

    const resolved = getPrintOptions(options);

    expect(resolved).toBe(options);
    expect(resolved.writer).toBe(writer);
    expect(context.printState.writer).toBeUndefined();
  });

  it('serializes trivia looked up before a node offset', () => {
    const node = new Any('test', undefined, [10, 1, 11, 13, 1, 14]);
    const trivia = createTriviaMap({
      before: new Map([[10, [token('\n  '), token('/* keep */', 'BlockComment')]]]),
      after: new Map<number, IToken[]>()
    });

    expect(node.toString({ trivia })).toBe('\n  /* keep */test');
  });

  it('serializes generic node boundary trivia without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = new Any('test', undefined, [10, 1, 11, 13, 1, 14]);
    const trivia = createTriviaMap({
      before: new Map([[10, [token('\n  '), token('/* keep */', 'BlockComment')]]]),
      after: new Map<number, IToken[]>()
    });

    expect(node.toString({ trivia, writer })).toBe('\n  /* keep */test');
    expect(writer.toString()).toBe('\n  /* keep */test');
    expect(writer.captures).toBe(0);
  });

  it('does not serialize trailing trivia from generic node output', () => {
    const node = new Any('test', undefined, [10, 1, 11, 13, 1, 14]);
    const trivia = createTriviaMap({
      before: new Map<number, IToken[]>(),
      after: new Map([[13, [token('\n  ')]]])
    });

    expect(node.toString({ trivia })).toBe('test');
  });

  it('consumes a shared trailing lookup once when a parent boundary emits it', () => {
    const writer = new OutputWriter();
    const options = getPrintOptions({ writer });
    const tokens = [token(' '), token('/* keep me */', 'BlockComment')];
    const trivia = createTriviaMap({
      before: new Map<number, IToken[]>(),
      after: new Map([[13, tokens]])
    });

    emitTriviaTokens(consumeTrivia(trivia, 13, 'after', options), options);
    emitTriviaTokens(consumeTrivia(trivia, 13, 'after', options), options);

    expect(writer.toString()).toBe(' /* keep me */');
    expect(tokens.map(item => item.image)).toEqual([' ', '/* keep me */']);
  });
});
