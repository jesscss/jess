import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, F_MAY_ASYNC, F_STATIC, num, op, query, ref, rules, Sequence, Rules as RulesClass, vardecl } from '../index.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
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

  it('streams query-condition parts without capture scaffolding', () => {
    const writer = new CountingWriter();
    const node = query([any('screen'), any('and'), any('(color)')]);

    expect(node.toTrimmedString({ writer })).toBe('screen and (color)');
    expect(writer.captures).toBe(0);
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

  it('renders dynamic sync query conditions directly without materialized values', () => {
    const dynamicItem = op([num(1), '+', num(2)]);
    dynamicItem.resolve = () => {
      throw new Error('dynamic sync query-condition render should not resolve container children');
    };
    const node = query([dynamicItem, any('and'), any('(color)')]);

    expect(node.render(context)).toBe('3 and (color)');
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
});
