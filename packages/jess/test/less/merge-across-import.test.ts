import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * An `@import` inside a rule runs as that rule's body (ledger A2, N10), so its
 * declarations join the rule's own: a `+:` there merges with the rule's `+:`
 * of the same property (ledger R10, "mixin/import contributions"; M1 anchors
 * the merged line at the last member).
 */
describe('`+:` merge across an @import inside a rule (jess#391)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-merge-import-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const render = async (main: string, imported: string, collapseNesting: false | 'native'): Promise<string> => {
    fs.writeFileSync(path.join(dir, 'imp.less'), imported);
    fs.writeFileSync(path.join(dir, 'main.less'), main);
    const compiler = new Compiler({ output: { collapseNesting }, compile: { plugins: [lessPlugin()] } });
    return (await compiler.renderToResult(path.join(dir, 'main.less'))).css;
  };

  for (const mode of [false, 'native'] as const) {
    it(`merges the imported member into the rule's line (collapseNesting: ${String(mode)})`, async () => {
      expect(await render('.x { a+: 2; @import "imp.less"; }\n', 'a+: 3;\n', mode)).toBe('.x {\n  a: 2, 3;\n}\n');
    });

    it(`keeps the imported sheet, and its leading comment, in place in the rule's block (collapseNesting: ${String(mode)})`, async () => {
      expect(await render('.x { b: 1; @import "imp.less"; c: 4; }\n', '/* imp */\na: 3;\n', mode))
        .toBe('.x {\n  b: 1;\n  /* imp */\n  a: 3;\n  c: 4;\n}\n');
    });
  }
});
