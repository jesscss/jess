/**
 * The Less config shape carries `compress` as `language.less.compress` (not
 * `output.compress`). jess must honor it so a less.js-style config — and the
 * corpus's `tests-config/*compress*` fixtures — minify. `output.compress` still
 * wins when both are present.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const render = async (opts: Record<string, unknown>): Promise<string> => {
  const c = new Compiler({ ...opts, compile: { plugins: [lessPlugin()] } } as never);
  return (await c.renderToResult({ source: '.a { color: red; margin: 0px; }', language: 'less', extension: '.less' }, {})).css.trim();
};

describe('language.less.compress maps to the compress option', () => {
  it('language.less.compress: true minifies', async () => {
    expect(await render({ language: { less: { compress: true } } })).toBe('.a{color:red;margin:0px}');
  });
  it('no compress → pretty', async () => {
    expect(await render({ output: { collapseNesting: true } })).toBe('.a {\n  color: red;\n  margin: 0px;\n}');
  });
  it('output.compress wins when both set', async () => {
    expect(await render({ output: { compress: false }, language: { less: { compress: true } } })).toBe('.a {\n  color: red;\n  margin: 0px;\n}');
  });
});
