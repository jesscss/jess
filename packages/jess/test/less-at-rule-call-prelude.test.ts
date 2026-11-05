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

  it.each([
    ['(@{x})', '(y)'],
    ['("@{x}")', '("y")'],
    ['(@{x} a)', '(y a)'],
    ['(url(@{x}))', '(url(y))'],
    ['(@{x}) b', '(y) b'],
    ['(@{x}) @{x}', '(y) y']
  ])('evaluates `@{…}` in the group: %s', async (prelude, emitted) => {
    expect(await render(`@x: y; @foo ${prelude} { c: d; }`)).toContain(`@foo ${emitted}`);
    expect(await render(`@x: y; @foo z ${prelude} { c: d; }`)).toContain(`@foo z ${emitted}`);
  });

  it.each(['@foo (@{x}, b)', '@foo (@{x}; b)', '@foo (@{x})(b)', '@foo.bar (@{x})', '@foo (@a: @{x})'])(
    'stays an error rather than print `@{…}` unresolved: %s',
    async (head) => {
      await expect(render(`@x: y; ${head} { c: d; }`)).rejects.toThrow();
    }
  );

  it.fails.each([
    ['@foo (a @{x})', '@foo (a y)'],
    ['@foo (a: @{x})', '@foo (a: y)'],
    ['@scope (.@{x})', '@scope (.y)']
  ])('evaluates `@{…}` where the generic route keeps it as text: %s', async (head, emitted) => {
    expect(await render(`@x: y; ${head} { c { d: e; } }`)).toContain(emitted);
  });

  it('reads `@{…}` in a call\'s argument as a call, with a call\'s errors', async () => {
    await expect(render('@x: y; @foo (@{x});')).rejects.toThrow(/Name not found/);
    await expect(render('@x: y; @foo: { a: b }; .q { @foo (@{x}); }')).rejects.toThrow(/wrong arity/);
  });

  it('still calls a detached ruleset', async () => {
    expect(await render('@d: { c: d; }; .a { @d(); }')).toBe('.a {\n  c: d;\n}\n');
    expect(await render('@d: { c: d; }; .a { @d() }')).toBe('.a {\n  c: d;\n}\n');
  });
});
