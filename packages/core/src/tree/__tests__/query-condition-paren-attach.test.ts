import { describe, expect, it } from 'vitest';
import { Context } from '../../context.js';
import { atrule, query, paren, keyword, quoted, decl, rules, ruleset, sel, el, vardecl, spaced, ref, color } from '../index.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';

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
    const out = await render(query([keyword('url-prefix', { role: 'keyword' }), paren()]));
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

  it('keeps the space before a paren after a bare number (not a function name)', async () => {
    /*
     * `@unknown foo 42 (bar)` — `42` is not a function-name identifier, so the
     * paren must NOT attach. Regression guard for the eval class-preservation +
     * function-name check: a QueryCondition whose value changes on eval must stay
     * a QueryCondition (not degrade to a base Sequence) AND must not attach a paren
     * to a numeric token.
     */
    const out = await render(query([
      keyword('foo', { role: 'keyword' }),
      keyword('42', { role: 'keyword' }),
      paren(query([keyword('bar', { role: 'keyword' })]))
    ]));
    expect(out).toContain('@document foo 42 (bar) {');
  });
});

/**
 * `QueryCondition extends Sequence`. When eval CHANGES a child, `Sequence` rebuilds
 * the value — and used to rebuild it as a base `Sequence`, dropping the
 * query-condition function-attach writer (regressing `url-prefix(@v)` to
 * `url-prefix (@v)`). This guards that the concrete class survives a value-changing
 * eval by resolving a variable inside the paren.
 */
describe('QueryCondition survives value-changing eval', () => {
  it('keeps url-prefix() attached after resolving a variable in the paren', async () => {
    const context = new Context({});
    const node = rules([
      ruleset({
        selector: sel([el('.host')]),
        rules: [
          vardecl({ name: 'u', value: spaced([el('site')]) }),
          atrule({
            name: '@document',
            prelude: query([
              keyword('url-prefix', { role: 'keyword' }),
              paren(ref({ key: 'u' }, { type: 'variable' }))
            ]),
            rules: [decl({ name: 'color', value: color('red') })]
          })
        ]
      })
    ]);
    const css = await renderNodeToString(node, context);
    expect(css).toContain('@document url-prefix(site)');
    expect(css).not.toContain('url-prefix (');
  });
});
