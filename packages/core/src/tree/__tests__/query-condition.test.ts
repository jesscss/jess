import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { any, query, ref, rules, Sequence, Rules as RulesClass, vardecl } from '../index.js';
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
