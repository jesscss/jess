import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Any } from '../../../index.js';
import { Context } from '../../../context.js';
import { consumeTrivia, createTriviaMap, emitTriviaTokens } from '../trivia.js';
import { OutputWriter, getPrintOptions, prepareRenderPrintState } from '../print.js';

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
  it('resets context print state for fresh render traversals', () => {
    const context = new Context();
    const staleWriter = new OutputWriter();
    context.printState.writer = staleWriter;
    context.printState.frameHeaders = ['.stale'];

    const prepared = prepareRenderPrintState(context, { context, compress: true });

    expect(prepared).toBe(context.printState);
    expect(prepared.writer).not.toBe(staleWriter);
    expect(prepared.frameHeaders).toEqual([]);
    expect(prepared.compress).toBe(true);
  });

  it('reuses explicit active render print state for nested render bridges', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const options = { context, writer, frameHeaders: ['.active'] };

    const prepared = prepareRenderPrintState(context, options);

    expect(prepared).toBe(options);
    expect(prepared.writer).toBe(writer);
    expect(prepared.frameHeaders).toEqual(['.active']);
    expect(context.printState.writer).toBeUndefined();
  });

  it('does not treat print state from another context as active', () => {
    const context = new Context();
    const otherContext = new Context();
    const writer = new OutputWriter();
    const options = { context: otherContext, writer };

    const prepared = prepareRenderPrintState(context, options);

    expect(prepared).toBe(context.printState);
    expect(prepared).not.toBe(options);
    expect(prepared.context).toBe(context);
    expect(prepared.writer).toBe(writer);
  });

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
