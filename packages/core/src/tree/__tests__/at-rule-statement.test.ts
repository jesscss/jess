import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  atrulestatement,
  quoted,
} from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

describe('AtRuleStatement', () => {
  it('serializes semicolon at-rules without a Rules body', () => {
    const node = atrulestatement({
      name: '@import',
      prelude: quoted(any('theme.css'))
    });

    expect(node.toString()).toBe('@import "theme.css";');
    expect('rules' in node).toBe(false);
  });

  it('renders semicolon at-rules through the active context', async () => {
    const context = new Context();
    const node = atrulestatement({
      name: '@import',
      prelude: quoted(any('theme.css'))
    });

    await expect(Promise.resolve(node.render(context))).resolves.toBe('@import "theme.css";');
  });

  it('writes segmented buffer output through statement syntax', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = atrulestatement({
      name: '@import',
      prelude: quoted(any('theme.css'))
    });

    const rendered = await node.render(context, buffer);

    expect(rendered).toBe('@import "theme.css";');
    expect(buffer.segments).toEqual([rendered]);
  });
});
