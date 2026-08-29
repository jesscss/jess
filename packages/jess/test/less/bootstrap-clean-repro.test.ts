import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { createRequire } from 'node:module';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/*
 * Resolve the installed package rather than a hardcoded `.pnpm` store path: a
 * patched dependency (see patches/bootstrap-less-port@2.5.1.patch) lives under a
 * `_patch_hash=…` store directory, so the fixed store name no longer exists.
 */
const requireFrom = createRequire(import.meta.url);
const bsRoot = path.join(
  path.dirname(requireFrom.resolve('bootstrap-less-port/package.json')),
  'less'
);
const bootstrapFile = path.join(bsRoot, 'bootstrap.less');

function makeCompiler() {
  return new Compiler({
    compile: {
      plugins: [
        lessPlugin(),
        jsPlugin({ jsReadRoot: bsRoot, runtimeApi: 'less' }),
        lessCompatPlugin()
      ]
    }
  });
}

describe('bootstrap clean render', () => {
  it('renders and collects rejections', async () => {
    const rejections: any[] = [];
    const onRej = (reason: any) => rejections.push(reason);
    process.on('unhandledRejection', onRej);

    const compiler = makeCompiler();
    const css = await compiler.render(bootstrapFile, {
      suppressWarnings: true,
      breakOnError: false
    });
    // let microtasks flush
    await new Promise(r => setTimeout(r, 500));
    process.off('unhandledRejection', onRej);

    const msgs: Record<string, number> = {};
    for (const r of rejections) {
      const m = (r && r.message) || String(r);
      msgs[m] = (msgs[m] || 0) + 1;
    }
    if (rejections.length) {
      console.log('Unexpected rejections:', JSON.stringify(msgs, null, 2));
      console.log('FIRST REJECTION STACK:\n', rejections[0]?.stack);
    }
    // Bootstrap must render to substantial CSS with ZERO swallowed rejections.
    expect(css.length).toBeGreaterThan(100000);
    expect(rejections).toHaveLength(0);

    /*
     * Sanity: responsive grid + breakpoint custom properties are present. The
     * default render is nested/expanded (not compressed), so the custom property
     * carries a space after the colon — byte-for-byte what lessc 4.x emits.
     */
    expect(css).toContain('--breakpoint-sm: 576px');
    expect(css).toMatch(/\.col-sm-/);
    expect(css).toContain('.container-lg');
  }, 120000);
});
