import { beforeEach, describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import { any, list, num, paren, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('Paren', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders paren syntax through toTrimmedString()', () => {
    expect(paren(any('foo')).toTrimmedString()).toBe('(foo)');
  });

  it('does not allocate options when rendering paren syntax with defaults', () => {
    const rule = paren(any('foo'));

    expect(rule.toTrimmedString()).toBe('(foo)');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('renders resolved paren values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    let parenResolveCalls = 0;
    parenNode.resolve = (renderContext: Context) => {
      parenResolveCalls++;
      return parenNode.evalNode(renderContext);
    };
    const rendered = parenNode.render(context);

    expect(rendered).toBe('(foo)');
    expect(parenResolveCalls).toBe(0);
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('writes resolved paren render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const buffer = createRenderBuffer('flat');
    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    let parenResolveCalls = 0;
    parenNode.resolve = (renderContext: Context) => {
      parenResolveCalls++;
      return parenNode.evalNode(renderContext);
    };

    expect(await parenNode.render(context, buffer)).toBe('(foo)');
    expect(buffer.parts).toEqual(['(foo)']);
    expect(parenResolveCalls).toBe(0);
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
  });

  it('streams paren values without capture scaffolding', () => {
    const writer = new CountingWriter();
    const value = any('foo');
    value._location = [4, 1, 5, 6, 1, 7];
    const trivia = createTriviaMap({
      before: new Map([[value.location[0], [token(' '), token('/*x*/', 'BlockComment')]]]),
      after: new Map<number, IToken[]>()
    }) satisfies TriviaMap;

    expect(paren(value).toTrimmedString({ trivia, writer })).toBe('(/*x*/foo)');
    expect(writer.captures).toBe(0);
  });

  it('resolves paren values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const parenNode = paren(ref({ key: 'value' }, { type: 'variable' }));
    const resolved = await parenNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('(foo)');
    expect(parenNode.evaluated).toBe(false);
    expect(parenNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source paren child containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('value'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const parenNode = paren(list([
      any('one'),
      ref({ key: 'value' }, { type: 'variable' })
    ]));
    const sourceValue = parenNode.value;
    const resolved = await parenNode.resolve(context);

    expect(resolved.render(context)).toBe('(one, foo)');
    expect(parenNode.toTrimmedString()).toBe('(one, $value)');
    expect(sourceValue?.parent).toBe(parenNode);
  });

  it('normalizes escaped semicolon lists to commas on eval', async () => {
    const resolved = await paren(
      list([num(7), num(8), num(9)], { sep: ';' }),
      { escaped: true }
    ).resolve(context);

    expect(resolved.toTrimmedString()).toBe('7, 8, 9');
    expect(context.printState.writer).toBeUndefined();
  });
});
