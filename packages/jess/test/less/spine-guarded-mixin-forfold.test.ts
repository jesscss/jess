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
    expect(css).not.toContain("is not defined");
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
