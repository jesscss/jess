import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type LessAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import {
  assertEnginesAgree,
  assertNoRuntimeCodegen,
  AST_VARIANTS,
  COMPOSED_CODEGEN_PINS,
  CSS_FIXTURES,
  CST_VARIANTS,
  cstOutcome,
  fixtureFiles,
  ENGINES,
  loadEnginePair,
  outcome,
  type Pins,
  type Variant
} from '../../../css/css-parser/test/engine-parity.js';

/**
 * The macro-compiled and interpreter bundles of the Less grammar parse the
 * repo's Less fixtures, plus the CSS parser's, to identical AST and CST
 * results. See `css-parser/test/engine-parity.ts`.
 */
const LIB = fileURLToPath(new URL('../lib', import.meta.url));

/* This package keeps no `.less` files of its own; the repo's live in `packages/jess/test`. */
const CORPUS = [...CSS_FIXTURES, ...fixtureFiles('packages/jess/test', '.less')];

/*
 * PINNED DEFECT, line-tracking variants only: the COMPILED `trackLines` Less
 * table rejects `!important` preceded by whitespace at offset 0
 * (`a{b:c !important}` fails through `@jesscss/less-parser/positions`). The
 * offsets-only table and the interpreter both accept it.
 */
const SPACED_IMPORTANT = 'compiled trackLines table rejects whitespace before `!important`';
const TRACKED_PINS: Pins = new Map([
  ['packages/syntax/css/css-parser/test/css/important.css', SPACED_IMPORTANT],
  ['packages/jess/test/less/fixtures/merge-fallback-important.less', SPACED_IMPORTANT]
]);
const PINNED = new Map<Variant, Pins>([
  ['ast/positions', TRACKED_PINS],
  ['cst/positions', TRACKED_PINS]
]);

describe('Less grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(CSS_FIXTURES.length + 20);
  });

  it.each(ENGINES)('the %s grammar generates no code at runtime', (engine) => {
    assertNoRuntimeCodegen(LIB, engine, '.a { b: c; }', COMPOSED_CODEGEN_PINS.get(engine));
  });

  it.each(AST_VARIANTS)('AST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CORPUS,
      (engine, source) => outcome(() => parseWith(engines[engine] as LessAstGrammar, source)),
      PINNED.get(variant)
    );
  });

  it.each(CST_VARIANTS)('CST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CORPUS,
      (engine, source) => cstOutcome(engines[engine], source, commentTriviaLabels),
      PINNED.get(variant)
    );
  });
});
