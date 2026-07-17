import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst, UnsupportedShape } from './bridge.js';
import { buildNativeEvaluator } from '../../native-evaluator.js';
import { renderRealOracle } from './oracle.js';

// Rung 8: the oracle is now the REAL (function-evaluating) pipeline.
const renderLegacy = renderRealOracle;

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

describe('tree2 bridge — real corpus census', () => {
  it('scan', async () => {
    const files = findLess(LESS_ROOT);
    const passes: string[] = [];
    const diffs: Array<{ file: string; sizeB: number }> = [];
    const unsupported = new Map<string, number>();
    const diffCategories = new Map<string, number>();
    const parseErrors: string[] = [];
    const legacyErrors: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(LESS_ROOT, file);
      let parsed;
      try {
        parsed = parseLessFn(src);
      } catch {
        parseErrors.push(rel);
        continue;
      }
      if (parsed.errors.length > 0) {
        parseErrors.push(rel);
        continue;
      }
      let bridged;
      try {
        // Pass the fixture's absolute path as `filePath` so `@import`
        // resolves relative to the source file — matching the product path
        // (`compiler.render(path.resolve(sourceArg), …)`). Without it, imports
        // resolve against the vitest cwd and fail spuriously as
        // `import:unresolved`, a harness artifact rather than an engine gap.
        bridged = bridgeToAst(parsed.tree, src, file);
      } catch (e) {
        if (e instanceof UnsupportedShape) {
          const key = e.feature === 'statement' ? `statement:${e.detail}` : e.feature;
          unsupported.set(key, (unsupported.get(key) ?? 0) + 1);
        } else {
          unsupported.set('bridge-error:' + (e as Error).message.slice(0, 40), 1);
        }
        continue;
      }
      let t2css: string;
      try {
        const evaluator = buildNativeEvaluator();
        t2css = (await serialize(bridged, { evaluator })).css;
      } catch (e) {
        unsupported.set('serialize-error', (unsupported.get('serialize-error') ?? 0) + 1);
        continue;
      }
      let legacy: string;
      try {
        legacy = await renderLegacy(parsed.tree);
      } catch {
        legacyErrors.push(rel);
        continue;
      }
      if (t2css === legacy) {
        passes.push(rel);
      } else {
        diffs.push({ file: rel, sizeB: src.length });
        // Categorize the diff by a heuristic sniff of the source.
        let cat = 'other';
        if (/@[a-zA-Z]/.test(src) && /:\s*[^;]*@/.test(src)) cat = 'variable-in-value';
        else if (/\{[^}]*[-+*/][^}]*\}/.test(src)) cat = 'operation-maybe';
        else if (/~"|~'/.test(src)) cat = 'escaping';
        diffCategories.set(cat, (diffCategories.get(cat) ?? 0) + 1);
      }
    }

    const rankedUnsupported = [...unsupported.entries()].sort((a, b) => b[1] - a[1]);
    const rankedDiffCats = [...diffCategories.entries()].sort((a, b) => b[1] - a[1]);

    console.log('\n================ TREE2 BRIDGE CENSUS ================');
    console.log(`total .less files scanned : ${files.length}`);
    console.log(`CLEAN PASSES (byte-identical): ${passes.length}`);
    console.log(`bridged-but-DIFF            : ${diffs.length}`);
    console.log(`UNSUPPORTED (bridge reject) : ${[...unsupported.values()].reduce((a, b) => a + b, 0)}`);
    console.log(`parse errors/skipped        : ${parseErrors.length}`);
    console.log(`legacy-render errors        : ${legacyErrors.length}`);

    // Rung 8: the oracle now EVALUATES functions (fns registry wired), and tree2
    // computes them through the injected value service, so a pass whose source
    // calls a function is a GENUINE computed-function pass (both sides compute
    // the same bytes) — no longer "fn-hollow". A pass whose value contains a
    // `@ref` exercises variable resolution.
    const FN =
      /\b(lighten|darken|fade|fadein|fadeout|saturate|desaturate|rgba?|hsla?|hsv|spin|mix|tint|shade|alpha|luma|luminance|contrast|red|green|blue|hue|saturation|lightness|percentage|round|ceil|floor|unit|convert|calc)\s*\(/i;
    let meaningfulVarPasses = 0;
    let computedFnPasses = 0;
    console.log('\n--- CLEAN PASSES (real fixtures, byte-identical to REAL oracle) ---');
    for (const p of passes) {
      const abs = path.join(LESS_ROOT, p);
      const sz = fs.statSync(abs).size;
      const s = fs.readFileSync(abs, 'utf8');
      const hasVarRef = /:\s*[^;{}]*@[A-Za-z_]/.test(s);
      const hasFn = FN.test(s);
      const tag = [hasVarRef ? 'VAR' : '', hasFn ? 'computed-fn' : ''].filter(Boolean).join(',') || 'static';
      if (hasVarRef && !hasFn) meaningfulVarPasses++;
      if (hasFn) computedFnPasses++;
      console.log(`  PASS  ${p}  (${sz}B)  [${tag}]`);
    }
    console.log(`  => meaningful VARIABLE passes (var ref, no fn): ${meaningfulVarPasses}`);
    console.log(`  => GENUINE computed-function passes (fns evaluated both sides): ${computedFnPasses}`);

    console.log('\n--- RANKED BLOCKERS (unsupported feature -> #fixtures) ---');
    for (const [feat, n] of rankedUnsupported) console.log(`  ${String(n).padStart(4)}  ${feat}`);

    console.log('\n--- DIFF categories (bridged structurally, bytes differ) ---');
    for (const [cat, n] of rankedDiffCats) console.log(`  ${String(n).padStart(4)}  ${cat}`);
    console.log('  sample diffs:', diffs.slice(0, 15).map((d) => d.file).join(', '));
    console.log('====================================================\n');
  }, 120000);
});
