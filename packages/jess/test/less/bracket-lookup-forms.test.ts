import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * A lookup is an `if()` condition operand like a variable is (ledger P45).
 */
async function render(source: string): Promise<string> {
  return new Compiler({ output: { collapseNesting: true } }).renderString(source, {
    filePath: 'entry.less',
    extension: '.less'
  });
}

describe('Less bracket lookups through the compiler', () => {
  it('compares a lookup in an if() condition', async () => {
    await expect(render(`
      @map: { k: 2; };
      .a { x: if((@map[k] = 2), yes, no); y: if((@map[k] = 3), yes, no); }
    `)).resolves.toBe('.a {\n  x: yes;\n  y: no;\n}\n');
  });
});
