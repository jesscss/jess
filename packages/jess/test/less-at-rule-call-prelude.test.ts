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
    ['@foo (@a: @x) { c: d; }', '@foo (@a: @x)'],
    ['@foo ("a   b") { c: d; }', '@foo ("a   b")'],
    ['@foo (a // c\n b) { d: e; }', '@foo (a b)']
  ])('emits %s as written', async (source, prelude) => {
    expect(await render(source)).toContain(prelude);
  });

  it('evaluates `@{…}` after the group', async () => {
    expect(await render('@x: y; @foo (a) @{x} { c: d; }')).toContain('@foo (a) y');
    expect(await render('@x: y; @foo (a) b-@{x} { c: d; }')).toContain('@foo (a) b-y');
  });

  it.each([
    '@foo (@{x})',
    '@foo (@{x} 1 + 1)',
    '@foo ("@{x}" lighten(red, 10%))',
    '@foo (@{x}, b)',
    '@foo (@{x}...)',
    '@foo (a) b (@{x})',
    '@foo (a) "@{x}"',
    '@foo (a) url(@{x})',
    '@foo (a) fn(@{x})'
  ])('stays an error rather than print `@{…}` unresolved: %s', async (prelude) => {
    await expect(render(`@x: y; ${prelude} { c: d; }`)).rejects.toMatchObject({ code: expect.stringMatching(/^parse\//) });
  });

  it.fails.each([
    ['@foo (a @{x})', '@foo (a y)'],
    ['@foo (a: @{x})', '@foo (a: y)'],
    ['@scope (.@{x})', '@scope (.y)'],
    ['@foo z "@{x}"', '@foo z "y"'],
    ['@foo z (@{x}...)', '@foo z (y...)']
  ])('evaluates `@{…}` where the generic route keeps it as text: %s', async (head, emitted) => {
    expect(await render(`@x: y; ${head} { c { d: e; } }`)).toContain(emitted);
  });

  it('still calls a detached ruleset', async () => {
    expect(await render('@d: { c: d; }; .a { @d(); }')).toBe('.a {\n  c: d;\n}\n');
    expect(await render('@d: { c: d; }; .a { @d() }')).toBe('.a {\n  c: d;\n}\n');
  });

  it('ends a call at an at-keyword', async () => {
    const detached = '@d: { c: d; }; @b: { e: f; }; ';
    expect(await render(`${detached}.a { @d()\n@b(); }`)).toBe('.a {\n  c: d;\n  e: f;\n}\n');
    expect(await render(`${detached}.a { @d()\n@x: 1; g: @x; }`)).toBe('.a {\n  c: d;\n  g: 1;\n}\n');
    expect(await render(`${detached}.a { @d()\n@media (a) { g: h; } }`)).toBe('.a {\n  c: d;\n  @media (a) {\n    g: h;\n  }\n}\n');
  });

  it('reads anything else after the head as its prelude, with or without `;`', async () => {
    const atRule = '.a {\n  @d () color: red;\n}\n';
    expect(await render('@d: { c: d; }; .a { @d()\n  color: red\n}')).toBe(atRule);
    expect(await render('@d: { c: d; }; .a { @d()\n  color: red;\n}')).toBe(atRule);
    expect(await render('.x { @foo (a) b }')).toBe('.x {\n  @foo (a) b;\n}\n');
  });
});
