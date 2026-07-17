import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst, UnsupportedShape } from './bridge.js';
import { createImportState } from '../import.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from '../../functions/index.js';
import { renderImportOracle } from './import-oracle.js';

const ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';

function findLess(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.less')) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

// The census scans only fixtures that actually contain an `@import` (the import
// rung's surface). Each is rendered through the REAL import-resolving oracle
// (the jess Compiler) and compared to tree2's parse->bridge(with resolution)->
// serialize. Fixtures WITHOUT `@import` are the province of the base census.
describe('tree2 @import — import-fixture census', () => {
  it('scan', async () => {
    const files = findLess(ROOT).filter((f) => /@import\b/.test(fs.readFileSync(f, 'utf8')));
    const passes: string[] = [];
    const diffs: string[] = [];
    const rejects = new Map<string, number>();
    const oracleErrors: string[] = [];

    for (const file of files) {
      const rel = path.relative(ROOT, file);
      const src = fs.readFileSync(file, 'utf8');
      let oracle: string;
      try {
        oracle = await renderImportOracle(file);
      } catch {
        oracleErrors.push(rel);
        continue;
      }
      let parsed;
      try {
        parsed = parseLessFn(src);
      } catch {
        rejects.set('parse-error', (rejects.get('parse-error') ?? 0) + 1);
        continue;
      }
      if (parsed.errors.length > 0) {
        rejects.set('parse-error', (rejects.get('parse-error') ?? 0) + 1);
        continue;
      }
      let t2css: string;
      try {
        const bridged = bridgeToAst(parsed.tree, src, file, createImportState());
        const evaluator = buildEvaluator(makeBuiltinRegistry());
        t2css = (await serialize(bridged, { evaluator })).css;
      } catch (e) {
        if (e instanceof UnsupportedShape) {
          const key = e.feature === 'statement' ? `statement:${e.detail}` : e.feature;
          rejects.set(key, (rejects.get(key) ?? 0) + 1);
        } else {
          rejects.set('error:' + (e as Error).message.slice(0, 40), 1);
        }
        continue;
      }
      if (t2css === oracle) passes.push(rel);
      else diffs.push(rel);
    }

    const ranked = [...rejects.entries()].sort((a, b) => b[1] - a[1]);
    console.log('\n============ TREE2 @IMPORT CENSUS ============');
    console.log(`fixtures containing @import : ${files.length}`);
    console.log(`CLEAN PASSES (byte-identical): ${passes.length}`);
    console.log(`bridged-but-DIFF            : ${diffs.length}`);
    console.log(`UNSUPPORTED (bridge reject) : ${[...rejects.values()].reduce((a, b) => a + b, 0)}`);
    console.log(`oracle-render errors        : ${oracleErrors.length}`);
    console.log('\n--- CLEAN PASSES ---');
    for (const p of passes) console.log(`  PASS  ${p}`);
    console.log('\n--- RANKED REJECT REASONS ---');
    for (const [feat, n] of ranked) console.log(`  ${String(n).padStart(3)}  ${feat}`);
    console.log('\n--- sample diffs ---');
    for (const d of diffs.slice(0, 20)) console.log(`  DIFF  ${d}`);
    console.log('=============================================\n');
  }, 120000);
});
