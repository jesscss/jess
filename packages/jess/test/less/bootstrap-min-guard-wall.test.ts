import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Bootstrap wall-4 regression: `_mixins/_breakpoints.less` assigns a mixin-body
 * local `@min: breakpoint-min(...)` (an async plugin-js function) and reads it
 * in guards on two sibling nested `&` rules (`& when not (@min = ~"")` /
 * `& when (@min = ~"")`). The first guard's `@min` read starts the async value
 * eval and adds the `@min` binding to `context.searchScope` (the self-recursion
 * guard); before that promise resolved, the second sibling guard read `@min`
 * and — because the guard entry lingered across the await — was rejected as
 * `'min' is not defined`. The fix releases the recursion guard once the
 * SYNCHRONOUS eval span ends, so overlapping independent reads resolve normally.
 *
 * This asserts bootstrap render advances PAST the `min` wall. (It may hit a
 * later, unrelated wall — that is fine and expected for milestone-4 in progress;
 * we only guard against the `'min' is not defined` regression here.)
 */
const bsRoot = (() => {
  const candidates = [
    path.resolve(__dirname, '../../../../node_modules/bootstrap-less-port/less'),
    path.resolve(
      __dirname,
      '../../../../node_modules/.pnpm/bootstrap-less-port@2.5.1_less@3.13.1/node_modules/bootstrap-less-port/less'
    )
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
})();

describe('bootstrap @min-in-guard wall', () => {
  if (!bsRoot) {
    it.skip('bootstrap-less-port not found', () => {});
    return;
  }

  it('does not fail with "\'min\' is not defined"', async () => {
    const file = path.join(bsRoot, 'bootstrap.less');
    const compiler = new Compiler({
      compile: {
        plugins: [
          lessPlugin(),
          jsPlugin({ jsReadRoot: path.join(bsRoot, 'plugins'), runtimeApi: 'less' }),
          lessCompatPlugin()
        ]
      }
    });

    let error: unknown;
    let css = '';
    try {
      css = await compiler.render(file, { suppressWarnings: true, breakOnError: false });
    } catch (e) {
      error = e;
    }

    const message = error instanceof Error ? error.message : String(error ?? '');
    // Regression assertion: the min-in-guard wall must be gone.
    expect(message).not.toContain('\'min\' is not defined');
    // Either bootstrap now renders, or it stops at a later, different wall.
    expect(css.length > 0 || (message.length > 0 && !message.includes('\'min\' is not defined'))).toBe(true);
  }, 120000);
});
