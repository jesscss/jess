/**
 * Selector key-set analysis, extracted OFF selector node methods.
 *
 * Historically each Selector subclass surfaced `keySet` / `visibleKeySet` /
 * `requiredKeySet` getters + a `computeKeySets()` method and cached the result in
 * per-node fields. That model has a string-shaped hole: string-normalized leaves
 * (`'.a'`) can't carry methods or a cache, so every container special-cased them
 * inline (`typeof c === 'string'`), and consumers had to too.
 *
 * This service centralises that computation as data-oriented dispatch over
 * `string | Selector`, keyed/cached per instance. It is owned by the eval Context
 * (bounded lifetime, so the string cache can't leak across compilations) but is
 * usable standalone (a fresh instance) at parse time or in unit tests. The key-set
 * of a selector is immutable per identity — eval mints new nodes, never mutates —
 * so the cache is pure memoization with no invalidation.
 */
import type { BitSet, BitSetLibrary } from './bitset.js';
import type { Selector } from '../selector.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { isCombinator } from './combinator.js';
import { F_VISIBLE } from '../node.js';

// Inlined from selector-complex to keep this module leaf-level (no runtime import
// of selector node classes), so the base Selector can delegate to it cycle-free.
function isStringCombinator(value: string): boolean {
  return value === ' ' || value === '>' || value === '+' || value === '~' || value === '|';
}

export interface SelectorKeySets {
  keySet: BitSet<string>;
  visibleKeySet: BitSet<string>;
  requiredKeySet: BitSet<string>;
}

// A selector component is either a string-normalized leaf or a node.
type Component = string | Selector;

// Minimal structural views of the selector node shapes we dispatch on. Reading
// `.value` / `.arg` / `.name` as data keeps this off the node classes' methods.
// Structural views read as data off the node (accessed via `as unknown as`), so
// this module needs no runtime import of the concrete selector classes.
interface PseudoLike {
  name: string;
  arg?: unknown;
  generated?: boolean;
  generatedPseudoPlacementOverride?: { omitWrapperForSingleSelectorList?: boolean };
}

interface AmpersandLike {
  getKeySetContainerSelector(): Selector | undefined;
}

export class SelectorAnalysis {
  private readonly cache = new WeakMap<Selector, SelectorKeySets>();

  constructor(readonly library: BitSetLibrary<string>) {}

  keySet(selector: Selector): BitSet<string> {
    return this.compute(selector).keySet;
  }

  visibleKeySet(selector: Selector): BitSet<string> {
    return this.compute(selector).visibleKeySet;
  }

  requiredKeySet(selector: Selector): BitSet<string> {
    return this.compute(selector).requiredKeySet;
  }

  compute(selector: Selector): SelectorKeySets {
    // Structural selectors are immutable per identity, so their key-sets memoize
    // safely. An Ampersand is the exception: its key-set tracks the runtime parent
    // in its container, which can change, so it must recompute every time.
    if (isNode(selector, N.Ampersand)) {
      return this.computeUncached(selector);
    }
    const cached = this.cache.get(selector);
    if (cached) {
      return cached;
    }
    const sets = this.computeUncached(selector);
    this.cache.set(selector, sets);
    return sets;
  }

  // Key-set of a single component: a string leaf interns as its own key; a node
  // recurses through the cache.
  private componentKeySets(component: Component): SelectorKeySets {
    if (typeof component === 'string') {
      const bits = this.library.getBitset([component]);
      return { keySet: bits, visibleKeySet: bits, requiredKeySet: bits };
    }
    return this.compute(component);
  }

