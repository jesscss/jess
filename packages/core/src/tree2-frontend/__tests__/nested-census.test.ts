import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2, UnsupportedShape } from '../bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { renderRealOracle, renderRealOracleNested } from '../oracle.js';

/**
 * R0 — real-corpus census in the Less v5 DEFAULT nested form
 * (`collapseNesting:false`). For every less.js `tests-unit` fixture that bridges,
 * compare tree2's nested serialize against the REAL oracle rendered nested, and
 * (for calibration) tree2's flattened serialize against the REAL oracle rendered
 * flattened. Reports the nested-pass set, the flatten-pass set, and the delta.
 */
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

const LESS_ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';

describe('R0 — nested corpus census', () => {
  it('scan', async () => {
    const files = findLess(LESS_ROOT);
    const nestedPasses: string[] = [];
    const flatPasses: string[] = [];
    const bridged: string[] = [];
    const nestedDiffs: string[] = [];
    const nestedOnly: string[] = [];
    const flatOnly: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(LESS_ROOT, file);
      let parsed;
      try {
        parsed = parseLessFn(src);
      } catch {
        continue;
      }
      if (parsed.errors.length > 0) continue;
      let tree2Root;
      try {
        // Pass the fixture's absolute path as `filePath` so `@import`
        // resolves relative to the source file (matches the product path),
        // instead of failing spuriously against the vitest cwd.
        tree2Root = bridgeToTree2(parsed.tree, src, file);
      } catch (e) {
        if (!(e instanceof UnsupportedShape)) throw e;
        continue;
      }
      bridged.push(rel);
      let service;
      try {
        evaluator = buildEvaluator();
      } catch {
        continue;
      }
      // FLAT
      let flatPass = false;
      try {
        const t2 = (await serialize(tree2Root, { evaluator })).css;
        const orc = await renderRealOracle(parseLessFn(src).tree);
        flatPass = t2 === orc;
      } catch {
        /* ignore */
      }
      // NESTED
      let nestedPass = false;
      try {
        const t2 = (await serialize(tree2Root, { evaluator, collapseNesting: false })).css;
        const orc = await renderRealOracleNested(parseLessFn(src).tree);
        nestedPass = t2 === orc;
        if (!nestedPass) nestedDiffs.push(rel);
      } catch {
        /* ignore */
      }
      if (flatPass) flatPasses.push(rel);
      if (nestedPass) nestedPasses.push(rel);
      if (nestedPass && !flatPass) nestedOnly.push(rel);
      if (flatPass && !nestedPass) flatOnly.push(rel);
    }

    console.log('\n================ TREE2 R0 NESTED CENSUS ================');
    console.log(`total .less scanned    : ${files.length}`);
    console.log(`bridged (shape OK)     : ${bridged.length}`);
    console.log(`FLAT   byte-identical  : ${flatPasses.length}`);
    console.log(`NESTED byte-identical  : ${nestedPasses.length}`);
    console.log(`bridged-but-NESTED-DIFF: ${nestedDiffs.length}`);
    console.log(`\n--- NESTED PASSES ---`);
    for (const p of nestedPasses) console.log(`  PASS  ${p}`);
    console.log(`\n--- passes in NESTED but NOT flat (${nestedOnly.length}) ---`);
    for (const p of nestedOnly) console.log(`  ${p}`);
    console.log(`\n--- passes in FLAT but NOT nested (${flatOnly.length}) ---`);
    for (const p of flatOnly) console.log(`  ${p}`);
    console.log(`\n--- bridged but NESTED diff (${nestedDiffs.length}) ---`);
    for (const p of nestedDiffs) console.log(`  ${p}`);
    console.log('=======================================================\n');
  }, 300000);
});
