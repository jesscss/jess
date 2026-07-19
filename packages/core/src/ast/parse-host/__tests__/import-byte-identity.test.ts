import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { createImportState } from '../import.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { renderImportOracle } from './import-oracle.js';

const ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';

/** Parse + bridge a FILE (resolving its imports), serialize to CSS bytes. */
async function renderAstFile(file: string): Promise<string> {
  const src = fs.readFileSync(file, 'utf8');
  const parsed = parseLessFn(src);
  if (parsed.errors.length > 0) throw new Error(`parse errors in ${file}`);
  const bridged = bridgeToAst(parsed.tree, src, file, createImportState(parseLessFn));
  const evaluator = buildEvaluator(makeBuiltinRegistry());
  return (await serialize(bridged, { evaluator })).css;
}

// Real less.js @import fixtures tree2 reproduces byte-for-byte vs the REAL
// import-resolving oracle (the jess Compiler with the Less plugin).
const REAL_FIXTURES = [
  'import/import/import-test-f.less', // static import ("import-test-e") + own rule
  'import/import/import-test-b.less', // import + variable crossing the boundary + mixin
  'import/import/import-test-c.less', // control: no import, var used in rule
  'import/import/import-test-e.less', // control: trivial single rule
  'import/import-once.less', // `once` dedup (3x same file) + `(multiple)` re-emit + deeper `..` resolution
  'import/import/import-inline-invalid-css.less', // [import:inline] raw-bytes splice (no media)
  'import/import-interpolation.less', // [import:specifier] interpolated paths + hoisted cross-import vars + nested inline splice
];

describe('tree2 @import — byte-identity vs the real import-resolving oracle', () => {
  for (const rel of REAL_FIXTURES) {
    it(rel, async () => {
      const file = path.join(ROOT, rel);
      const oracle = await renderImportOracle(file);
      const t2css = await renderAstFile(file);
      expect(t2css).toBe(oracle);
    });
  }
});
