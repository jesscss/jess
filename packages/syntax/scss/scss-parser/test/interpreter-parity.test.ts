import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type ScssAstGrammar } from '../src/parse-with.js';
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
  outcome
} from '../../../css/css-parser/test/engine-parity.js';

/**
 * The macro-compiled and interpreter bundles of the SCSS grammar parse this
 * package's `.scss` fixtures, plus the CSS parser's, to identical AST and CST
 * results. See `css-parser/test/engine-parity.ts`.
 */
const LIB = fileURLToPath(new URL('../lib', import.meta.url));

const CORPUS = [...CSS_FIXTURES, ...fixtureFiles('packages/syntax/scss/scss-parser/test', '.scss')];

describe('SCSS grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(CSS_FIXTURES.length);
  });

  it.each(ENGINES)('the %s grammar generates no code at runtime', (engine) => {
    assertNoRuntimeCodegen(LIB, engine, '.a { b: c; }', COMPOSED_CODEGEN_PINS.get(engine));
  });

  it.each(AST_VARIANTS)('AST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CORPUS,
      (engine, source) => outcome(() => parseWith(engines[engine] as ScssAstGrammar, source))
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
