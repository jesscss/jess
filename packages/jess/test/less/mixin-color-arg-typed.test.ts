/**
 * A Color produced by evaluating a mixin argument (`rgba(0,0,0,.5)`, or a variable
 * chain ending in one) must reach the mixin body as a TYPED color, so a nested
 * color function in the body (`darken`/`fade`/`lighten`) can operate on it.
 *
 * Regression: such args were snapshotted to eager bytes ("rgba(0, 0, 0, 0.5)")
 * that no longer re-parse as a color literal, so the body's `darken(@arg)` was
 * preserved verbatim instead of evaluating. Literal color/dimension args already
 * bound by reference and were unaffected; only evaluated (function-call) colors
 * lost their type. Oracle: lessc 4.x evaluates these fully.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compile = async (source: string): Promise<string> => {
  const c = new Compiler({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin()] } });
  return (await c.renderToResult({ source, language: 'less', extension: '.less' }, {})).css.trim();
};

describe('evaluated color mixin-arg stays typed across the call boundary', () => {
  it('darken of a literal rgba arg evaluates', async () => {
    const css = await compile('#v(@bg) { c: darken(@bg, 5%); }\n.a { #v(rgba(0,0,0,0.5)); }');
    expect(css).toBe('.a {\n  c: rgba(0, 0, 0, 0.5);\n}');
  });
  it('darken of a variable-chain rgba arg evaluates', async () => {
    const css = await compile('@thb: rgba(0,0,0,0.5);\n#v(@bg) { c: darken(@bg, 5%); }\n.a { #v(@thb); }');
    expect(css).toBe('.a {\n  c: rgba(0, 0, 0, 0.5);\n}');
  });
  it('fade visibly changes the alpha (typed processing, not passthrough)', async () => {
    const css = await compile('#v(@bg) { c: fade(@bg, 20%); }\n.a { #v(rgba(255,0,0,0.5)); }');
    expect(css).toBe('.a {\n  c: rgba(255, 0, 0, 0.2);\n}');
  });
});
