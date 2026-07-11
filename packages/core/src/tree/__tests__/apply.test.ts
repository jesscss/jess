import { describe, it, expect, beforeEach } from 'vitest';
import { rules, ruleset, decl, mixin, apply, sel, el, spaced, resolveRulesetBySelector } from '../index.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';

// D-EVAL FLIP: the spine is the sole TOP-LEVEL render path but does not fold these
// non-eligible root shapes. They render through the RETAINED eval + serialize path —
// reached by supplying a no-op `preSerializeRoot` visitor (the retained post-eval
// render entry) — byte-identical to the pre-flip top-level render (via eval).
const renderRoot = (root: ReturnType<typeof rules>, ctx: Context): Promise<string> =>
  Promise.resolve(renderNodeToString(root, ctx, { context: ctx, preSerializeRoot: r => r }));

import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';

/**
 * `$apply <selector-list>` merges the matched rulesets' bodies into the current
 * rule. Semantics (user-specified): apply ONLY plain Rulesets (`.foo {}`), matched
 * on the whole selector, merge in ALL matching blocks; parametric Mixins
 * (`.foo() {}`) are never applied — `$apply` does not touch the callable machinery.
 */
describe('Apply ($apply)', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  it('merges a ruleset body into the current rule', async () => {
    const node = rules([
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      ruleset({ selector: sel([el('.card')]), rules: [apply([el('.foo')])] })
    ]);

    const css = await renderRoot(node, context);

    expect(css).toContain('.card {');
    expect(css).toContain('color: red');
  });

  it('merges ALL matching `.foo {}` blocks (merge-all)', async () => {
    const node = rules([
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'background', value: spaced([el('blue')]) })] }),
      ruleset({ selector: sel([el('.card')]), rules: [apply([el('.foo')])] })
    ]);

    const css = await renderRoot(node, context);

    // The .card block carries both applied declarations.
    const cardBlock = css.slice(css.indexOf('.card {'));
    expect(cardBlock).toContain('color: red');
    expect(cardBlock).toContain('background: blue');
  });

  it('does NOT apply a parametric mixin (`.foo() {}`)', async () => {
    const node = rules([
      mixin({ name: '.foo', rules: [decl({ name: 'color', value: spaced([el('green')]) })] }),
      ruleset({ selector: sel([el('.card')]), rules: [apply([el('.foo')])] })
    ]);

    const css = await renderRoot(node, context);

    // The mixin body must not leak into .card.
    expect(css).not.toContain('green');
  });

  it('applies a plain ruleset even when a same-named mixin also exists', async () => {
    const node = rules([
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      mixin({ name: '.foo', rules: [decl({ name: 'color', value: spaced([el('green')]) })] }),
      ruleset({ selector: sel([el('.card')]), rules: [apply([el('.foo')])] })
    ]);

    const css = await renderRoot(node, context);

    const cardBlock = css.slice(css.indexOf('.card {'));
    expect(cardBlock).toContain('red');
    expect(cardBlock).not.toContain('green');
  });

  it('applies multiple selectors in one `$apply`', async () => {
    const node = rules([
      ruleset({ selector: sel([el('.a')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      ruleset({ selector: sel([el('.b')]), rules: [decl({ name: 'background', value: spaced([el('blue')]) })] }),
      ruleset({ selector: sel([el('.card')]), rules: [apply([el('.a'), el('.b')])] })
    ]);

    const css = await renderRoot(node, context);

    const cardBlock = css.slice(css.indexOf('.card {'));
    expect(cardBlock).toContain('color: red');
    expect(cardBlock).toContain('background: blue');
  });
});

describe('resolveRulesetBySelector (ruleset-only lookup)', () => {
  async function evalRoot(node: ReturnType<typeof rules>): Promise<{ context: Context; root: ReturnType<typeof rules> }> {
    const context = new Context();
    const evald = await node.eval(context);
    if (!isNode(evald, N.Rules)) {
      throw new Error('Expected Rules root');
    }
    context.root = evald;
    context.rulesContext = evald;
    return { context, root: evald };
  }

  it('returns every matching plain Ruleset (merge-all)', async () => {
    const { root } = await evalRoot(rules([
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('blue')]) })] })
    ]));

    const matches = resolveRulesetBySelector(el('.foo'), root);

    expect(matches.length).toBe(2);
    expect(matches.every(m => isNode(m, N.Ruleset))).toBe(true);
  });

  it('excludes parametric Mixins with the same name', async () => {
    const { root } = await evalRoot(rules([
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] }),
      mixin({ name: '.foo', rules: [decl({ name: 'color', value: spaced([el('green')]) })] })
    ]));

    const matches = resolveRulesetBySelector(el('.foo'), root);

    expect(matches.length).toBe(1);
    expect(isNode(matches[0], N.Ruleset)).toBe(true);
  });

  it('returns [] for a capture with no plain basic key (e.g. bare `*`)', async () => {
    const { root } = await evalRoot(rules([
      ruleset({ selector: sel([el('.foo')]), rules: [decl({ name: 'color', value: spaced([el('red')]) })] })
    ]));

    expect(resolveRulesetBySelector(el('*'), root)).toEqual([]);
  });
});
