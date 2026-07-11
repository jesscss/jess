import { describe, expect, it } from 'vitest';
import { Parser } from '../../../../less-parser/src/index.js';
import { Context } from '../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../util/render-buffer.js';
import { resolveSpineMixinCall } from '../util/emit-walk.js';
import type { Rules } from '../rules.js';
import type { Node } from '../node.js';

/**
 * P4 Fold 3a — a top-level mixin call whose ONLY candidate's guard FAILS (no passing
 * candidate) folds to ZERO surfaces on the spine (emit nothing) instead of taking the
 * eval terminal. The legitimate-empty vs genuine-error distinction is made upstream:
 * a call to a name with NO arity-matching candidate throws "No matching mixins found"
 * before any guard runs, and that throw MUST still propagate (never swallowed to empty).
 */
async function render(source: string): Promise<string> {
  const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
  const { tree } = new Parser().parse(source);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const root = tree as unknown as Rules;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return (await renderNodeToString(root as unknown as RenderBufferNode, context, { context })).trim();
}

describe('P4 Fold 3a — guard-fail mixin call folds to empty; undefined mixin still throws', () => {
  it('a top-level call whose only candidate fails its guard renders nothing (bug-100cm-1m shape)', async () => {
    const css = await render(
      `.bug-100cm-1m(@a) when (@a = 1) {\n  .failed {\n    one-hundred: not-equal-to-1;\n  }\n}\n.bug-100cm-1m(100cm);`
    );
    expect(css).toBe('');
  });

  it('resolveSpineMixinCall returns a zero-surface FOLD for the guard-fail call (no eval terminal)', async () => {
    const context = new Context({ output: { collapseNesting: false }, leakyScope: true });
    const { tree } = new Parser().parse(
      `.bug-100cm-1m(@a) when (@a = 1) {\n  .failed {\n    one-hundred: not-equal-to-1;\n  }\n}\n.bug-100cm-1m(100cm);`
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const root = tree as unknown as Rules;
    context.root = root;
    context.rulesContext = root;
    // The last statement is the failing call.
    const call = root.rules[root.rules.length - 1] as unknown as Node;
    const resolution = await Promise.resolve(resolveSpineMixinCall(call, context));
    expect(resolution.kind).toBe('fold');
    if (resolution.kind === 'fold') {
      expect(resolution.surfaces).toEqual([]);
    }
  });

  it('a guard that PASSES still emits the body (does not fold to empty)', async () => {
    const css = await render(
      `.bug-100cm-1m(@a) when (@a = 1) {\n  .ok {\n    matched: yes;\n  }\n}\n.bug-100cm-1m(1);`
    );
    expect(css).toBe('.ok {\n  matched: yes;\n}');
  });

  it('a call to a truly-undefined mixin still THROWS "No matching mixins" (error not swallowed)', async () => {
    await expect(render(`.totally-undefined-mixin();`)).rejects.toThrow(/No matching mixins/);
  });

  it('a call whose arity matches NO candidate still THROWS (arity mismatch is an error, not empty)', async () => {
    await expect(
      render(`.only-zero-arity() {\n  a: b;\n}\n.only-zero-arity(1, 2, 3);`)
    ).rejects.toThrow(/No matching mixins/);
  });
});
