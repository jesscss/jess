import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type CssAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import {
  assertEnginesAgree,
  assertNoRuntimeCodegen,
  AST_VARIANTS,
  CSS_FIXTURES,
  CST_VARIANTS,
  cstOutcome,
  ENGINES,
  loadEnginePair,
  outcome
} from './engine-parity.js';

/**
 * The macro-compiled and interpreter bundles of the CSS grammar parse the
 * package's fixtures (valid and error cases) to identical AST and CST results.
 * See `engine-parity.ts`.
 */
const LIB = fileURLToPath(new URL('../lib', import.meta.url));

describe('CSS grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CSS_FIXTURES.length).toBeGreaterThan(80);
  });

  it.each(ENGINES)('the %s grammar generates no code at runtime', (engine) => {
    assertNoRuntimeCodegen(LIB, engine, '.a { b: c; }');
  });

  it.each(AST_VARIANTS)('AST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CSS_FIXTURES,
      (engine, source) => outcome(() => parseWith(engines[engine] as CssAstGrammar, source))
    );
  });

  it.each(CST_VARIANTS)('CST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CSS_FIXTURES,
      (engine, source) => cstOutcome(engines[engine], source, commentTriviaLabels)
    );
  });
});
