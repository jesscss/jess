import {
  type Node,
  defineType
} from './node.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions, savePrintState, restorePrintState } from './util/print.js';
import { consumeTrivia, emitTriviaTokens } from './util/trivia.js';
import { canReuseLeaf, copyOwnedWithReusableLeaves, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';

/**
 * @example
 * .class#id
 *
 * Must have at least 2 selectors. Otherwise it would be collapsed.
 */
/** Anything other than type (element) or universal, which must come first */
const nonElementRegex = /^[.#:[]/;

function emitCompoundPart(
  part: SimpleSelector,
  options: ReturnType<typeof getPrintOptions>,
  emitLeadingTrivia: boolean
): void {
  if (emitLeadingTrivia && options.trivia) {
    emitTriviaTokens(
      consumeTrivia(options.trivia, part.location[0], 'before', options),
      options,
      { skipLeadingWhitespace: true }
    );
  }
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = 'pre';
  try {
    part.toString(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

export class CompoundSelector extends Selector<SimpleSelector[]> {
  private ownSelector(item: Selector): Selector {
    const owned = canReuseLeaf(item) ? reuseLeaf(item) : copyWithReusableLeaves(item);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned;
  }

  private withComponents(value: Selector[], sourceValue: readonly Selector[] = this.value): this {
    const node: this = Reflect.construct(
      this.constructor,
      [
        // Own unchanged source children; evaluated clones may carry runtime state.
        value.map(item => sourceValue.includes(item) ? this.ownSelector(item) : item),
        this._options ? { ...this._options } : undefined,
        this.location,
        this.treeContext
      ]
    );
    if (value.some(item => item.hoistToRoot)) {
      node.hoistToRoot = true;
    }
    return node.inherit(this);
  }

  private collapsedSelector(item: Selector, sourceValue: readonly Selector[]): Selector {
    if (!sourceValue.includes(item)) {
      return item.inherit(this);
    }
    const owned = copyOwnedWithReusableLeaves(item);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned.inherit(this);
  }

  private renderCompoundSyntax(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const value = this.value;
    const w = printOptions.writer;
    const mark = w.mark();
    const saved = savePrintState(printOptions, ['ampersandFirst']);
    for (let i = 0; i < value.length; i++) {
      printOptions.ampersandFirst = (i === 0);
      emitCompoundPart(value[i]!, printOptions, i > 0);
    }
    restorePrintState(printOptions, saved);
    return w.getSince(mark);
  }

  protected override computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    const library = this._requireKeySetLibrary();
    const { value } = this;
    let keySet = library.getBitset();
    let visibleKeySet = library.getBitset();
    let requiredKeySet = library.getBitset();
    for (const selector of value) {
      selector.keySetLibrary ??= library;
      keySet = keySet.or(selector.keySet);
      visibleKeySet = visibleKeySet.or(selector.visibleKeySet);
      requiredKeySet = requiredKeySet.or(selector.requiredKeySet);
    }
    this._keySet = keySet;
    this._visibleKeySet = visibleKeySet;
    this._requiredKeySet = requiredKeySet;
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
    return this.renderCompoundSyntax(options);
  }

  override evalNode(context: Context): MaybePromise<CompoundSelector | Selector | Nil> {
    attachSelectorBitLibrary(this, context.selectorBits);
    return pipe(
      () => {
        const sel = this;
        const currentValue = sel.value;
        const evaluatedValue: Array<Selector | Nil> = [...currentValue];
        const maybe = serialForEach(evaluatedValue, (item, i) => {
          const out = item.eval(context);
          if (isThenable(out)) {
            return out.then((res) => {
              evaluatedValue[i] = res;
              return undefined;
            });
          }
          evaluatedValue[i] = out;
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => [sel, currentValue, evaluatedValue] as const);
        }
        return [sel, currentValue, evaluatedValue] as const;
      },
      ([sel, currentValue, evaluatedValue]) => {
        let value = evaluatedValue.filter((n): n is Selector => n && !(n instanceof Nil));
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
          return this.collapsedSelector(value[0]!, currentValue);
        }
        const changed = (
          value.length !== currentValue.length
          || value.some((part, idx) => part !== currentValue[idx])
        );
        if (!changed) {
          return sel;
        }
        return sel.withComponents(value, currentValue);
      }
    );
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    return pipe(
      () => {
        const sel = this;
        const currentValue = sel.value;
        const resolvedValue: Array<Selector | Nil> = [...currentValue];
        const maybe = serialForEach(resolvedValue, (item, i) => {
          const out = item.resolve(context);
          if (isThenable(out)) {
            return out.then((res) => {
              if (res instanceof Selector || res instanceof Nil) {
                resolvedValue[i] = res;
              }
              return undefined;
            });
          }
          if (out instanceof Selector || out instanceof Nil) {
            resolvedValue[i] = out;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => [sel, currentValue, resolvedValue] as const);
        }
        return [sel, currentValue, resolvedValue] as const;
      },
      ([sel, currentValue, resolvedValue]) => {
        let value = resolvedValue.filter((n): n is Selector => n && !(n instanceof Nil));
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
          return this.collapsedSelector(value[0]!, currentValue);
        }
        const changed = (
          value.length !== currentValue.length
          || value.some((part, idx) => part !== currentValue[idx])
        );
        if (!changed) {
          return sel;
        }
        return sel.withComponents(value, currentValue);
      }
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveForRender(context);
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
