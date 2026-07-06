/**
 * Regression: a variable defined in an `@import`ed file must resolve when
 * referenced from inside a NESTED mixin call (mixin-called-from-mixin), the
 * shape Bootstrap's `#font-size` -> `#rfs` chain uses to read the imported
 * `@enable-responsive-font-sizes`.
 *
 * The import puts the decl on the ROOT frame's fallback frame. The failing
 * lookup latched onto the innermost mixin-body frame's (empty) fallback and
 * never advanced to the root's fallback — first-fallback-wins shadowed every
 * outer import fallback. Fixed by queueing each parent frame's fallback in
 * `lookupScopeFrameVariable` (packages/core/src/tree/scope-frame.ts).
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('imported var visible through nested mixin call', () => {
  it('resolves an imported free var inside a nested mixin body under a guard', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'igs-'));
    fs.writeFileSync(path.join(dir, '_vars.less'), `@v: false;\n`);
    fs.writeFileSync(
      path.join(dir, '_mix.less'),
      `@import "_vars";
#inner(@fs) { x: @v; }
#outer(@fs) { & when not (@fs = ~"") { #inner(@fs); } }
`
    );
    fs.writeFileSync(
      path.join(dir, 'main.less'),
      `@import "_vars";\n@import "_mix";\n.out { #outer(3); }\n`
    );
    const compiler = new Compiler({
      compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
    });
    const css = await compiler.render(path.join(dir, 'main.less'), {
      suppressWarnings: true,
      breakOnError: false
    });
    expect(css).toContain('x: false');
  }, 30000);
});
