import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst, UnsupportedShape } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';
import { renderRealOracle } from './oracle.js';

/**
 * Rung 9 (parallel branch): at-rules — block (`@media`/`@font-face`/`@keyframes`/
 * `@page`/`@supports`/`@counter-style`/unknown) + statement (`@namespace`). All
 * byte-identity is vs the REAL (function-evaluating) oracle. v5 keeps sibling
 * `@media` blocks separate; an empty at-rule block is dropped entirely.
 */

/** Constructed real-syntax `.less` inputs exercising each supported at-rule shape. */
const inputs: Array<[string, string]> = [
  ['font-face', "@font-face { font-family: xecret; src: url('a.ttf'); }\n"],
  ['page-noprelude', '@page { margin: 2cm; size: A4; }\n'],
  ['page-prelude', '@page :first { margin: 3cm; }\n'],
  ['counter-style', '@counter-style my-counter { system: fixed; suffix: ". "; }\n'],
  ['keyframes', '@keyframes slidein { from { margin-left: 100%; } to { margin-left: 0%; } }\n'],
  ['keyframes-string', '@keyframes "anim" { 0% { opacity: 0; } 100% { opacity: 1; } }\n'],
  ['media-nested', '@media print { .a { color: red; } }\n'],
  ['media-deep', '@media print { .a { .b { width: 1px; } } }\n'],
  ['supports', '@supports (display: grid) { .a { color: red; } }\n'],
  ['unknown-block', '@unknown foo 42 { x { y: z; } }\n'],
  ['nested-atrule', '@supports (a: b) { @font-face { font-family: x; } }\n'],
  ['atrule-with-direct-and-nested', '@page { margin: 2cm; @top-left { content: "x"; } }\n'],
  ['namespace-statement', '@namespace svg "http://example.com/svg";\n'],
  ['empty-block-dropped', '@media screen { }\n'],
  ['keyframes-var-prelude', '@name: slidein;\n@keyframes @name { from { top: 0; } }\n'],
  ['sibling-media-not-merged', '@media print { .a { color: red; } }\n@media print { .b { color: blue; } }\n'],
  // [charset] `@charset` is a document-prelude construct: the first is hoisted to
  // the top of the output and every other one is dropped (dedupe).
  ['charset-single', '@charset "UTF-8";\n.a { color: red; }\n'],
  ['charset-hoist-from-midbody', '.a { color: red; }\n@charset "UTF-8";\n.b { color: blue; }\n'],
  ['charset-dedupe', '.a { color: red; }\n@charset "utf-8";\n.b { color: blue; }\n@charset "utf-8";\n'],
  ['charset-dedupe-different-value', '@charset "UTF-8";\n.a { color: red; }\n@charset "ISO-8859-1";\n'],
];

async function render(name: string, src: string): Promise<void> {
  const parsed = parseLessFn(src);
  let bridged;
  try {
    bridged = bridgeToAst(parsed.tree, src);
  } catch (e) {
    if (e instanceof UnsupportedShape) {
      throw new Error(`UNSUPPORTED ${e.feature} (${e.detail}) for: ${src.trim()}`);
    }
    throw e;
  }
  const evaluator = buildEvaluator();
  const t2css = (await serialize(bridged, { evaluator })).css;
  const oracle = await renderRealOracle(parsed.tree);
  if (t2css !== oracle) {
    console.log(`\n--- ${name} ---\nSRC: ${JSON.stringify(src)}\nT2 : ${JSON.stringify(t2css)}\nORA: ${JSON.stringify(oracle)}`);
  }
  expect(t2css).toBe(oracle);
}

describe('at-rule byte-identity (constructed .less, real oracle)', () => {
  for (const [name, src] of inputs) {
    it(name, async () => {
      await render(name, src);
    });
  }
});

/** Real less.js fixtures whose whole-file output tree2 reproduces byte-identically. */
const REAL_ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';
const realFixtures = [
  'at-rules-declarations/at-rules-declarations.less',
  'at-rules-empty-block/at-rules-empty-block.less',
  'import/import/imports/font.less',
  'urls/import/imports/font.less',
];

describe('at-rule byte-identity (real less.js fixtures)', () => {
  for (const rel of realFixtures) {
    it(rel, async () => {
      const abs = path.join(REAL_ROOT, rel);
      const src = fs.readFileSync(abs, 'utf8');
      const parsed = parseLessFn(src);
      const bridged = bridgeToAst(parsed.tree, src);
      const evaluator = buildEvaluator();
      const t2css = (await serialize(bridged, { evaluator })).css;
      const oracle = await renderRealOracle(parsed.tree);
      expect(t2css).toBe(oracle);
    });
  }
});
