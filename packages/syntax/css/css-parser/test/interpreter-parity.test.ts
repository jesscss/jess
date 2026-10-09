import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type CssAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import {
  assertEnginesAgree,
  AST_VARIANTS,
  CSS_FIXTURES,
  CST_VARIANTS,
  cstOutcome,
  loadEnginePair,
  outcome,
  type Pins
} from './engine-parity.js';

/**
 * The macro-compiled and interpreter bundles of the CSS grammar parse the
 * package's fixtures (valid and error cases) to identical AST and CST results.
 * See `engine-parity.ts`.
 */
const LIB = fileURLToPath(new URL('../lib', import.meta.url));

/*
 * PINNED DEFECT, every variant: on these two failures the interpreter names
 * `token()` terminals by their regex source in the `expected` set where the
 * compiled table names them by label (`UnicodeRangeToken`,
 * `IdentToken`), so the AST error degrades from "Expected a CSS value."
 * to the generic "Expected valid CSS syntax here." Location and outcome agree.
 */
const EXPECTED_SET_LABELS = 'interpreter reports token() terminals by regex source, not label, in `expected`';
const PINNED_ALL: Pins = new Map([
  ['packages/syntax/css/css-parser/test/css/errors/calc-empty.css', EXPECTED_SET_LABELS],
  ['packages/syntax/css/css-parser/test/css/errors/calc-lone-operator.css', EXPECTED_SET_LABELS]
]);

describe('CSS grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CSS_FIXTURES.length).toBeGreaterThan(80);
  });

  it.each(AST_VARIANTS)('AST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CSS_FIXTURES,
      (engine, source) => outcome(() => parseWith(engines[engine] as CssAstGrammar, source)),
      PINNED_ALL
    );
  });

  it.each(CST_VARIANTS)('CST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CSS_FIXTURES,
      (engine, source) => cstOutcome(engines[engine], source, commentTriviaLabels),
      PINNED_ALL
    );
  });
});
