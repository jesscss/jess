import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

// End-to-end (parse + eval + serialize) regression for composing an EXPLICIT
// `calc(@x)` (where `@x` is itself a preserved calc such as `calc(100% * 100%)`)
// with a further operation.
//
// Before the fix the explicit calc collapsed to an Any string node, so:
//  - `calc(@x)`      rendered a redundant paren: `calc((100% * 100%))`
//  - `calc(@x) + 1`  dropped the operator:        `calc((100% * 100%))1`
//  - `calc(@x) * 2`  threw "Cannot operate on Any"
// It must instead stay a single well-formed calc that keeps the operator.
const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });

async function value(decl: string): Promise<string> {
  const css = await compiler.renderString(
    `.t { @a: 100%; @x: @a * @a; ${decl} }`,
    { language: 'less' }
  );
  const text = typeof css === 'string' ? css : (css as { css: string }).css;
  return text.replace(/\s+/g, ' ').trim();
}

describe('explicit calc compose', () => {
  it('keeps an explicit calc wrapping a preserved calc flat (no double paren)', async () => {
    expect(await value('v: calc(@x);')).toBe('.t { v: calc(100% * 100%); }');
  });

  it('keeps the operator composing an explicit calc with an addition', async () => {
    expect(await value('v: calc(@x) + 1;')).toBe('.t { v: calc(100% * 100% + 1); }');
  });

  it('composes an explicit calc with a multiplication without crashing', async () => {
    expect(await value('v: calc(@x) * 2;')).toBe('.t { v: calc(100% * 100% * 2); }');
  });

  it('composes an explicit calc with a variable operand', async () => {
    expect(await value('v: calc(@x) + @a;')).toBe('.t { v: calc(100% * 100% + 100%); }');
  });

  it('still evaluates the implicit preserved-calc compose path', async () => {
    expect(await value('v: @x + 1;')).toBe('.t { v: calc(100% * 100% + 1); }');
  });
});
