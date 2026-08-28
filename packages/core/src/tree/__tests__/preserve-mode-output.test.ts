import { describe, expect, it } from 'vitest';
import { dimension, num, op } from '../index.js';
import { Context } from '../../context.js';

describe('Preserve Mode Output Examples', () => {
  const context = new Context({ unitMode: 'preserve' });

  async function renderOperation(nodes: Parameters<typeof op>[0]): Promise<string> {
    const result = await op(nodes).eval(context);
    return result.render(context);
  }

  /*
   * Preserve mode keeps incompatible/compound arithmetic un-collapsed with the
   * ORIGINAL operands — `calc(l op r)` for `+`/`-`/`*`, and a raw `l / r` for
   * division that doesn't cancel to a single unit. No fabricated fused units.
   */
  it('renders preserve-mode operation outputs through render(context)', async () => {
    await expect(renderOperation([dimension([10, 'px']), '+', dimension([2, 'rem'])]))
      .resolves.toBe('calc(10px + 2rem)');
    await expect(renderOperation([num(10), '/', dimension([2, 'px'])]))
      .resolves.toBe('10 / 2px');
    await expect(renderOperation([dimension([10, 'px']), '*', dimension([2, 'px'])]))
      .resolves.toBe('calc(10px * 2px)');
    await expect(renderOperation([dimension([10, 'px']), '/', dimension([2, 's'])]))
      .resolves.toBe('10px / 2s');
    await expect(renderOperation([dimension([10, 'px']), '*', dimension([2, 'em'])]))
      .resolves.toBe('calc(10px * 2em)');
    await expect(renderOperation([dimension([10, 'px']), '*', dimension([2, 'cm'])]))
      .resolves.toBe('calc(10px * 2cm)');
    await expect(renderOperation([dimension([10, 'px']), '/', dimension([2, 'cm'])]))
      .resolves.toBe('10px / 2cm');
    await expect(renderOperation([dimension([10, 'px']), '/', dimension([2, 'px'])]))
      .resolves.toBe('10px / 2px');
  });
});
