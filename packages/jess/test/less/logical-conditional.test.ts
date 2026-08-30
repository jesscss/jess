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
});
