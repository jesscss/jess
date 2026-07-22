import { decl, quoted, call, ref, list, keyword } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { describe, it, expect } from 'vitest';

/**
 * A space-separated declaration value can arrive from the parser as a flat
 * array of typed value nodes with NO verbatim whitespace fragment between
 * adjacent terms (e.g. `content: "x" counter(page)` → [Quoted, Call], or
 * `symbols: "A" "B" "C"` → [Quoted, Quoted, Quoted]). Rendering such a value
 * must (a) evaluate each term — so a fallback-value function Call like
 * `counter(page)` prints its CSS form, not its `$name?(...)` source sigil —
 * and (b) keep the terms space-separated.
 */
describe('declaration flat-array value eval + spacing', () => {
  const render = async (d: ReturnType<typeof decl>): Promise<string> => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const evald = await d.eval(context);
    return String(await evald.render(context, buffer));
  };

  it('spaces adjacent quoted terms with no whitespace fragment', async () => {
    const d = decl({
      name: 'symbols',
      value: [
        quoted('A', { quote: '"' }),
        quoted('B', { quote: '"' }),
        quoted('C', { quote: '"' })
      ]
    });
    expect(await render(d)).toBe('symbols: "A" "B" "C"');
  });

  it('renders a fallback function Call in CSS form and spaces it from the prior term', async () => {
    // content: "x" counter(page)
    const counter = call({
      name: ref('counter', { type: 'function', fallbackValue: true }),
      args: list([keyword('page')])
    }, { silentFail: true });
    const d = decl({
      name: 'content',
      value: [quoted('x', { quote: '"' }), counter]
    });
    expect(await render(d)).toBe('content: "x" counter(page)');
  });
});
