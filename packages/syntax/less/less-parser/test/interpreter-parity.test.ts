import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type LessAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import {
  assertEnginesAgree,
  assertNoRuntimeCodegen,
  AST_VARIANTS,
  CSS_FIXTURES,
  CST_VARIANTS,
  cstOutcome,
  fixtureFiles,
  ENGINES,
  loadEnginePair,
  outcome
} from '../../../css/css-parser/test/engine-parity.js';

/**
 * The macro-compiled and interpreter bundles of the Less grammar parse the
 * repo's Less fixtures, plus the CSS parser's, to identical AST and CST
 * results. See `css-parser/test/engine-parity.ts`.
 */
const LIB = fileURLToPath(new URL('../lib', import.meta.url));

/* This package keeps no `.less` files of its own; the repo's live in `packages/jess/test`. */
const CORPUS = [...CSS_FIXTURES, ...fixtureFiles('packages/jess/test', '.less')];

describe('Less grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(CSS_FIXTURES.length + 20);
  });

  it.each(ENGINES)('the %s grammar generates no code at runtime', (engine) => {
    assertNoRuntimeCodegen(LIB, engine, '.a { b: c; }');
  });

  it.each(AST_VARIANTS)('AST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CORPUS,
      (engine, source) => outcome(() => parseWith(engines[engine] as LessAstGrammar, source))
    );
  });

  it.each(CST_VARIANTS)('CST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CORPUS,
      (engine, source) => cstOutcome(engines[engine], source, commentTriviaLabels)
    );
  });
});
