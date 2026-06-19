import { describe, expect, it } from 'vitest';
import { dimension, num, op } from '../index.js';
import { Context } from '../../context.js';

describe('Preserve Mode Output Examples', () => {
  const context = new Context();
  context.opts.unitMode = 'preserve';

  async function renderOperation(nodes: Parameters<typeof op>[0]): Promise<string> {
    const result = await op(nodes).eval(context);
    return result.render(context);
  }

  it('renders preserve-mode operation outputs through render(context)', async () => {
    await expect(renderOperation([dimension([10, 'px']), '+', dimension([2, 'rem'])]))
      .resolves.toBe('calc(1px + 1rem)');
    await expect(renderOperation([num(10), '/', dimension([2, 'px'])]))
      .resolves.toBe('10 / 2px');
    await expect(renderOperation([dimension([10, 'px']), '*', dimension([2, 'px'])]))
      .resolves.toBe('20px');
    await expect(renderOperation([dimension([10, 'px']), '/', dimension([2, 's'])]))
      .resolves.toBe('10px / 2s');
    await expect(renderOperation([dimension([10, 'px']), '*', dimension([2, 'em'])]))
      .resolves.toBe('calc(20 * 1px * 1em)');
    await expect(renderOperation([dimension([10, 'px']), '*', dimension([2, 'cm'])]))
      .resolves.toBe('calc(20 * 1px * 1cm)');
    await expect(renderOperation([dimension([10, 'px']), '/', dimension([2, 'cm'])]))
      .resolves.toBe('10px / 2cm');
    await expect(renderOperation([dimension([10, 'px']), '/', dimension([2, 'px'])]))
      .resolves.toBe('10px / 2px');
  });
});
