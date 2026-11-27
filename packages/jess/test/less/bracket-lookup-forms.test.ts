import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * Well-formed Less lookups compile (ledger P45): trivia inside a `[…]` accessor
 * is trivia, a lookup is an `if()` condition operand like a variable is, and a
 * mixin call's lookup/call chain is a statement like `@map[@k]();` is.
 */
async function render(source: string): Promise<string> {
  return new Compiler({ output: { collapseNesting: true } }).renderString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });
}

describe('Less bracket lookups through the compiler', () => {
  it('reads a padded accessor as the accessor it pads', async () => {
    await expect(render(`
      @map: { @k: 1px; k: 2px; last: 3px; };
      .a { x: @map[ @k ]; y: @map[ k ]; z: @map[ /* key */ k ]; w: @map[ ]; }
    `)).resolves.toBe('.a {\n  x: 1px;\n  y: 2px;\n  z: 2px;\n  w: 3px;\n}\n');
  });

  it('compares a lookup in an if() condition', async () => {
    await expect(render(`
      @map: { k: 2; };
      .a { x: if((@map[k] = 2), yes, no); y: if((@map[k] = 3), yes, no); }
    `)).resolves.toBe('.a {\n  x: yes;\n  y: no;\n}\n');
  });

  it('calls the detached ruleset a mixin call returns under a key', async () => {
    await expect(render(`
      .m() { @dr: { a: b; }; }
      #ns { .m() { @dr: { c: d; }; } }
      .x { .m()[@dr](); }
      .y { #ns.m()[@dr](); }
    `)).resolves.toBe('.x {\n  a: b;\n}\n.y {\n  c: d;\n}\n');
  });
});
