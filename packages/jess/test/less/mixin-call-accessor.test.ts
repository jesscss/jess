import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

async function render(src: string): Promise<{ css: string; rej: any[] }> {
  const rej: any[] = [];
  const onRej = (r: any) => rej.push(r);
  process.on('unhandledRejection', onRej);
  const tmp = path.join(os.tmpdir(), `mca_${Math.random().toString(36).slice(2)}.less`);
  fs.writeFileSync(tmp, src);
  let css = '';
  try {
    css = await new Compiler({ compile: { plugins: [lessPlugin(), lessCompatPlugin()] } })
      .render(tmp, { suppressWarnings: true, breakOnError: false });
    await new Promise(r => setTimeout(r, 200));
  } finally { process.off('unhandledRejection', onRej); fs.unlinkSync(tmp); }
  return { css, rej };
}

describe('mixin call empty accessor', () => {
  // `#m()[]` reads the mixin's return value via the empty ("last", index -1)
  // accessor. Regression: the -1 key was dispatched as a *variable* lookup and
  // failed with `'-1' is not defined`. It must be an *index* lookup.
  it('single-candidate #m()[] and [@return]', async () => {
    const { css, rej } = await render(`
#m(@x) { @return: (@x + 1); }
.a {
  v1: #m(5)[@return];
  v2: #m(5)[];
}
`);
    expect(rej).toHaveLength(0);
    expect(css).toContain('v1: 6;');
    expect(css).toContain('v2: 6;');
  }, 30000);

  it('multi-candidate (overloaded) #m()[] resolves the matched return', async () => {
    const { css, rej } = await render(`
@unit: px;
.a {
  #mq-value(px)  { @return: 2px; }
  #mq-value(rem) { @return: 1rem; }
  #mq-value(@_) when (default()) { @return: ~""; }
  @mq-value: #mq-value(@unit)[];
  out: @mq-value;
}
`);
    expect(rej).toHaveLength(0);
    expect(css).toContain('out: 2px;');
  }, 30000);
});
