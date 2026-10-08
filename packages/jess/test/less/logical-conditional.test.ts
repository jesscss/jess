import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin()] }
});

const render = (less: string) => compiler.renderString(less, { language: 'less' });

describe('Less logical / conditional functions', () => {
  it('boolean() evaluates comparison / and / not / nested boolean', async () => {
    const css = await render(`#boolean {
  a: boolean(not(2 < 1));
  b: boolean(not(2 > 1) and (true));
  c: boolean(not(boolean(true)));
  f: boolean((2 > 1) = (3 > 2));
}`);
    expect(css).toBe(`#boolean {
  a: true;
  b: false;
  c: false;
  f: true;
}
`);
  });

  it('bare `not <operand>` negates, identical to the grouped `not(<operand>)`', async () => {
    /*
     * Regression: an unparenthesized `not false` was eaten by the argument-value
     * sequence as a two-keyword value and truthiness-tested (always false),
     * instead of routing to the condition grammar and negating. `not true`
     * happened to agree by accident; `not false` and the `if()` form did not.
     */
    const css = await render(`#bare-not {
  d: boolean(not false);
  e: boolean(not true);
  m: if(not false, 1, 2);
  n: if(not true, 1, 2);
}`);
    expect(css).toBe(`#bare-not {
  d: true;
  e: false;
  m: 1;
  n: 2;
}
`);
  });

  it('if() picks a value branch from a guard condition', async () => {
    const css = await render(`#if {
  a: if(not(false), 1, 2);
  b: if(not(true), 1, 2);
  e: if(not(true), 5);
  g: if(true, 3, 5);
  h: if(false, 3, 5);
  i: if(true and isnumber(6), 6, 8);
  j: if(not(true) and true, 6, 8);
  k: if(true or true, 1);
  @some: foo;
  l: if((iscolor(@some)), darken(@some, 10%), black);
}`);
    expect(css).toBe(`#if {
  a: 1;
  b: 2;
  e: ;
  g: 3;
  h: 5;
  i: 6;
  j: 8;
  k: 1;
  l: black;
}
`);
  });

  it('if() invokes detached-ruleset branches (true / false / void)', async () => {
    const css = await render(`#if {
  @rules: if(not(false), {c: 3}, {d: 4}); @rules();

  if((false), {g: 7}); /* results in void */

  @conditional: if((true), {
    color: green;
  }, {});
  @conditional();

  @falsey: if((false), {
    color: orange;
  }, {
    color: purple;
  });
  @falsey();
}`);
    expect(css).toBe(`#if {
  c: 3;
  /* results in void */
  color: green;
  color: purple;
}
`);
  });

  it('standalone not / and / or logical functions', async () => {
    const css = await render(`#t {
  a: not(true);
  b: and(true, false);
  c: or(false, true);
  d: not(false);
}`);
    expect(css).toBe(`#t {
  a: false;
  b: false;
  c: true;
  d: true;
}
`);
  });

  /*
   * A condition nothing consumes — here an argument of a CSS colour call, which
   * is written out as authored — is written with its variables substituted,
   * never as its source text (SETTLED — orchestrator judgment under owner
   * delegation 2026-10-07): `@a` in a written-out value is always its value.
   */
  it('writes a condition nothing consumes with its variables substituted', async () => {
    const css = await render('@a: 3px; .y { b: rgb(@a > 2px, 1, 2); c: hsl((@a > 2px) and (@a < 5px), 1%, 2%); d: rgb(not (@a = 3px), 1, 2); }');
    expect(css).toBe('.y {\n  b: rgb(3px > 2px, 1, 2);\n  c: hsl((3px > 2px) and (3px < 5px), 1%, 2%);\n  d: rgb(not (3px = 3px), 1, 2);\n}\n');
  });

  /*
   * The parser reads a comparison in a value paren group as a condition, and a
   * condition nothing consumes is written with its operands evaluated: the
   * variable holding the group writes the group with `@a` substituted, while a
   * consumer still reads it as a condition.
   */
  it('writes a comparison group a variable holds with its variables substituted', async () => {
    const css = await render('@a: 3px; @x: (@a > 2px); .y { a: @x; b: boolean(@x); c: if(@x, yes, no); }');
    expect(css).toBe('.y {\n  a: (3px > 2px);\n  b: true;\n  c: yes;\n}\n');
  });

  /*
   * `and`, `or` and `not` in a value paren group make one condition, as a
   * comparison does. Written out, each term under them keeps the parens Less's
   * condition syntax requires (J20), so `(@a > 2px and @a < 5px)` is written
   * `((3px > 2px) and (3px < 5px))` where Less 4.x keeps the ungrouped text;
   * a group written with its terms grouped, and a `not` group, are written as
   * Less 4.x writes them. A consumer reads the condition.
   */
  it('reads and / or / not in a value paren group as one condition', async () => {
    const css = await render([
      '@a: 3px;',
      '@x: (@a > 2px and @a < 5px);',
      '@y: ((@a > 2px) and (@a < 5px));',
      '@z: (not (@a > 2px));',
      '.y { a: @x; b: @y; c: @z; d: boolean(@x); e: if(@z, yes, no); f: boolean((@a < 1px or @a > 2px and @a < 5px)); g: if((@a > 2px and @a < 5px), yes, no); }'
    ].join(' '));
    expect(css).toBe('.y {\n  a: ((3px > 2px) and (3px < 5px));\n  b: ((3px > 2px) and (3px < 5px));\n  c: (not (3px > 2px));\n  d: true;\n  e: no;\n  f: true;\n  g: yes;\n}\n');
  });
});
