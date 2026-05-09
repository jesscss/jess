import { describe, it, expect, beforeEach } from 'vitest';
import { quoted, ref, rules, vardecl, any, Rules as RulesClass, color, interpolated, list } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import type { IToken } from 'chevrotain';
import { OutputWriter } from '../util/print.js';
import { INTERPOLATION_PLACEHOLDER } from '../interpolated.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('quoted', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders quoted syntax through toTrimmedString()', () => {
    expect(quoted('hello').toTrimmedString()).toBe('"hello"');
  });

  it('does not allocate options when rendering quoted syntax with defaults', () => {
    const rule = quoted('hello');

    expect(rule.toTrimmedString()).toBe('"hello"');
    expect(Object.getOwnPropertyDescriptor(rule, '_options')?.value).toBeUndefined();
  });

  it('does not allocate options when comparing default quoted values', () => {
    const left = quoted('hello');
    const right = quoted('hello');

    expect(left.compare(right)).toBe(0);
    expect(Object.getOwnPropertyDescriptor(left, '_options')?.value).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(right, '_options')?.value).toBeUndefined();
  });

  it('renders a resolved quoted value through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('message'),
        value: any('hello')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const quotedNode = quoted(ref({ key: 'message' }, { type: 'variable' }));
    const rendered = quotedNode.render(context);

    expect(rendered).toBe('"hello"');
    expect(quotedNode.evaluated).toBe(false);
    expect(quotedNode.preEvaluated).toBe(false);
  });

  it('writes resolved quoted render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('message'),
        value: any('hello')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const buffer = createRenderBuffer('flat');
    const quotedNode = quoted(ref({ key: 'message' }, { type: 'variable' }));

    expect(await quotedNode.render(context, buffer)).toBe('"hello"');
    expect(buffer.parts).toEqual(['"hello"']);
    expect(quotedNode.evaluated).toBe(false);
    expect(quotedNode.preEvaluated).toBe(false);
  });

  it('does not emit source trivia from resolved quoted value children', () => {
    const whitespace: IToken[] = [{
      image: ' ',
      tokenType: { name: 'WS' } as IToken['tokenType']
    }];
    const trivia = createTriviaMap({
      before: new Map([[10, whitespace]]),
      after: new Map()
    }) satisfies TriviaMap;
    const treeContext = new TreeContext({ trivia });
    const value = color({
      node: 'red',
      rgb: [255, 0, 0],
      alpha: 1
    }, undefined, [10, 1, 11, 12, 1, 13], treeContext);

    expect(quoted(value).toTrimmedString({ trivia })).toBe('"red"');
  });

  it('streams node values without capture scaffolding', () => {
    const writer = new CountingWriter();

    expect(quoted(any('hello')).toTrimmedString({ writer })).toBe('"hello"');
    expect(writer.captures).toBe(0);
  });

  it('resolves quoted values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('message'),
        value: any('hello')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const quotedNode = quoted(ref({ key: 'message' }, { type: 'variable' }));
    const resolved = await quotedNode.resolve(context);

    expect(`${resolved}`).toBe('"hello"');
    expect(quotedNode.evaluated).toBe(false);
    expect(quotedNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('keeps source quoted interpolated containers canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('message'),
        value: any('hello')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const quotedNode = quoted(interpolated({
      source: `say-${INTERPOLATION_PLACEHOLDER}`,
      replacements: [list([
        any('one'),
        ref({ key: 'message' }, { type: 'variable' })
      ])]
    }));
    const sourceValue = quotedNode.value;
    const resolved = await quotedNode.resolve(context);

    expect(`${resolved}`).toBe('"say-one, hello"');
    expect(sourceValue.parent).toBe(quotedNode);
    expect(quotedNode.toTrimmedString()).toBe('"say-one, $message"');
  });
});
