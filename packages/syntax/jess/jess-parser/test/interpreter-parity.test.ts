import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type JessAstGrammar } from '../src/parse-with.js';
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
 * The macro-compiled and interpreter bundles of the Jess grammar parse this
 * package's `.jess` fixtures (valid and error cases), plus the CSS parser's, to
 * identical AST and CST results. See `css-parser/test/engine-parity.ts`.
 */
const LIB = fileURLToPath(new URL('../lib', import.meta.url));

const CORPUS = [...CSS_FIXTURES, ...fixtureFiles('packages/syntax/jess/jess-parser/test', '.jess')];

/*
 * PINNED DEFECT, line-tracking variants only. The COMPILED `trackLines` Jess
 * tables disagree with the offsets-only tables and the interpreter, which
 * agree with each other: `.box { one: $a.b.c; three: $( $one ) four; }` is
 * rejected at offset 0 through `@jesscss/jess-parser/positions` (AST and CST).
 * (The media range query CST divergence went with Jess's own media clause:
 * `@media` reads the CSS base's media query list.)
 */
const REFERENCE_THEN_EVAL = 'compiled trackLines table rejects a dotted reference followed by `$( … )`';
const PINNED = new Map<Variant, Pins>([
  ['ast/positions', new Map([
    ['packages/syntax/jess/jess-parser/test/data/variables.jess', REFERENCE_THEN_EVAL]
  ])],
  ['cst/positions', new Map([
    ['packages/syntax/jess/jess-parser/test/data/variables.jess', REFERENCE_THEN_EVAL]
  ])]
]);

describe('Jess grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(CSS_FIXTURES.length + 4);
  });

  it.each(ENGINES)('the %s grammar generates no code at runtime', (engine) => {
    assertNoRuntimeCodegen(LIB, engine, '.a { b: c; }', COMPOSED_CODEGEN_PINS.get(engine));
  });

  it.each(AST_VARIANTS)('AST %s', async (variant) => {
    const engines = await loadEnginePair(LIB, variant);
    assertEnginesAgree(
      CORPUS,
      (engine, source) => outcome(() => parseWith(engines[engine] as JessAstGrammar, source)),
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
