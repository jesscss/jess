/**
 * append-extend-fold.test.ts — ratchet for the COMPOUND / NESTED / DESCENDANT ampersand-append ×
 * extend fold on the spine.
 * ====================================================================================================
 *
 * An `:extend` targeting an ampersand-append-generated selector (`.x { &-a.foo {} }` +
 * `.t:extend(.x-a.foo)`) fires NOTHING in less@4/v5 (an append-generated selector is not an
 * addressable extend subject) — so the correct output is the authored append block plus the
 * extender as a separate inert rule. `wireSpineExtends` installs no header override for such a
 * target; the append block emits its authored composed form. The append × extend GATE
 * (`treeHasUnfoldableAmpersandAppend`) previously bailed the WHOLE tree (→ eval, now a
 * SPINE_ONLY_UNSUPPORTED throw under the D-EVAL flip) for every append shape richer than the pure
 * `&-suffix`. It now admits any append that is a SINGLE-`&` append under a simple string-appendable
 * parent chain — the shapes whose authored-append emit is spine-correct: a compound `&-a.foo`, a
 * pseudo compound `&-a:hover`, a descendant `&-a .foo`, and nested chains `.a { &-b { &-c } }`.
 *
 * A shape whose authored-append emit the spine mis-composes STILL bails loud (never silent wrong
 * output): a MULTI-branch list (`&-h, &-f` → the spine drops the suffix), a DOUBLED `&` (`&&-active`
 * → suffix doubled), a COMBINATOR-with-two-`&` (`& + &-active`), or an append under a COMPOUND
 * parent (`.x.y { &-a }` → the append throws). Those keep throwing SPINE_ONLY_UNSUPPORTED until the
 * emit-layer append composition folds them too (a separate follow-on).
 *
 * All folded expectations are byte-verified against less@4 (the append emit + the inert extend).
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { Rules, spineRenderCounter } from '@jesscss/core';

const mkCompiler = () => new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin(), lessCompatPlugin({ plugins: [] })] }
});

async function renderFold(name: string, src: string): Promise<{ css: string; errors: number; deriveCalls: number; spineMoved: boolean }> {
  const orig = Rules.prototype.derive;
  let deriveCalls = 0;
  Rules.prototype.derive = function patched(this: Rules, ...args: Parameters<Rules['derive']>) {
    deriveCalls++;
    return orig.apply(this, args);
  } as Rules['derive'];
  const before = spineRenderCounter.rootRenders;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'append-fold-'));
    const fp = join(dir, `${name}.less`);
    writeFileSync(fp, src);
    const result = await mkCompiler().renderToResult(fp);
    const errors = (result as unknown as { errors?: unknown[] }).errors?.length ?? 0;
    return { css: result.css, errors, deriveCalls, spineMoved: spineRenderCounter.rootRenders > before };
  } finally {
    Rules.prototype.derive = orig;
  }
}

// byte-identical to less@4 (append emit + inert extend). Extender stays a separate rule.
const FOLDS: Array<{ name: string; src: string; expected: string }> = [
  {
    name: 'pure-suffix',
    src: `.button { &-primary { color: red; } }\n.theme:extend(.button-primary) { x: 1; }`,
    expected: `.button-primary {\n  color: red;\n}\n.theme {\n  x: 1;\n}\n`
  },
  {
    name: 'compound-append',
    src: `.x { &-a.foo { color: red; } }\n.t:extend(.x-a.foo) { x: 1; }`,
    expected: `.x-a.foo {\n  color: red;\n}\n.t {\n  x: 1;\n}\n`
  },
  {
    name: 'compound-pseudo',
    src: `.x { &-a:hover { color: red; } }\n.t:extend(.x-a:hover) { x: 1; }`,
    expected: `.x-a:hover {\n  color: red;\n}\n.t {\n  x: 1;\n}\n`
  },
  {
    name: 'descendant-append',
    src: `.x { &-a .foo { color: red; } }\n.t:extend(.x-a .foo) { x: 1; }`,
    expected: `.x-a .foo {\n  color: red;\n}\n.t {\n  x: 1;\n}\n`
  },
  {
    name: 'nested-append-chain',
    src: `.a { &-b { &-c { color: red; } } }\n.t:extend(.a-b-c) { x: 1; }`,
    expected: `.a-b-c {\n  color: red;\n}\n.t {\n  x: 1;\n}\n`
  }
];

// Shapes whose authored-append emit the spine cannot yet build correctly — must bail LOUD.
const BAILS: Array<{ name: string; src: string }> = [
  { name: 'list-branches', src: `.x { &-header, &-footer { color: red; } }\n.t:extend(.x-footer) { x: 1; }` },
  { name: 'doubled-ampersand', src: `.x { &&-active { color: red; } }\n.t:extend(.x.x-active) { x: 1; }` },
  { name: 'combinator-two-amp', src: `.x { & + &-active { color: red; } }\n.t:extend(.x + .x-active) { x: 1; }` },
  { name: 'compound-parent', src: `.x.y { &-a.foo { color: red; } }\n.t:extend(.x.y-a.foo) { x: 1; }` }
];

describe('append × extend fold (spine)', () => {
  for (const { name, src, expected } of FOLDS) {
    it(`FOLDS byte-identical (deriveCalls=0): ${name}`, async () => {
      const r = await renderFold(name, src);
      expect(r.errors).toBe(0);
      expect(r.spineMoved).toBe(true);
      expect(r.deriveCalls).toBe(0);
      expect(r.css).toBe(expected);
    });
  }

  for (const { name, src } of BAILS) {
    it(`BAILS loud — no silent wrong output (spine cannot compose the append emit): ${name}`, async () => {
      const r = await renderFold(name, src);
      // The unfoldable append × extend tree fails LOUD (SPINE_ONLY_UNSUPPORTED recorded on the
      // result, empty CSS) rather than emitting a mis-composed selector.
      expect(r.errors).toBeGreaterThan(0);
      expect(r.css).toBe('');
    });
  }
});