  private computeUncached(selector: Selector): SelectorKeySets {
    const library = this.library;

    if (isNode(selector, N.CompoundSelector)) {
      // AND of components; strings and nodes contribute to all three sets.
      let keySet = library.getBitset();
      let visibleKeySet = library.getBitset();
      let requiredKeySet = library.getBitset();
      for (const component of selector.value as Component[]) {
        const c = this.componentKeySets(component);
        keySet = keySet.or(c.keySet);
        visibleKeySet = visibleKeySet.or(c.visibleKeySet);
        requiredKeySet = requiredKeySet.or(c.requiredKeySet);
      }
      return { keySet, visibleKeySet, requiredKeySet };
    }

    if (isNode(selector, N.SelectorList)) {
      // OR of alternatives; requiredKeySet is empty (any branch may match).
      let keySet = library.getBitset();
      let visibleKeySet = library.getBitset();
      for (const item of selector.value as Component[]) {
        const c = this.componentKeySets(item);
        keySet = keySet.or(c.keySet);
        visibleKeySet = visibleKeySet.or(c.visibleKeySet);
      }
      return { keySet, visibleKeySet, requiredKeySet: library.getBitset() };
    }

    if (isNode(selector, N.ComplexSelector)) {
      // Positional: combinators contribute to keySet + requiredKeySet but never
      // visibleKeySet.
      let keySet = library.getBitset();
      let visibleKeySet = library.getBitset();
      let requiredKeySet = library.getBitset();
      for (const component of selector.value as Component[]) {
        if (typeof component === 'string') {
          const bits = library.getBitset([component]);
          keySet = keySet.or(bits);
          if (!isStringCombinator(component)) {
            visibleKeySet = visibleKeySet.or(bits);
          }
          requiredKeySet = requiredKeySet.or(bits);
          continue;
        }
        if (isCombinator(component)) {
          const c = this.compute(component);
          keySet = keySet.or(c.keySet);
          requiredKeySet = requiredKeySet.or(c.requiredKeySet);
          continue;
        }
        const c = this.compute(component);
        keySet = keySet.or(c.keySet);
        visibleKeySet = visibleKeySet.or(c.visibleKeySet);
        requiredKeySet = requiredKeySet.or(c.requiredKeySet);
      }
      return { keySet, visibleKeySet, requiredKeySet };
    }

    if (isNode(selector, N.PseudoSelector)) {
      const pseudo = selector as unknown as PseudoLike;
      const arg = pseudo.arg;
      if (isNode(arg, N.Selector)) {
        const argSets = this.compute(arg);
        if (pseudo.name === ':is') {
          let requiredKeySet: BitSet<string>;
          if (isNode(arg, N.SelectorList)) {
            const omitGeneratedWrapper = pseudo.generated === true
              && pseudo.generatedPseudoPlacementOverride?.omitWrapperForSingleSelectorList === true
              && arg.value.length === 1;
            const firstItem = arg.value[0]!;
            requiredKeySet = omitGeneratedWrapper && typeof firstItem !== 'string'
              ? this.compute(firstItem).requiredKeySet
              : library.getBitset();
          } else {
            requiredKeySet = argSets.requiredKeySet;
          }
          return {
            keySet: argSets.keySet,
            visibleKeySet: argSets.visibleKeySet,
            requiredKeySet
          };
        }
        // Other pseudos add the pseudo name as a key bit to every set.
        const pos = library.add(pseudo.name);
        const keySet = argSets.keySet.clone();
        const visibleKeySet = argSets.visibleKeySet.clone();
        const requiredKeySet = argSets.requiredKeySet.clone();
        keySet.set(pos, 1);
        visibleKeySet.set(pos, 1);
        requiredKeySet.set(pos, 1);
        return { keySet, visibleKeySet, requiredKeySet };
      }
      const bits = library.getBitset([String(selector.valueOf())]);
      return { keySet: bits, visibleKeySet: bits, requiredKeySet: bits };
    }

    if (isNode(selector, N.Ampersand)) {
      // Ampersand's key-set is not a pure function of its structure: it reflects
      // the RUNTIME-resolved parent selector held in its container, and its visible
      // / required sets are always empty. Read that parent as data and union its
      // keys through the service (a bare `&` / string / Nil contributes none).
      const current = (selector as unknown as AmpersandLike).getKeySetContainerSelector();
      return {
        keySet: current ? this.compute(current).keySet : library.getBitset(),
        visibleKeySet: library.getBitset(),
        requiredKeySet: library.getBitset()
      };
    }

    // Leaf selector (BasicSelector, Interpolated, ...): its own value is the sole
    // key. visibleKeySet drops it when the leaf is invisible.
    const bits = library.getBitset([String(selector.valueOf())]);
    return {
      keySet: bits,
      requiredKeySet: bits,
      visibleKeySet: selector.hasFlag(F_VISIBLE) ? bits : library.getBitset()
    };
  }
}

// One analysis per bit library — the library identity defines the key-space, and
// analyses over the same key-space share a cache safely (immutable per selector).
const analysisByLibrary = new WeakMap<BitSetLibrary<string>, SelectorAnalysis>();

export function selectorAnalysisFor(library: BitSetLibrary<string>): SelectorAnalysis {
  let analysis = analysisByLibrary.get(library);
  if (!analysis) {
    analysis = new SelectorAnalysis(library);
    analysisByLibrary.set(library, analysis);
  }
  return analysis;
}
