import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWith, type JessAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import {
  assertEnginesAgree,
  AST_VARIANTS,
  CSS_FIXTURES,
  CST_VARIANTS,
  cstOutcome,
  fixtureFiles,
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
 * agree with each other:
 *  - `.box { one: $a.b.c; three: $( $one ) four; }` is rejected at offset 0
 *    through `@jesscss/jess-parser/positions` (AST and CST);
 *  - the CST of a media range query (`(width > 0)`, `(100em < width < 200em)`)
 *    carries extra children.
 */
const REFERENCE_THEN_EVAL = 'compiled trackLines table rejects a dotted reference followed by `$( … )`';
const MEDIA_RANGE = 'compiled trackLines CST table emits extra children in a media range query';
const PINNED = new Map<Variant, Pins>([
  ['ast/positions', new Map([
    ['packages/syntax/jess/jess-parser/test/data/variables.jess', REFERENCE_THEN_EVAL]
  ])],
  ['cst/positions', new Map([
    ['packages/syntax/jess/jess-parser/test/data/variables.jess', REFERENCE_THEN_EVAL],
    ['packages/syntax/css/css-parser/test/css/atrule-decls.css', MEDIA_RANGE],
    ['packages/syntax/css/css-parser/test/css/errors/media-no-selector.css', MEDIA_RANGE],
    ['packages/syntax/css/css-parser/test/css/expressions.css', MEDIA_RANGE]
  ])]
]);

describe('Jess grammar: macro-compiled and interpreter bundles agree', () => {
  it('has a corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(CSS_FIXTURES.length + 4);
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
