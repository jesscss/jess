import { describe, it, expect } from 'vitest';
import { amp, compound, el, sel, pseudo, co, sellist, is, type Selector } from '../../../index.js';
import { Context } from '../../../context.js';
import { selectorAnalysisFor, keySetOf, visibleKeySetOf, requiredKeySetOf } from '../selector-analysis.js';

// The keySetOf/visibleKeySetOf/requiredKeySetOf free helpers must resolve the same
// service instance (via the selector's keySetLibrary) as an explicit
// selectorAnalysisFor(context.selectorBits) lookup — for every selector shape,
// including string-normalized leaves.
describe('SelectorAnalysis free helpers resolve the context service', () => {
  const cases: Array<{ name: string; make: () => Selector }> = [
    { name: 'simple leaf', make: () => el('.foo') },
    { name: 'compound (nodes)', make: () => compound([el('.foo'), el('.bar')]) },
    { name: 'compound (string leaves)', make: () => compound(['.foo', '.bar']) },
    { name: 'compound (mixed string+node)', make: () => compound(['.foo', el('.bar')]) },
    { name: 'compound (single string)', make: () => compound(['.a']) },
    { name: 'complex (nodes + combinator)', make: () => sel([el('.foo'), co(' '), el('.bar')]) },
    { name: 'complex (compound + combinator)', make: () => sel([compound([el('a'), el('.foo')]), co(' '), el('.bar')]) },
    { name: 'complex (string components)', make: () => sel(['.foo', ' ', '.bar']) },
    { name: 'selector list', make: () => sellist([el('.a'), el('.b')]) },
    { name: 'selector list (string items)', make: () => sellist(['.a', '.b']) },
    { name: ':is() with single arg', make: () => is(el('.a')) },
    { name: ':is() with list arg', make: () => is(sellist([el('.a'), el('.b')])) },
    { name: 'other pseudo with arg', make: () => pseudo(':not', el('.a')) },
    { name: 'ampersand', make: () => amp() },
    { name: 'nested :is in compound', make: () => compound([is(sellist([el('.a'), el('.b')])), el('.x')]) }
  ];

  for (const { name, make } of cases) {
    it(name, async () => {
      const context = new Context();
      const selector = make();
      await selector.eval(context);
      const analysis = selectorAnalysisFor(context.selectorBits);

      expect(analysis.keySet(selector).equals(keySetOf(selector))).toBe(true);
      expect(analysis.visibleKeySet(selector).equals(visibleKeySetOf(selector))).toBe(true);
      expect(analysis.requiredKeySet(selector).equals(requiredKeySetOf(selector))).toBe(true);
    });
  }
});
