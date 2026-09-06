import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';

const scss = (src: string): Promise<string> =>
  new Compiler().renderString(src, { extension: '.scss' });

/**
 * A bare `$x:` inside a control-flow block body reassigns the nearest existing
 * binding (falling back to a block-local shadow), so `@for`/`@each`/`@while`
 * accumulators round-trip the way dart-sass evaluates them. Before this, the
 * declaration re-shadowed locally each iteration and the outer binding never
 * changed: `@for`/`@each` emitted `0` and `@while` never terminated.
 */
describe('SCSS control-flow variable reassignment', () => {
  it('@for accumulator adds each value into the outer binding', async () => {
    const css = await scss('$i: 0;\n@for $x from 1 through 3 { $i: $i + $x; }\n.a { width: $i; }');
    expect(css).toContain('width: 6');
  });

  it('@each accumulator adds each list value into the outer binding', async () => {
    const css = await scss('$s: 0;\n@each $x in 1, 2, 3 { $s: $s + $x; }\n.a { width: $s; }');
    expect(css).toContain('width: 6');
  });

  it('@while counter terminates because the condition reads the reassigned value', async () => {
    const css = await scss('$i: 0;\n@while $i < 3 { $i: $i + 1; }\n.a { width: $i; }');
    expect(css).toContain('width: 3');
  });

  it('reassigns through @if inside a loop', async () => {
    const css = await scss('$n: 0;\n@for $x from 1 through 4 { @if $x > 2 { $n: $n + $x; } }\n.a { width: $n; }');
    expect(css).toContain('width: 7');
  });

  it('a variable born inside the loop stays block-local (does not leak after it)', async () => {
    const css = await scss('@for $x from 1 through 2 { $tmp: $x; }\n.a { width: 5px; }');
    expect(css).toContain('width: 5px');
  });

  it('a `$x:` in a ruleset nested inside a loop is a normal local declaration', async () => {
    const css = await scss('$c: red;\n@for $x from 1 through 1 { .a { $c: blue; color: $c; } }\n.b { color: $c; }');
    expect(css).toContain('color: blue');
    expect(css).toContain('color: red');
  });
});
