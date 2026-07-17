import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';

/**
 * ORACLE — per-declaration variable EXCLUSION + strict/optional resolution
 * (RESOLVER-SHAPE-SPEC). Before this, `ast/serialize.ts` resolved variables via a
 * collapsed last-wins `Map<name,value>` + a `MAX_VAR_DEPTH=64` cycle cap, so
 * `@a: 5; .x { @a: @a + 1; v: @a }` emitted `@a + 1` sixty-four times as garbage
 * instead of `6`. The fix: each frame holds the FULL source-ordered stack of a
 * name's declared value nodes, and while a declaration's value is being evaluated
 * that specific value node is EXCLUDED from the backward lookup walk — so a
 * self-reference falls back to an earlier same-name entry (or misses cleanly),
 * and a cycle terminates by construction with NO depth cap.
 *
 * Strict (default): a value-position miss is a hard `ReferenceError`. (Optional
 * mode — sentinel passthrough for structure-inspection / `isdefined` — is covered
 * by the `{ optional: true }` gate in the host byte-identity suites.)
 *
 * DEFERRED (not reachable through the Less-parser harness, and their write-model
 * machinery — `cells`/`reassign`/`propIndex`/param-frame split — is NOT built in
 * this pass): the `:=` / `!global` reassignment, `$!` live-binding, and
 * `$namespace.foo` member-access disambiguation cases in the spec's table.
 */
async function render(src: string): Promise<string> {
  const parsed = parseLessFn(src);
  const bridged = bridgeToAst(parsed.tree, src);
  return (await serialize(bridged, { evaluator: buildEvaluator() })).css;
}

describe('variable per-declaration exclusion (resolver correctness)', () => {
  it('last-wins fallback: @a:1; @a:@a+1 → 2', async () => {
    const css = await render('@a: 1;\n@a: @a + 1;\n.x { v: @a }\n');
    expect(css).toContain('v: 2');
    expect(css).not.toContain('@a');
  });

  it('inner scope falls back to outer entry: @a:5; .x{ @a:@a+1; v:@a } → 6', async () => {
    const css = await render('@a: 5;\n.x { @a: @a + 1; v: @a }\n');
    expect(css).toContain('v: 6');
    expect(css).not.toContain('@a');
  });

  it('forward reference / order-independence: .x{ color:@a } @a:red → red', async () => {
    const css = await render('.x { color: @a }\n@a: red;\n');
    expect(css).toContain('color: red');
  });

  it('deeper self-op still resolves once (no 64x garbage): @a:2px; @a:@a*2; w:@a → 4px', async () => {
    const css = await render('@a: 2px;\n@a: @a * 2;\n.x { w: @a }\n');
    expect(css).toContain('w: 4px');
    expect(css).not.toContain('@a');
  });

  it('self-cycle with no earlier entry → strict eval error: @a:@a+1', async () => {
    await expect(render('@a: @a + 1;\n.x { v: @a }\n')).rejects.toThrow(ReferenceError);
  });

  it('mutual cycle terminates by exclusion → strict eval error: @a:@b; @b:@a', async () => {
    await expect(render('@a: @b;\n@b: @a;\n.x { v: @a }\n')).rejects.toThrow(ReferenceError);
  });

  it('plain undefined variable → strict eval error (no @name passthrough)', async () => {
    await expect(render('.x { color: @nope }\n')).rejects.toThrow(ReferenceError);
  });
});
