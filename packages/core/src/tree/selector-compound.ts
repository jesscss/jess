import {
  defineType
} from './node.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import { Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { getEntries } from './util/collections.js';
import { isNode } from './util/is-node.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import type { PrintOptions } from './util/print.js';
import { ComplexSelector } from './selector-complex.js';
// #region agent log
import { syncLog } from './util/__tests__/debug-log.js';
// #endregion

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
/** Anything other than type (element) or universal, which must come first */
const nonElementRegex = /^[.#:[]/;
export class CompoundSelector extends Selector<SimpleSelector[]> {
  type = 'CompoundSelector' as const;
  shortType = 'compound' as const;

  protected override _computeKeySetAndFastReject(): void {
    let combinedKeySet = new Set<string>();
    let combinedVisibleKeySet = new Set<string>();
    let canFastReject = true;

    for (const selector of this.value) {
      // Union each child's keySet
      combinedKeySet = combinedKeySet.union(selector.keySet);
      combinedVisibleKeySet = combinedVisibleKeySet.union(selector.visibleKeySet);
      // If any child can't fast reject, this compound can't either
      if (!selector.canFastReject) {
        canFastReject = false;
      }
    }

    this._keySet = combinedKeySet;
    this._visibleKeySet = combinedVisibleKeySet;
    this._canFastReject = canFastReject;
  }

  override valueOf() {
    let value = this._valueOf;
    if (!value) {
      // Convert selectors to strings
      const components = this.value.map(n => n.valueOf());

      // Find element selectors (those that don't start with .#:[)
      const elementSelectors: string[] = [];
      const nonElementSelectors: string[] = [];

      for (const component of components) {
        if (!nonElementRegex.test(component)) {
          elementSelectors.push(component);
        } else {
          nonElementSelectors.push(component);
        }
      }

      // Element selectors must come first for valid CSS
      // Non-element selectors maintain their original order (no sorting)
      value = [...elementSelectors, ...nonElementSelectors].join('');
      this._valueOf = value;
    }
    return value;
  }

  override toTrimmedString(options?: PrintOptions): string {
    // Components in a compound selector are joined without spaces.
    // However, parser/copy/extend pipelines can preserve `post=1` (single space) on components,
    // which would serialize `.e.e` as `.e .e`. Normalize here as a final guard.
    const value = this.value;
    for (let i = 0; i < value.length - 1; i++) {
      (value[i] as any).post = undefined;
    }
    return super.toTrimmedString(options);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    return pipe(
      () => {
        const sel = this;
        let { value } = sel;
        const maybe = serialForEach(Array.from(getEntries(value)), ([item, i]) => {
          const out = item.eval(context);
          if (isThenable(out)) {
            return (out as Promise<SimpleSelector>).then((res) => {
              value[i] = res as SimpleSelector;
              return undefined;
            });
          }
          value[i] = out as SimpleSelector;
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => sel);
        }
        return sel;
      },
      (sel) => {
        let { value } = sel;
        value = value.filter(n => n && !(n instanceof Nil));
        // If we ended up with a generated-looking `:is(<complex>)` as the first component
        // of a compound selector (e.g. from `&` resolving to a complex selector) followed by
        // additional simple selectors like attributes, merge those suffixes into the last
        // component of the complex selector. This yields `* b[e]` instead of `:is(* b)[e]`.
        //
        // This is only safe to do in collapse-nesting mode, where we aggressively wrap complex
        // selectors in `:is()` to keep selectors valid during evaluation.
        if (context.opts.collapseNesting && value.length > 1) {
          const first = value[0];
          if (first && isNode(first as any, 'PseudoSelector') && (first as any).value?.name === ':is') {
            const arg = (first as any).value?.arg;
            if (arg && isNode(arg, 'ComplexSelector')) {
              const suffix = value.slice(1);
              // Clone to avoid mutating shared selector instances
              const complex = (arg as ComplexSelector).copy(true) as ComplexSelector;
              // Find last non-combinator component and attach suffix
              for (let i = complex.value.length - 1; i >= 0; i--) {
                const comp = complex.value[i]!;
                if (isNode(comp as any, 'Combinator')) {
                  continue;
                }
                if (isNode(comp as any, 'CompoundSelector')) {
                  (comp as any).value.push(...suffix.map(s => (s as any).copy(true)));
                } else {
                  // Wrap the last simple selector into a compound so suffix can attach
                  complex.value[i] = (CompoundSelector as any).create([
                    (comp as any).copy(true),
                    ...suffix.map(s => (s as any).copy(true))
                  ]);
                }
                return (complex as any).inherit(this) as Selector;
              }
            }
          }
        }
        value = value.sort((a, b) => {
          let aIsElement = !nonElementRegex.test(a.valueOf());
          let bIsElement = !nonElementRegex.test(b.valueOf());
          if (aIsElement && bIsElement) {
            return a.valueOf() < b.valueOf() ? -1 : 1;
          }
          return aIsElement ? -1 : bIsElement ? 1 : 0;
        });
        if (value.length === 0) {
          return (new Nil()).inherit(this);
        }
        if (value.length === 1) {
          return value[0]!.inherit(this) as Selector;
        }
        // Clear post on all components except the last one
        // Components in a compound selector are joined without spaces
        for (let i = 0; i < value.length - 1; i++) {
          (value[i] as any).post = undefined;
        }
        sel.value = value;
        // #region agent log
        try {
          if (process.env.DEBUG_EXTEND_BOOT === 'true') {
            const v = sel.valueOf();
            if (v.includes('.e.e') || (value.length === 2 && value[0]?.valueOf?.() === '.e' && value[1]?.valueOf?.() === '.e')) {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H39',
                location: 'selector-compound.ts:evalNode',
                message: 'compound-eval-exit-components',
                data: {
                  valueOf: v,
                  len: value.length,
                  comps: value.map((c: any) => ({
                    type: c?.type ?? null,
                    v: typeof c?.valueOf === 'function' ? c.valueOf() : null,
                    pre: c?.pre ?? null,
                    post: c?.post ?? null
                  }))
                },
                timestamp: Date.now()
              });
            }
          }
        } catch {}
        // #endregion
        return sel;
      }
    );
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.value.forEach(node => node.toCSS(context, out))
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.sel([', this.location)
  //   const length = this.value.length - 1
  //   this.value.forEach((node, i) => {
  //     node.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const compound = defineType(CompoundSelector, 'CompoundSelector', 'compound');