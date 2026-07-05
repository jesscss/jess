import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { atrule, query, paren, keyword, quoted, decl, rules, color } from '../index.js';
import { createRenderBuffer } from '../util/render-buffer.js';

/**
 * A `Paren` term in an at-rule prelude query condition attaches to the
 * preceding identifier as a function-call form (`url-prefix()`, `regexp("x")`)
 * with NO separating space. A logical query keyword (`not`/`and`/`or`/`only`)
 * before a parenthesized group keeps its space (`not (min-width: 5px)`).
 */
describe('QueryCondition paren attachment', () => {
  const render = async (prelude: any): Promise<string> => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = atrule({
      name: '@document',
      prelude,
      rules: rules([decl({ name: 'color', value: color('red') })]).rules
    });
    const evald = await node.eval(context);
    return String(await evald.render(context, buffer));
  };

  it('attaches an empty paren to a function-name keyword with no space', async () => {
    const out = await render(query([keyword('url-prefix', { role: 'keyword' }), paren(undefined as any)]));
    expect(out).toContain('@document url-prefix() {');
  });

  it('attaches a non-empty paren to a function-name keyword with no space', async () => {
    const out = await render(query([
      keyword('url-prefix', { role: 'keyword' }),
      paren(quoted('x', { quote: '"' }))
    ]));
    expect(out).toContain('@document url-prefix("x") {');
  });

  it('keeps the space between a logical query keyword and a parenthesized group', async () => {
    const out = await render(query([
      keyword('not', { role: 'keyword' }),
      paren(decl({ name: 'min-width', value: keyword('5px', { role: 'keyword' }) }))
    ]));
    expect(out).toContain('@document not (min-width: 5px) {');
  });
});
