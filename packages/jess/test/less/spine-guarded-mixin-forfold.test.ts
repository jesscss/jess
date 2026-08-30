import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Ratchet locks for two spine-render fixes surfaced by bootstrap.less:
 *
 *  1. LOOP-FOLD via import/root splice (`Rules._emitSpineForFold`). A `$for`/`each`
 *     loop reaching the ROOT / import-splice emitter (`_emitRulesBody`'s `emitNode`)
 *     — e.g. a loop inside an imported file — used to fall to the `isChildRules`
 *     branch, which emitted the loop body ONCE, UNBOUND: a nested ruleset's
 *     interpolated selector (`.x-@{k}`) then resolved the loop variable against a
 *     frame that never bound it (`'k' is not defined`). Now it folds into
 *     per-iteration bound surfaces, byte-identical to eval.
 *
 *  2. GUARD-EVAL print-state isolation (`serializeSpineFrameContainer`). A `when`
 *     guard whose operands render nested values (a function call / a local var whose
 *     binding is a call) reset `context.printState` in place mid-descent, swapping
 *     the live emit writer; a PASSING guard then dropped its whole body into the
 *     discarded writer (bootstrap RFS `#font-size`). Now the guard eval is isolated,
 *     so a passing guard leaves the writer byte-identical for the body descent.
 *
 * Both assert spine output === eval output (the oracle) for a minimal shape.
 */

let tmpDir: string;

function makeCompiler(root: string) {
  return new Compiler({
    compile: {
      plugins: [
        lessPlugin(),
        jsPlugin({ jsReadRoot: root, runtimeApi: 'less' }),
        lessCompatPlugin()
      ]
    }
  });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-spine-lock-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('spine loop-fold via import splice', () => {
  it('folds an each() with an interpolated selector inside an imported body', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'loop-lib.less'),
      [
        '#mixin(@c) { color: @c; }',
        'each(@map, #(@value, @key) {',
        '  .item-@{key} {',
        '    #mixin(@key);',
        '  }',
        '});'
      ].join('\n')
    );
    const entry = path.join(tmpDir, 'loop-entry.less');
    fs.writeFileSync(
      entry,
      ['@map: { primary: 1; secondary: 2; };', '@import "loop-lib";'].join('\n')
    );

    const css = await makeCompiler(tmpDir).render(entry, {
      suppressWarnings: true,
      breakOnError: false
    });
    // Byte-identical to less@4 / eval: one bound ruleset per iteration, the loop
    // key resolved in BOTH the interpolated selector and the mixin arg.
    expect(css).toContain('.item-primary');
    expect(css).toContain('.item-secondary');
    expect(css).toContain('color: primary');
    expect(css).toContain('color: secondary');
    expect(css).not.toContain('is not defined');
  });
});

describe('spine import eval-fallback print-state isolation', () => {
  it('does not drop a later import when an earlier import evals a detached-ruleset-arg mixin', async () => {
    // A mixin call with a DETACHED-RULESET arg (`#hover({…})`) is deferred to eval;
    // when its enclosing imported body is not spine-foldable it renders via the
    // import eval-fallback, which used to reset context.printState in place and drop
    // every LATER sibling/import (bootstrap: `_reboot`'s `a { #hover({…}) }` dropped
    // the entire following `_grid`). The eval-fallback is now print-state-isolated.
    fs.writeFileSync(
      path.join(tmpDir, 'ef-hover-lib.less'),
      '#hover(@content) { &:hover { @content(); } }'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'ef-hover-use.less'),
      ['a {', '  color: blue;', '  #hover({ color: red; });', '}'].join('\n')
    );
    fs.writeFileSync(
      path.join(tmpDir, 'ef-later.less'),
      ['.later-block {', '  display: flex;', '}'].join('\n')
    );
    const entry = path.join(tmpDir, 'ef-entry.less');
    fs.writeFileSync(
      entry,
      ['@import "ef-hover-lib";', '@import "ef-hover-use";', '@import "ef-later";'].join('\n')
    );

    const css = await makeCompiler(tmpDir).render(entry, {
      suppressWarnings: true,
      breakOnError: false
    });
    // The hover block AND the following import must both survive.
    expect(css).toContain('&:hover');
    expect(css).toContain('.later-block');
    expect(css).toContain('display: flex');
  });
});

describe('spine loop-generated extend through import', () => {
  it('merges a loop-generated :extend from an imported body into a static target group', async () => {
    // `engageExtendLayer` scans only the parsed entry root; an import-only document has no direct
    // `:extend`, so imported extends were dropped. AND a loop body carrying an `:extend` was rejected
    // for folding, forcing the imported body onto the eval fallback (which ignores spine extend
    // headers). The extend layer now engages when an imported body has an extend, and the gather
    // expands `$for`/`each` loops to materialize per-iteration interpolated extenders — so a loop-
    // generated `:extend` merges into its (static) target group (bootstrap grid `.container-lg`).
    fs.writeFileSync(
      path.join(tmpDir, 'ext-lib.less'),
      [
        '@sizes: { sm: 540px; lg: 960px; };',
        '.container, .container-fluid { width: 100%; }',
        'each(@sizes, #(@v, @k) {',
        '  .container-@{k} { &:extend(.container-fluid all); }',
        '});'
      ].join('\n')
    );
    const entry = path.join(tmpDir, 'ext-entry.less');
    fs.writeFileSync(entry, '@import "ext-lib";');

    const css = await makeCompiler(tmpDir).render(entry, {
      suppressWarnings: true,
      breakOnError: false
    });
    // The loop-generated extenders merge into the `.container, .container-fluid` group.
    expect(css).toContain('.container-sm');
    expect(css).toContain('.container-lg');
    // A single merged rule, not standalone empty extender blocks.
    expect(css).toMatch(/\.container,\s*\.container-fluid,\s*\.container-sm,\s*\.container-lg/);
  });
});

describe('spine guarded-mixin print-state isolation', () => {
  it('emits a passing compound-guard block from a nested folded mixin body', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'guard-lib.less'),
      [
        '#rfs(@fs) {',
        '  @u: get-unit(@fs);',
        '  & when (not (@u = px) and not (@u = rem)) {',
        '    font-size: @fs;',
        '  }',
        '}',
        '#fs(@fs) { & when not (@fs = ~"") { #rfs(@fs); } }'
      ].join('\n')
    );
    const entry = path.join(tmpDir, 'guard-entry.less');
    fs.writeFileSync(
      entry,
      [
        '@import "guard-lib";',
        'pre {',
        '  code {',
        '    #fs(inherit);',
        '    color: inherit;',
        '  }',
        '}'
      ].join('\n')
    );

    const css = await makeCompiler(tmpDir).render(entry, {
      suppressWarnings: true,
      breakOnError: false
    });
    // The passing compound guard's body MUST survive (was silently dropped).
    expect(css).toContain('font-size: inherit');
    expect(css).toContain('color: inherit');
  });
});
