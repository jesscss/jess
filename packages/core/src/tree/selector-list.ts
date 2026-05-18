import {
  type Node,
  defineType,
  F_EXTENDED,
  F_EXTEND_TARGET
} from './node.js';
import { type Context } from '../context.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';

import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { selectorCompare } from './util/compare.js';
import {
  consumeTrivia,
  emitCommentTriviaBeforeDelimiter,
  emitTriviaTokens
} from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';

function emitSelectorListItem(
  item: Selector,
  options: ReturnType<typeof getPrintOptions>,
  suppressPre = false
): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = suppressPre ? 'both' : 'post';
  try {
    item.toString(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

/** Constructs */
export class SelectorList extends Selector<Selector[]> {
  private ownSelector(item: Selector): Selector {
    const owned = canReuseLeaf(item) ? reuseLeaf(item) : copyWithReusableLeaves(item);
    if (!(owned instanceof Selector)) {
      throw new TypeError('Expected selector copy');
    }
    return owned;
  }

  private withSelectors(value: Selector[], sourceValue: readonly Selector[] = this.value): this {
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
    return node.inherit(this);
  }

  private renderSelectorListSyntax(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer;
    let depth = printOptions.depth;
    let space = ''.padStart(depth * 2);
    const value: Selector[] = [];
    for (const item of this.value) {
      if (isNode(item, N.PseudoSelector) && item.value.name === ':is') {
        const arg = item.value.arg;
        if (arg && isNode(arg, N.SelectorList)) {
          value.push(...arg.value);
          continue;
        }
      }
      if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
        const only = item.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
          const arg = only.value.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.value);
            continue;
          }
        }
      }
      if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
        const only = item.value[0]!;
        if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
          const arg = only.value.arg;
          if (arg && isNode(arg, N.SelectorList)) {
            value.push(...arg.value);
            continue;
          }
        }
      }
      value.push(item);
    }
    if (
      printOptions.referenceMode === true
      && printOptions.referenceRenderEnabled === true
      && printOptions.referenceFilterTargets === true
    ) {
      const extendedOnly = value.filter(item =>
        item.hasFlag(F_EXTENDED) && !item.hasFlag(F_EXTEND_TARGET)
      );
      if (extendedOnly.length > 0) {
        value.splice(0, value.length, ...extendedOnly);
      }
    }
    let length = value.length;
    if (length === 0) {
      return '';
    }
    const mark = w.mark();
    let item = value[0]!;

    emitSelectorListItem(item, printOptions);

    for (let i = 1; i < length; i++) {
      const prevItem = item;
      item = value[i]!;
      emitCommentTriviaBeforeDelimiter(prevItem, item, printOptions);
      w.add(`,\n${space}`);
      if (printOptions.trivia) {
        emitTriviaTokens(
          consumeTrivia(printOptions.trivia, item.location[0], 'before', printOptions),
          printOptions,
          { skipLeadingWhitespace: true }
        );
      }
      emitSelectorListItem(item, printOptions, true);
    }
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
    for (const selector of value) {
      selector.keySetLibrary ??= library;
      keySet = keySet.or(selector.keySet);
      visibleKeySet = visibleKeySet.or(selector.visibleKeySet);
    }
    this._keySet = keySet;
    this._visibleKeySet = visibleKeySet;
    // SelectorLists represent alternatives - requiredKeySet is empty
    // (any branch could match, so no single key is "required")
    this._requiredKeySet = library.getBitset();
  }

  /** Normalize selectors on separate lines with indentation */
  override toTrimmedString(options?: PrintOptions) {
    return this.renderSelectorListSyntax(options);
  }

  override valueOf() {
    const itemValues = this.value.map(item => item.valueOf());
    return itemValues.join(',');
  }

  override compare(b: Selector): 0 | 1 | -1 | undefined {
    if (!isNode(b, N.Selector)) {
      return super.compare(b);
    }
    const semantic = selectorCompare(this, b);
    if (semantic.isEquivalent) {
      return 0;
    }
    return super.compare(b);
  }

  override evalNode(context: Context): MaybePromise<SelectorList | Selector> {
    attachSelectorBitLibrary(this, context.selectorBits);
    return pipe(
      () => {
        const list = this;
        const currentValue = list.value;
        const evaluatedValue = [...currentValue];
        const maybe = serialForEach(evaluatedValue, (item, i) => {
          const out = item.eval(context);
          if (isThenable(out)) {
            return Promise.resolve(out).then((res) => {
              if (isNode(res, N.Selector)) {
                evaluatedValue[i] = res;
              }
              return undefined;
            });
          }
          if (isNode(out, N.Selector)) {
            evaluatedValue[i] = out;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => [list, currentValue, evaluatedValue] as const);
        }
        return [list, currentValue, evaluatedValue] as const;
      },
      ([list, currentValue, evaluatedValue]) => {
        // Flatten top-level `:is(a, b)` items into the selector list.
        // This is safe in SelectorList context (it is equivalent to `a, b`).
        const flattened: Selector[] = [];
        for (const item of evaluatedValue) {
          if (isNode(item, N.PseudoSelector) && item.value.name === ':is') {
            const arg = item.value.arg;
            if (arg && isNode(arg, N.SelectorList)) {
              flattened.push(...arg.value);
              continue;
            }
          }
          if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
              const arg = only.value.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
              const arg = only.value.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          flattened.push(item);
        }
        if (flattened.length === 1) {
          return flattened[0]!;
        }
        const changed = (
          flattened.length !== currentValue.length
          || flattened.some((item, idx) => item !== currentValue[idx])
        );
        if (!changed) {
          return list;
        }
        return list.withSelectors(flattened, currentValue);
      }
    );
  }

  protected override resolveForRender(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    return pipe(
      () => {
        const list = this;
        const currentValue = list.value;
        const resolvedValue = [...currentValue];
        const maybe = serialForEach(resolvedValue, (item, i) => {
          const out = item.resolve(context);
          if (isThenable(out)) {
            return Promise.resolve(out).then((res) => {
              if (isNode(res, N.Selector)) {
                resolvedValue[i] = res;
              }
              return undefined;
            });
          }
          if (isNode(out, N.Selector)) {
            resolvedValue[i] = out;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => [list, currentValue, resolvedValue] as const);
        }
        return [list, currentValue, resolvedValue] as const;
      },
      ([list, currentValue, resolvedValue]) => {
        const flattened: Selector[] = [];
        for (const item of resolvedValue) {
          if (isNode(item, N.PseudoSelector) && item.value.name === ':is') {
            const arg = item.value.arg;
            if (arg && isNode(arg, N.SelectorList)) {
              flattened.push(...arg.value);
              continue;
            }
          }
          if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
              const arg = only.value.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
            const only = item.value[0]!;
            if (isNode(only, N.PseudoSelector) && only.value.name === ':is') {
              const arg = only.value.arg;
              if (arg && isNode(arg, N.SelectorList)) {
                flattened.push(...arg.value);
                continue;
              }
            }
          }
          flattened.push(item);
        }
        if (flattened.length === 1) {
          return flattened[0]!;
        }
        const changed = (
          flattened.length !== currentValue.length
          || flattened.some((item, idx) => item !== currentValue[idx])
        );
        if (!changed) {
          return list;
        }
        return list.withSelectors(flattened, currentValue);
      }
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveForRender(context);
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist');
