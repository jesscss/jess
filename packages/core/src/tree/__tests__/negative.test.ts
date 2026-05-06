import { beforeEach, describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  negative,
  num,
  ref,
  rules,
  type Rules as RulesClass,
  vardecl
} from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('Negative', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders negative syntax through toTrimmedString()', () => {
    expect(negative(num(10)).toTrimmedString()).toBe('-10');
  });

  it('renders negative values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));
    const rendered = negativeNode.render(context);

    expect(rendered).toBe('-20');
    expect(negativeNode.evaluated).toBe(false);
    expect(negativeNode.preEvaluated).toBe(false);
  });

  it('writes resolved negative render output into flat buffers', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const buffer = createRenderBuffer('flat');
    const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));

    expect(await negativeNode.render(context, buffer)).toBe('-20');
    expect(buffer.parts).toEqual(['-20']);
    expect(negativeNode.evaluated).toBe(false);
    expect(negativeNode.preEvaluated).toBe(false);
  });

  it('resolves negative values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('rhs'),
        value: num(20)
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const negativeNode = negative(ref({ key: 'rhs' }, { type: 'variable' }));
    const resolved = await negativeNode.resolve(context);

    expect(`${resolved}`).toBe('-20');
    expect(negativeNode.evaluated).toBe(false);
    expect(negativeNode.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
