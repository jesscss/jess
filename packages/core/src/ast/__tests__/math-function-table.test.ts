import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSS_MATH_FUNCTIONS, CSS_MATH_FUNCTION_OPENERS, isMathFunctionName } from '../math-functions.js';

/*
 * The math-function table has ONE authority — `CSS_MATH_FUNCTIONS` — and four
 * unavoidable occurrences.
 *
 * A grammar dispatch key must be MACRO-VISIBLE: parseman's plugin const-folds
 * `dispatch` keys at build time and cannot follow an imported binding. Every
 * import spelling was measured and fails the build with `composeLeaf() must
 * macro-fuse` — from `@jesscss/core/ast`, from `@jesscss/core/ast` with
 * `{ type: 'macro' }`, and through a relative source path. So a routing grammar
 * spells the openers as a literal, and this test is what keeps those literals
 * from drifting away from the authority. Add or remove a name in
 * `math-functions.ts` first; this test then names every file to update.
 */
/*
 * The grammars that ROUTE the table today. `.less` and `.scss` are absent on
 * purpose: they already ACCEPT every §10 construct through their generic call
 * tails, so they carry no recognition defect, and routing them needs a
 * per-dialect argument grammar rather than a copy of this one — in `.less` a
 * `/` inside a call is a list boundary, not division. Add them here in the same
 * change that gives them the arm.
 */
const GRAMMARS = [
  '../../../../syntax/css/css-parser/src/grammar.ts',
  '../../../../syntax/jess/jess-parser/src/grammar.ts'
] as const;

/** The `CSS_MATH_FUNCTION_OPENERS` array literal, read out of a grammar source. */
function openersInGrammar(relative: string): string[] | null {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const source = readFileSync(path, 'utf8');
  const declaration = /const CSS_MATH_FUNCTION_OPENERS = \[([\s\S]*?)\];/.exec(source);
  if (!declaration) {
    return null;
  }
  return [...declaration[1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!);
}

describe('css-values-4 §10 math-function table', () => {
  it('recognises exactly the values-4 set, and nothing from values-5', () => {
    expect([...CSS_MATH_FUNCTIONS]).toEqual([
      'calc',
      'min', 'max', 'clamp',
      'round', 'mod', 'rem',
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
      'pow', 'sqrt', 'hypot', 'log', 'exp',
      'abs', 'sign'
    ]);

    /*
     * values-5. Nothing enters the table until it ships in browsers, gated per
     * function and verified at implementation time. Not recognising one costs
     * only that its arguments are not parsed as math.
     */
    for (const name of [
      'calc-size', 'progress', 'media-progress', 'container-progress',
      'random', 'sibling-count', 'sibling-index'
    ]) {
      expect(isMathFunctionName(name), name).toBe(false);
    }
  });

  it('matches function names case-insensitively, as CSS does', () => {
    expect(isMathFunctionName('MIN')).toBe(true);
    expect(isMathFunctionName('Clamp')).toBe(true);
    expect(isMathFunctionName('minmax')).toBe(false);
  });

  it.each(GRAMMARS)('%s spells the same openers as the authority', (relative) => {
    const openers = openersInGrammar(relative);
    expect(
      openers,
      `${relative} declares no CSS_MATH_FUNCTION_OPENERS literal. Every grammar `
      + 'that routes math functions must carry one, because a dispatch key cannot '
      + 'be imported.'
    ).not.toBeNull();
    expect(openers, relative).toEqual([...CSS_MATH_FUNCTION_OPENERS]);
  });
});
