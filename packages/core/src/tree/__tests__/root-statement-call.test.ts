import { beforeEach, describe, expect, it } from 'vitest';
import { any, call, jsfunc, list, quoted, rules } from '../index.js';
import { Context } from '../../context.js';

/**
 * Regression: a root-position Call whose eval yields a bare value node (e.g.
 * Less `e('/* … *​/')` / unquote at statement position) must be statement-legal
 * and render its evaluated value — not abort the whole render with
 * `eval/invalid-statement`.
 *
 * @see check-valid-nodes.ts
 */
describe('root-position call whose eval yields a value', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('renders the evaluated value instead of throwing eval/invalid-statement', async () => {
    /*
     * A Call at root position whose name resolves to a function returning a bare
     * value node (an `Any`, no F_ALLOW_ROOT) — the shape Less produces for
     * `e('/* anything to unquote *\/');` at the top level.
     */
    const root = rules([
      call({
        name: jsfunc({
          name: 'e',
          fn: () => any('/* anything to unquote */')
        }),
        args: list([quoted('/* anything to unquote */')])
      })
    ]);
    context.root = root;
    context.rulesContext = root;

    const rendered = await Promise.resolve(root.render(context));
    expect(rendered).toContain('/* anything to unquote */');
  });
});
