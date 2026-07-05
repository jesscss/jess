import { describe, expect, it } from 'vitest';
import { Any } from '../../../index.js';
import { Context } from '../../../context.js';
import { consumeTrivia, createTriviaMap, emitTriviaTokens, makeTrivia } from '../trivia.js';
import type { Trivia } from '../../../types/index.js';
import { OutputWriter, getPrintOptions, prepareRenderPrintState } from '../print.js';

// A trivia run is now a source range; build one whose text is exactly `text`.
const run = (text: string) => makeTrivia(text, 0, text.length);
const triviaText = (t: Trivia | undefined) => t ? t.src.slice(t.start, t.end) : undefined;

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
    const node = new Any('test', undefined, { start: 10, end: 13 });
    const trivia = createTriviaMap({
      before: new Map([[10, run('\n  /* keep */')]]),
      after: new Map()
    });

    expect(node.toString({ trivia })).toBe('\n  /* keep */test');
  });

  it('serializes generic node boundary trivia without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = new Any('test', undefined, { start: 10, end: 13 });
    const trivia = createTriviaMap({
      before: new Map([[10, run('\n  /* keep */')]]),
      after: new Map()
    });

    expect(node.toString({ trivia, writer })).toBe('\n  /* keep */test');
    expect(writer.toString()).toBe('\n  /* keep */test');
    expect(writer.captures).toBe(0);
  });

  it('does not serialize trailing trivia from generic node output', () => {
    const node = new Any('test', undefined, { start: 10, end: 13 });
    const trivia = createTriviaMap({
      before: new Map(),
      after: new Map([[13, run('\n  ')]])
    });

    expect(node.toString({ trivia })).toBe('test');
  });

  it('consumes a shared trailing lookup once when a parent boundary emits it', () => {
    const writer = new OutputWriter();
    const options = getPrintOptions({ writer });
    const tokens = run(' /* keep me */');
    const trivia = createTriviaMap({
      before: new Map(),
      after: new Map([[13, tokens]])
    });

    emitTriviaTokens(consumeTrivia(trivia, 13, 'after', options), options);
    emitTriviaTokens(consumeTrivia(trivia, 13, 'after', options), options);

    expect(writer.toString()).toBe(' /* keep me */');
    expect(triviaText(tokens)).toBe(' /* keep me */');
  });
});
