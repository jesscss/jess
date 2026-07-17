/**
 * Color-fn argument coercion / preserve (E3).
 *
 * A bare/global fn reference that resolves to a built-in but can't produce a value
 * for its args renders VERBATIM (FunctionMode `preserve`, the Less v5 default),
 * rather than throwing. Ground truth is the less.js `alpha` corpus
 * (`color-functions/modern-syntax.less`, `rgba.less`, `functions/functions.less`):
 * modern space/slash color syntax, a `var()` color arg, and a non-color first arg
 * to `contrast` (the CSS filter) all pass through unchanged; a genuine color arg
 * still computes.
 */
import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { bridgeToAst } from './bridge.js';

async function render(src: string): Promise<string> {
  const tree = parseLessFn(src).tree;
  const evaluator = buildEvaluator(makeBuiltinRegistry());
  const out = await serialize(bridgeToAst(tree, src), { evaluator });
  return out.css;
}

describe('color-fn preserve (E3)', () => {
  const preserved: Array<[string, string, string]> = [
    ['modern rgb space', '.a { color: rgb(0 128 255); }\n', 'rgb(0 128 255)'],
    ['modern rgb slash-alpha', '.a { color: rgb(0 128 255 / 50%); }\n', 'rgb(0 128 255 / 50%)'],
    ['modern hsl space', '.a { color: hsl(198deg 28% 50%); }\n', 'hsl(198deg 28% 50%)'],
    ['modern hsl slash-alpha', '.a { color: hsl(198deg 28% 50% / 50%); }\n', 'hsl(198deg 28% 50% / 50%)'],
    ['rgba var()', '.a { color: rgba(var(--x), 0.2); }\n', 'rgba(var(--x), 0.2)'],
    ['contrast filter', '.a { b: contrast(30%); }\n', 'contrast(30%)'],
  ];
  for (const [name, src, expected] of preserved) {
    it(`preserves ${name}`, async () => {
      expect(await render(src)).toContain(expected);
    });
  }

  it('still computes a genuine color arg', async () => {
    expect(await render('.a { b: lighten(red, 10%); }\n')).toContain('#ff3333');
    expect(await render('.a { b: rgba(#55FF5599); }\n')).toContain('rgba(85, 255, 85, 0.6)');
  });
});
