import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const bsRoot = path.resolve(
  __dirname,
  '../../../../node_modules/.pnpm/bootstrap-less-port@2.5.1_less@3.13.1/node_modules/bootstrap-less-port/less'
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
    // Sanity: responsive grid + breakpoint custom properties are present.
    expect(css).toContain('--breakpoint-sm:576px');
    expect(css).toMatch(/\.col-sm-/);
    expect(css).toContain('.container-lg');
  }, 120000);
});
