import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  bool,
  color,
  condition,
  Condition,
  dimension,
  F_MAY_ASYNC,
  F_NON_STATIC,
  F_STATIC,
  Node,
  num,
  op,
  Operation,
  paren,
  Paren,
  query,
  QueryCondition,
  ref,
  rules,
  Sequence,
  Rules as RulesClass,
  vardecl
} from '../index.js';
import { OutputWriter, getPrintOptions, prepareRenderPrintState, type PrintOptions } from '../util/print.js';
import { createRenderBuffer, type FlatRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  marks = 0;
  reads = 0;
  hasContentReads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }

  override hasContentSince(mark: number): boolean {
    this.hasContentReads++;
    return super.hasContentSince(mark);
  }
}

class ReturnOnlyNode extends Node<string> {
  constructor(value: string) {
    super(value);
    this.addFlag(F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    getPrintOptions(options).writer.add(`source-${this.value}`);
    return `source-${this.value}`;
  }

  override render(): string {
    return this.value;
  }
}

class WritingNode extends ReturnOnlyNode {
  override render(_context: Context, options?: PrintOptions): string {
    getPrintOptions(options).writer.add(this.value);
    return `returned-${this.value}`;
  }
}

async function setEvaluatedRoot(context: Context, node: RulesClass): Promise<void> {
  const evald = await node.eval(context);
  expect(evald).toBeInstanceOf(RulesClass);
  if (!(evald instanceof RulesClass)) {
    throw new Error('Expected Rules root');
  }
  context.root = evald;
  context.rulesContext = evald;
}

describe('QueryCondition', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders query-condition syntax through toTrimmedString()', () => {
    const node = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]);

    expect(node.toTrimmedString()).toBe('screen and $mode');
  });

  it('inherits the sequence direct child field', () => {
    const first = any('screen');
    const second = any('(color)');
    const node = query([first, second]);

    expect(node.items).toEqual([first, second]);
    expect(node.items).toBe(node.value);
    expect(QueryCondition.childKeys).toEqual(['items']);
  });

  it('writes empty query-condition syntax without writer readback', () => {
    const writer = new CountingWriter();

    expect(query([]).toTrimmedString({ writer })).toBe('');
    expect(writer.toString()).toBe('');
    expect(writer.reads).toBe(0);
    expect(writer.captures).toBe(0);
  });

  it('streams query-condition parts without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = query([any('screen'), any('and'), any('(color)')]);

    expect(node.toTrimmedString({ writer })).toBe('screen and (color)');
    expect(writer.captures).toBe(0);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('writes query-condition source children without public toString transport', () => {
    const first = any('screen');
    const second = any('(color)');
    let toStringCalls = 0;
    first.toString = () => {
      toStringCalls++;
      return '';
    };
    second.toString = () => {
      toStringCalls++;
      return '';
    };
    const node = query([first, any('and'), second]);

    expect(node.toTrimmedString()).toBe('screen and (color)');
    expect(toStringCalls).toBe(0);
  });

  it('renders static query conditions without resolving children', () => {
    const first = any('screen');
    const second = any('(color)');
    first.resolve = () => {
      throw new Error('static query-condition render should not resolve children');
    };
    second.resolve = () => {
      throw new Error('static query-condition render should not resolve children');
    };
    const node = query([first, any('and'), second]);

    expect(node.render(context)).toBe('screen and (color)');
  });

  it('renders static query-condition children without public toString transport', () => {
    const first = any('screen');
    const second = any('(color)');
    let toStringCalls = 0;
    first.toString = () => {
      toStringCalls++;
      return '';
    };
    second.toString = () => {
      toStringCalls++;
      return '';
    };
    const node = query([first, any('and'), second]);

    expect(node.render(context)).toBe('screen and (color)');
    expect(toStringCalls).toBe(0);
  });

  it('renders static query conditions without returning prefixed writer contents', () => {
    const writer = new CountingWriter();
    writer.add('prefix|');
    const node = query([any('screen'), any('and'), any('(color)')]);

    expect(node.render(context, { writer })).toBe('screen and (color)');
    expect(writer.toString()).toBe('prefix|screen and (color)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders dynamic sync query conditions directly without materialized values', () => {
    const dynamicItem = op([num(1), '+', num(2)]);
    dynamicItem.resolve = () => {
      throw new Error('dynamic sync query-condition render should not resolve container children');
    };
    const node = query([dynamicItem, any('and'), any('(color)')]);

    expect(node.render(context)).toBe('3 and (color)');
  });

  it('does not probe static siblings in sync query-condition render', () => {
    const writer = new CountingWriter();
    const queryNode = query([
      op([num(1), '+', num(2)]),
      any('and'),
      any('(color)')
    ]);

    expect(queryNode.render(context, { writer })).toBe('3 and (color)');
    expect(writer.toString()).toBe('3 and (color)');
    expect(writer.marks).toBe(0);
  });

  it('renders dynamic query conditions without returning prefixed writer contents', () => {
    const writer = new CountingWriter();
    writer.add('prefix|');
    const queryNode = query([
      op([num(1), '+', num(2)]),
      any('and'),
      any('(color)')
    ]);

    expect(queryNode.render(context, { writer })).toBe('3 and (color)');
    expect(writer.toString()).toBe('prefix|3 and (color)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders resolved query-condition values through render(context)', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('print')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const queryNode = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]);
    const rendered = queryNode.render(context);

    expect(rendered).toBe('screen and print');
    expect(queryNode.evaluated).toBe(false);
    expect(queryNode.registrationPrepared).toBe(false);
  });

  it('writes resolved query-condition output into flat buffers', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('print')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const buffer = createRenderBuffer('flat');
    const queryNode = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]);

    expect(await queryNode.render(context, buffer)).toBe('screen and print');
    expect(buffer.parts).toEqual(['screen and print']);
    expect(queryNode.evaluated).toBe(false);
    expect(queryNode.registrationPrepared).toBe(false);
  });

  it('writes static query-condition output into shared flat buffers without mark readback', () => {
    const buffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const queryNode = query([any('screen'), any('and'), any('(color)')]);

    expect(queryNode.render(context, buffer)).toBe('screen and (color)');
    expect(buffer.parts).toEqual(['screen', ' ', 'and', ' ', '(color)']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders static shared-buffer query conditions without returning prefixed buffer contents', () => {
    const buffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    buffer.parts.push('prefix|');
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const queryNode = query([any('screen'), any('and'), any('(color)')]);

    expect(queryNode.render(context, buffer)).toBe('screen and (color)');
    expect(buffer.parts).toEqual(['prefix|', 'screen', ' ', 'and', ' ', '(color)']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('renders query conditions through their own resolved syntax instead of Sequence.render()', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('print')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const sequenceRender = Sequence.prototype.render;
    Sequence.prototype.render = () => {
      throw new Error('QueryCondition.render should not use generic Sequence.render');
    };
    try {
      const queryNode = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]);

      expect(queryNode.render(context)).toBe('screen and print');
      expect(queryNode.evaluated).toBe(false);
      expect(queryNode.registrationPrepared).toBe(false);
    } finally {
      Sequence.prototype.render = sequenceRender;
    }
  });

  it('renders async query conditions directly without resolving into materialized values', async () => {
    const asyncItem = any('screen');
    asyncItem.render = async () => 'print';
    asyncItem.resolve = () => {
      throw new Error('async query-condition render should not resolve children');
    };
    const queryNode = query([
      asyncItem,
      any('and'),
      any('(color)')
    ]);
    queryNode.addFlag(F_MAY_ASYNC);
    queryNode.removeFlag(F_STATIC);
    const originalMap = queryNode.value.map;
    Object.defineProperty(queryNode.value, 'map', {
      configurable: true,
      value: () => {
        throw new Error('async query-condition render should not allocate mapped tuple entries');
      }
    });

    try {
      await expect(Promise.resolve(queryNode.render(context))).resolves.toBe('print and (color)');
    } finally {
      Object.defineProperty(queryNode.value, 'map', {
        configurable: true,
        writable: true,
        value: originalMap
      });
    }
  });

  it('does not probe static siblings in async query-condition render', async () => {
    const writer = new CountingWriter();
    const asyncItem = any('screen');
    asyncItem.render = async () => 'print';
    const queryNode = query([
      asyncItem,
      any('and'),
      any('(color)')
    ]);
    queryNode.addFlag(F_MAY_ASYNC);
    queryNode.removeFlag(F_STATIC);

    await expect(Promise.resolve(queryNode.render(context, { writer }))).resolves.toBe('print and (color)');
    expect(writer.toString()).toBe('print and (color)');
    expect(writer.marks).toBe(0);
  });

  it('renders async query conditions without returning prefixed writer contents', async () => {
    const writer = new CountingWriter();
    writer.add('prefix|');
    const asyncItem = any('screen');
    asyncItem.render = async () => 'print';
    const queryNode = query([
      asyncItem,
      any('and'),
      any('(color)')
    ]);
    queryNode.addFlag(F_MAY_ASYNC);
    queryNode.removeFlag(F_STATIC);

    await expect(Promise.resolve(queryNode.render(context, { writer }))).resolves.toBe('print and (color)');
    expect(writer.toString()).toBe('prefix|print and (color)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
  });

  it('resolves query-condition values without touching render state', async () => {
    const root = rules([
      vardecl({
        name: any('mode'),
        value: any('print')
      })
    ]);
    await setEvaluatedRoot(context, root);

    const queryNode = query([any('screen'), any('and'), ref({ key: 'mode' }, { type: 'variable' })]);
    const resolved = await queryNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('screen and print');
    expect(queryNode.evaluated).toBe(false);
    expect(queryNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  it('renders scalar static conditions into a shared flat buffer without mark readback', () => {
    const node = query([
      any('screen'),
      any('and'),
      any('(min-width:'),
      dimension([10, 'px']),
      any(')'),
      bool(true),
      color('#fff')
    ]);
    const buffer: FlatRenderBuffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);

    prepareRenderPrintState(context, { writer });
    const rendered = node.render(context, buffer);

    expect(rendered).toBe('screen and (min-width: 10px ) true #fff');
    expect(buffer.parts).toEqual(['screen', ' ', 'and', ' ', '(min-width:', ' ', '10px', ' ', ')', ' ', 'true', ' ', '#fff']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(0);
    expect(writer.captures).toBe(0);
  });

  it('renders static paren conditions through the direct child contract', () => {
    const buffer: FlatRenderBuffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const node = query([
      any('screen'),
      any('and'),
      paren(any('color', { role: 'keyword' }))
    ]);

    expect(node.render(context, buffer)).toBe('screen and (color)');
    expect(buffer.parts).toEqual(['screen', ' ', 'and', ' ', '(', 'color', ')']);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(0);
  });

  it('renders nested static query conditions through the direct child contract', () => {
    const buffer: FlatRenderBuffer = createRenderBuffer('flat');
    buffer.shareWriter = true;
    const writer = new CountingWriter(false, buffer.parts);
    context.printState.writer = writer;
    const node = query([
      query([any('screen'), any('and'), any('(color)')]),
      any('or'),
      any('(grid)')
    ]);

    expect(node.render(context, buffer)).toBe('screen and (color) or (grid)');
    expect(buffer.parts).toEqual([
      'screen',
      ' ',
      'and',
      ' ',
      '(color)',
      ' ',
      'or',
      ' ',
      '(grid)'
    ]);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(0);
  });

  it('writes condition children through the direct source child contract', () => {
    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      condition([dimension([10, 'px']), '>', dimension([1, 'px'])])
    ]);

    expect(node.toTrimmedString({ writer })).toBe('screen and (10px > 1px)');
    expect(writer.toString()).toBe('screen and (10px > 1px)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(0);
  });

  it('writes exact operation children through the direct source child contract', () => {
    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      op([dimension([10, 'px']), '>', dimension([1, 'px'])])
    ]);

    expect(node.toTrimmedString({ writer })).toBe('screen and 10px > 1px');
    expect(writer.toString()).toBe('screen and 10px > 1px');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(0);
  });

  it('writes exact paren children through the direct source child contract', () => {
    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      paren(any('color', { role: 'keyword' }))
    ]);

    expect(node.toTrimmedString({ writer })).toBe('screen and (color)');
    expect(writer.toString()).toBe('screen and (color)');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(0);
  });

  it('keeps custom operation syntax overrides on the static fallback path', () => {
    class CustomOperation extends Operation {
      override writeSyntax(options: Parameters<Operation['writeSyntax']>[0]): void {
        options.writer.add('custom-operation');
      }
    }

    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      new CustomOperation([dimension([10, 'px']), '>', dimension([1, 'px'])])
    ]);

    expect(node.toTrimmedString({ writer })).toBe('screen and custom-operation');
    expect(writer.toString()).toBe('screen and custom-operation');
    expect(writer.marks).toBe(2);
    expect(writer.reads).toBe(2);
    expect(writer.hasContentReads).toBe(0);
  });

  it('keeps custom condition syntax overrides on the static fallback path', () => {
    class CustomCondition extends Condition {
      override writeSyntax(options: Parameters<Condition['writeSyntax']>[0]): void {
        options.writer.add('(custom-condition)');
      }
    }

    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      new CustomCondition([bool(true)])
    ]);

    expect(node.toTrimmedString({ writer })).toBe('screen and (custom-condition)');
    expect(writer.toString()).toBe('screen and (custom-condition)');
    expect(writer.marks).toBe(2);
    expect(writer.reads).toBe(2);
    expect(writer.hasContentReads).toBe(0);
  });

  it('keeps custom paren syntax overrides on the static fallback path', () => {
    class CustomParen extends Paren {
      override writeSyntax(options: Parameters<Paren['writeSyntax']>[0]): void {
        options.writer.add('(custom)');
      }
    }

    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      new CustomParen(any('color', { role: 'keyword' }))
    ]);

    expect(node.render(context, { writer })).toBe('screen and (custom)');
    expect(writer.toString()).toBe('screen and (custom)');
    expect(writer.marks).toBe(2);
    expect(writer.reads).toBe(2);
    expect(writer.hasContentReads).toBe(0);
  });

  it('keeps static fallback query returns local when the writer already has content', () => {
    class CustomParen extends Paren {
      override writeSyntax(options: Parameters<Paren['writeSyntax']>[0]): void {
        options.writer.add('(custom)');
      }
    }

    const writer = new CountingWriter();
    writer.add('prefix|');
    const node = query([
      any('screen'),
      any('and'),
      new CustomParen(any('color', { role: 'keyword' }))
    ]);

    expect(node.render(context, { writer })).toBe('screen and (custom)');
    expect(writer.toString()).toBe('prefix|screen and (custom)');
    expect(writer.marks).toBe(2);
    expect(writer.reads).toBe(2);
    expect(writer.hasContentReads).toBe(0);
  });

  it('probes only custom dynamic children that return without writing', () => {
    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      new ReturnOnlyNode('custom')
    ]);

    const rendered = node.render(context, { writer });

    expect(rendered).toBe('screen and custom');
    expect(writer.toString()).toBe(rendered);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(writer.hasContentReads).toBe(1);
    expect(writer.captures).toBe(0);
  });

  it('preserves custom dynamic children that write different text than they return', () => {
    const writer = new CountingWriter();
    const node = query([
      any('screen'),
      any('and'),
      new WritingNode('written')
    ]);

    const rendered = node.render(context, { writer });

    expect(rendered).toBe('screen and written');
    expect(writer.toString()).toBe(rendered);
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(1);
    expect(writer.hasContentReads).toBe(1);
    expect(writer.captures).toBe(0);
  });
});
