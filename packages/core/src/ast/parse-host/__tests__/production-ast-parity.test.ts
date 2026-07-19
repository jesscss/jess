/**
 * PRODUCTION ast/ render-path parity + smoke gate (engine cutover step).
 *
 * The production `.less` ast/ render path is `@jesscss/plugin-less`'s
 * `renderLessFileViaAst` (the consumer-layer Less binding over core's
 * parser-agnostic `@jesscss/core/ast-render` pipeline). This suite proves that the
 * PRODUCTION path is byte-for-byte equivalent to the TEST-space differential path
 * (`whole-doc-driver`'s `renderAstFile` + the same built-in fn evaluator): both
 * bind the same Less grammar + inline-JS guard + `makeBuiltinRegistry` evaluator
 * over the same core pipeline, so their output must be identical.
 *
 * It renders the SAME less.js `alpha` corpus (`alpha-oracle-differential.test.ts`)
 * through the production entry and asserts:
 *   1. per-fixture BYTE parity with the test driver (production ≡ test), and
 *   2. the production MATCH count against the goldens equals the test path's.
 *
 * Plus a self-contained smoke test: a couple of fixtures render byte-identical to
 * their committed `.css` golden via the production entry alone.
 *
 * Corpus location + skip behaviour mirror the differential suite (READ-ONLY,
 * `LESSJS_ALPHA_TESTDATA` override; absent → SKIP so a machine without the less.js
 * worktree still builds green).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderLessFileViaAst } from '@jesscss/plugin-less';
import { renderAstFile } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { collapseNestingForGolden } from './oracle-source.js';

function corpusRoot(): string | undefined {
  const env = process.env.LESSJS_ALPHA_TESTDATA;
  if (env && fs.existsSync(env)) return env;
  const def = path.join(os.homedir(), 'git/worktrees/less.js/content-alpha3/packages/test-data/tests-unit');
  return fs.existsSync(def) ? def : undefined;
}

/** Collect `.less` fixtures paired with a v5 `.css` golden (excludes 4.x `legacy/`). */
function pairedFixtures(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (ent.name === 'legacy') continue;
        walk(path.join(dir, ent.name));
      } else {
        const p = path.join(dir, ent.name);
        if (ent.name.endsWith('.less') && fs.existsSync(`${p.slice(0, -5)}.css`)) out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Nearest-config-wins `collapseNesting` for a fixture's golden (product cascade). */
function resolveCollapse(lessPath: string, root: string): boolean {
  const fixtureName = path.basename(lessPath, '.less');
  const goldenBase = `${fixtureName}.css`;
  let dir = path.dirname(lessPath);
  for (;;) {
    const cfg = path.join(dir, 'styles.config.ts');
    if (fs.existsSync(cfg)) {
      const v = collapseNestingForGolden(fs.readFileSync(cfg, 'utf8'), fixtureName, goldenBase);
      if (v !== null) return v;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return true;
}

const ROOT = corpusRoot();

describe.skipIf(!ROOT)('production ast/ render path (renderLessFileViaAst)', () => {
  it('is byte-identical to the test differential path, with the same MATCH count', () => {
    const root = ROOT!;
    const fixtures = pairedFixtures(root);
    const testEvaluator = buildEvaluator(makeBuiltinRegistry());

    const parityMismatches: string[] = [];
    let prodMatch = 0;
    let testMatch = 0;

    for (const f of fixtures) {
      const rel = path.relative(root, f);
      const collapseNesting = resolveCollapse(f, root);
      const golden = fs.readFileSync(`${f.slice(0, -5)}.css`, 'utf8');

      const prod = renderLessFileViaAst(f, { collapseNesting });
      const test = renderAstFile(f, { evaluator: testEvaluator, collapseNesting });

      // (1) production ≡ test: same CSS bytes AND same throw disposition.
      const sameCss = prod.css === test.css;
      const sameThrew = (prod.threw === null) === (test.threw === null);
      if (!sameCss || !sameThrew) {
        parityMismatches.push(
          `${rel}: prod{css:${prod.css?.length ?? 'undef'},threw:${prod.threw?.message ?? 'none'}} `
          + `!= test{css:${test.css?.length ?? 'undef'},threw:${test.threw?.message ?? 'none'}}`,
        );
      }

      if (prod.css !== undefined && prod.css === golden) prodMatch++;
      if (test.css !== undefined && test.css === golden) testMatch++;
    }

    if (parityMismatches.length) {
      console.log('PARITY MISMATCHES:\n  ' + parityMismatches.join('\n  '));
    }
    console.log(`production MATCH: ${prodMatch} / ${fixtures.length} (test path MATCH: ${testMatch})`);

    // Production path is byte-for-byte the test path across the whole corpus.
    expect(parityMismatches, `production/test path divergences:\n${parityMismatches.join('\n')}`).toHaveLength(0);
    // Same MATCH count — the production path proves out at the differential number.
    expect(prodMatch).toBe(testMatch);
    // Guard the floor: the production path must clear the recorded differential MATCH baseline.
    expect(prodMatch).toBeGreaterThanOrEqual(61);
  });

  it('renders representative fixtures byte-identical to their committed golden', () => {
    const root = ROOT!;
    // A couple of stable, config-default (NESTED / collapseNesting:false) fixtures
    // known to MATCH — a self-contained smoke of the production entry alone.
    const candidates = pairedFixtures(root).filter((f) => {
      const golden = fs.readFileSync(`${f.slice(0, -5)}.css`, 'utf8');
      const r = renderLessFileViaAst(f, { collapseNesting: resolveCollapse(f, root) });
      return r.css !== undefined && r.css === golden;
    });
    // The corpus is present, so at least a handful match; assert a couple explicitly.
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (const f of candidates.slice(0, 2)) {
      const golden = fs.readFileSync(`${f.slice(0, -5)}.css`, 'utf8');
      const r = renderLessFileViaAst(f, { collapseNesting: resolveCollapse(f, root) });
      expect(r.threw, `${path.relative(root, f)} threw: ${r.threw?.message}`).toBeNull();
      expect(r.css, path.relative(root, f)).toBe(golden);
    }
  });
});
