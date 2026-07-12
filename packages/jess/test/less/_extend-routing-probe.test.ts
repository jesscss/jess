import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { readFileSync, existsSync } from 'fs';
import { Compiler } from '../../src/index.js';
import { spineRenderCounter, Rules } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { resolveLessTestDataRoot } from '../test-utils.js';

const testData = resolveLessTestDataRoot();

// extend fixtures + collapse override (from their styles.config.ts).
// collapseNesting default = true; extend-selector overrides to false.
const fixtures: Array<{ rel: string; collapse: boolean }> = [
  { rel: 'tests-unit/extend/extend.less', collapse: true },
  { rel: 'tests-unit/extend-nest/extend-nest.less', collapse: true },
  { rel: 'tests-unit/extend-chaining/extend-chaining.less', collapse: true },
  { rel: 'tests-unit/extend-clearfix/extend-clearfix.less', collapse: true },
  { rel: 'tests-unit/extend-media/extend-media.less', collapse: true },
  { rel: 'tests-unit/extend-selector/extend-selector.less', collapse: false },
  { rel: 'tests-unit/selectors/selectors.less', collapse: true },
  { rel: 'tests-unit/import/import-reference.less', collapse: true }
];

const mkCompiler = (collapse: boolean) =>
  new Compiler({
    output: { collapseNesting: collapse },
    compile: { plugins: [lessPlugin(), lessCompatPlugin({ plugins: [] })] }
  });

describe('extend routing probe', () => {
  for (const { rel, collapse } of fixtures) {
    it(rel, async () => {
      const lessPath = path.join(testData, rel);
      if (!existsSync(lessPath)) {
        console.log(`ROUTING\t${rel}\tMISSING`);
        return;
      }
      const expectedPath = lessPath.replace(/\.less$/, '.css');
      const expected = existsSync(expectedPath) ? readFileSync(expectedPath, 'utf8') : undefined;

      const orig = Rules.prototype.derive;
      let derives = 0;
      Rules.prototype.derive = function patched(this: Rules, ...args: any[]) {
        derives++;
        return orig.apply(this, args as any);
      } as any;

      let css = '';
      let err: string | undefined;
      const before = spineRenderCounter.rootRenders;
      try {
        const compiler = mkCompiler(collapse);
        const result = await compiler.renderToResult(lessPath, { outputFile: expectedPath });
        css = result.css;
      } catch (e: any) {
        err = e?.message ?? String(e);
      } finally {
        Rules.prototype.derive = orig;
      }
      const spineMoved = spineRenderCounter.rootRenders > before;
      const routing = err
        ? `ERROR`
        : spineMoved && derives === 0
          ? 'SPINE'
          : !spineMoved && derives > 0
            ? 'EVAL'
            : `MIXED(spine=${spineMoved},derives=${derives})`;
      const byteMatch = expected === undefined ? 'no-expected' : css === expected ? 'BYTE-OK' : 'BYTE-DIFF';
      console.log(`ROUTING\t${rel}\tcollapse=${collapse}\t${routing}\t${byteMatch}${err ? `\t${err.slice(0, 80)}` : ''}`);
      expect(true).toBe(true);
    });
  }
});
