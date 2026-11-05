import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * `@name (…)` followed by a block or more prelude is an at-rule, emitted with the
 * prelude the author wrote (ledger P2, P52).
 */
async function render(source: string): Promise<string> {
  return String(await new Compiler({ plugins: [lessPlugin()] }).renderString(source, { extension: '.less' }));
}

describe('Less: an at-rule whose prelude opens with a parenthesised group', () => {
  it.each([
    ['@-moz-whatever (foo: "(" bam ")") { bar: foo; }', '@-moz-whatever (foo: "(" bam ")")'],
    ['@-moz-document (a) { .b { c: d; } }', '@-moz-document (a)'],
    ['@foo (a) b { c: d; }', '@foo (a) b'],
    ['@foo (1 + 1) { c: d; }', '@foo (1 + 1)'],
    ['@foo (a: @x) { c: d; }', '@foo (a: @x)'],
    ['@keyframes (a) { from { c: d; } }', '@keyframes (a)']
  ])('emits %s as written', async (source, prelude) => {
    expect(await render(source)).toContain(prelude);
  });

  it('evaluates `@{…}` after the group', async () => {
    expect(await render('@x: y; @foo (a) @{x} { c: d; }')).toContain('@foo (a) y');
    expect(await render('@x: y; @foo (a) b-@{x} { c: d; }')).toContain('@foo (a) b-y');
  });

  it('still calls a detached ruleset', async () => {
    expect(await render('@d: { c: d; }; .a { @d(); }')).toBe('.a {\n  c: d;\n}\n');
    expect(await render('@d: { c: d; }; .a { @d() }')).toBe('.a {\n  c: d;\n}\n');
  });
});
