import { type Combinator } from './combinator.js';
import { type Ampersand } from './ampersand.js';
import {
  type Node,
  defineType
} from './node.js';
import type { Context } from '../context.js';
import { Nil, type Nil as NilType } from './nil.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import type { SimpleSelector } from './selector-simple.js';
import type { CompoundSelector } from './selector-compound.js';

import { type PrintOptions, getPrintOptions, savePrintState, restorePrintState } from './util/print.js';
import { consumeTriviaBetween, emitTriviaTokens } from './util/trivia.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { WARN, toDiagnostic } from '../jess-error.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';

// TODO - fix later
export type ComplexSelectorComponent = SimpleSelector | CompoundSelector | Combinator | Ampersand;
// type SelectorValue = Component[]
export type ComplexSelectorValue = ComplexSelectorComponent[];

const isUnresolvedAmpersand = (part: ComplexSelectorComponent | Nil): part is Ampersand => {
  return isNode(part, N.Ampersand) && !part.getResolvedSelector();
};

const isComplexSelectorComponent = (part: ComplexSelectorComponent | Nil): part is ComplexSelectorComponent => {
  return !isNode(part, N.Nil);
};

const isComplexSelectorComponentNode = (part: Node): part is ComplexSelectorComponent => {
  return part instanceof Selector
    && !isNode(part, N.SelectorList)
    && !isNode(part, N.ComplexSelector);
};

/**
 * Selectors with combinators.
 *
 * @example
 * #id > .class.class
 *
 * @note A complex selector may not always start with a selector. We also use this for a
 * relative selector, which means it may start with a combinator.
 */
export class ComplexSelector extends Selector<ComplexSelectorValue> {
  private ownComponent(component: ComplexSelectorComponent): ComplexSelectorComponent {
    const owned = canReuseLeaf(component) ? reuseLeaf(component) : copyWithReusableLeaves(component);
    if (!isComplexSelectorComponentNode(owned)) {
      throw new TypeError('Expected complex selector component copy');
    }
    return owned;
  }

  private withComponents(
    value: ComplexSelectorValue,
    sourceValue: readonly ComplexSelectorComponent[] = this.value
  ): this {
    const node: this = Reflect.construct(
      this.constructor,
      [
        // Own unchanged source children; evaluated clones may carry runtime state.
        value.map(component => sourceValue.includes(component) ? this.ownComponent(component) : component),
        this._options ? { ...this._options } : undefined,
        this.location,
        this.treeContext
      ]
    );
    if (value.some(component => component.hoistToRoot)) {
      node.hoistToRoot = true;
    }
    return node.inherit(this);
  }

  private renderComplexSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { value } = this;
    let length = value.length;
    const mark = w.mark();
    let isFirstSelector = true;
    const saved = savePrintState(options, ['ampersandFirst']);
    const emitComponent = (component: ComplexSelectorComponent) => {
      const savedBoundaryTrivia = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        if (options.context) {
          component.toTrimmedString(options);
        } else {
          component.toString(options);
        }
      } finally {
        options.suppressBoundaryTrivia = savedBoundaryTrivia;
      }
    };
    for (let i = 0; i < length; i++) {
      let component = value[i]!;
      if (!isNode(component, N.Combinator)) {
        options.ampersandFirst = isFirstSelector;
        isFirstSelector = false;
      }
      if (isNode(component, N.Combinator)) {
        if (isNode(value[i - 1], N.Nil)) {
          continue;
        }
        let co = component.value;
        if (co !== ' ') {
          if (co !== '|') {
            w.add(` ${co} `, component);
          } else {
            w.add(co, component);
          }
        } else {
          const prev = value[i - 1];
          const next = value[i + 1];
          const tokens = options.trivia && prev && next
            ? consumeTriviaBetween(options.trivia, prev, next, options)
            : undefined;
          const coStart = component.location[0];
          const spaceBeforeTrivia = coStart !== undefined
            && tokens?.[0]?.startOffset !== undefined
            && coStart < tokens[0]!.startOffset!;
          if (spaceBeforeTrivia) {
            w.add(' ', component);
          }
          emitTriviaTokens(tokens, options);
          if (!spaceBeforeTrivia) {
            w.add(' ', component);
          }
        }
      } else {
        emitComponent(component);
      }
    }
    restorePrintState(options, saved);
    return w.getSince(mark);
  }

  /**
   * Essentially, a#id.class === a.class#id as being identical selectors,
   * so we normalize groups and combinators
   *
   */
  override valueOf() {
    if (!Array.isArray(this.value)) {
      // Attempt to repair a malformed ComplexSelector that holds a single component directly.
      // We treat the current `value` as a single component.
      const malformedValue = Reflect.get(this, 'value');
      Reflect.set(this, 'value', [malformedValue]);
    }
    return (this._valueOf ??= this.value.map(n => n.valueOf()).join(''));
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
    for (const component of value) {
      if (isNode(component, N.Combinator)) {
        component.keySetLibrary ??= library;
        keySet = keySet.or(component.keySet);
        requiredKeySet = requiredKeySet.or(component.requiredKeySet);
        continue;
      }
      const selector = component as Selector;
      selector.keySetLibrary ??= library;
      keySet = keySet.or(selector.keySet);
      visibleKeySet = visibleKeySet.or(selector.visibleKeySet);
      requiredKeySet = requiredKeySet.or(selector.requiredKeySet);
    }
    this._keySet = keySet;
    this._visibleKeySet = visibleKeySet;
    this._requiredKeySet = requiredKeySet;
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderComplexSyntax(options);
  }

  /**
   * @todo - Re-write and simplify, now that we have a distinct CompoundSelector
   */
  override evalNode(context: Context): MaybePromise<Selector | NilType> {
    attachSelectorBitLibrary(this, context.selectorBits);
    return pipe(
      () => {
        const selector = this;
        const currentValue = selector.value;
        const evaluatedValue: Array<ComplexSelectorComponent | Nil> = [...currentValue];
        const maybe = serialForEach(evaluatedValue, (sel, i) => {
          const out = sel.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Selector | Nil>).then((res) => {
              evaluatedValue[i] = res as ComplexSelectorComponent | Nil;
              return undefined;
            });
          }
          evaluatedValue[i] = out as ComplexSelectorComponent | Nil;
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => [selector, currentValue, evaluatedValue] as const);
        }
        return [selector, currentValue, evaluatedValue] as const;
      },
      ([selector, currentValue, evaluatedValue]) => {
        let value = [...evaluatedValue];
        const unresolvedAmpersands = value.filter(isUnresolvedAmpersand);
        const hasOtherSelectorParts = value.some((part) => {
          return !isNode(part, N.Combinator) && !isNode(part, N.Nil) && !isNode(part, N.Ampersand);
        });
        if (hasOtherSelectorParts && unresolvedAmpersands.length > 0) {
          for (const amp of unresolvedAmpersands) {
            const file = amp.treeContext?.file;
            const selectorText = String(selector.valueOf?.() ?? '&');
            context.warnings.push(toDiagnostic(WARN.parentlessAmpersand({
              ctx: file ? { file } : undefined,
              filePath: file?.fullPath,
              line: amp.location?.[1],
              column: amp.location?.[2],
              meta: { selector: selectorText }
            })));
          }
        }
        value = value.filter((part) => {
          if (isNode(part, N.Nil)) {
            return false;
          }
          if (hasOtherSelectorParts && isUnresolvedAmpersand(part)) {
            return false;
          }
          return true;
        });
        value = value.filter((part, i) => {
          if (!isNode(part, N.Combinator)) {
            return true;
          }
          const prev = value[i - 1];
          const next = value[i + 1];
          if (i === 0) {
            return Boolean(next && !isNode(next, N.Combinator));
          }
          return Boolean(prev && next && !isNode(prev, N.Combinator) && !isNode(next, N.Combinator));
        });
        if (value.length === 0) {
          return new Nil().inherit(selector);
        }
        if (value.length === 1) {
          const only = value[0]!.inherit(selector);
          if (selector.hoistToRoot) {
            Reflect.set(only, 'hoistToRoot', true);
          }
          return only;
        }
        const changed = (
          value.length !== currentValue.length
          || value.some((part, idx) => part !== currentValue[idx])
        );
        if (!changed) {
          return selector;
        }
        return selector.withComponents(value.filter(isComplexSelectorComponent), currentValue);
      }
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    attachSelectorBitLibrary(this, context.selectorBits);
    return pipe(
      () => {
        const selector = this;
        const currentValue = selector.value;
        const resolvedValue: Array<ComplexSelectorComponent | Nil> = [...currentValue];
        const maybe = serialForEach(resolvedValue, (sel, i) => {
          const out = sel.resolve(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then((res) => {
              if (res instanceof Selector || res instanceof Nil) {
                resolvedValue[i] = res as ComplexSelectorComponent | Nil;
              }
              return undefined;
            });
          }
          if (out instanceof Selector || out instanceof Nil) {
            resolvedValue[i] = out as ComplexSelectorComponent | Nil;
          }
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => [selector, currentValue, resolvedValue] as const);
        }
        return [selector, currentValue, resolvedValue] as const;
      },
      ([selector, currentValue, resolvedValue]) => {
        let value = [...resolvedValue];
        const unresolvedAmpersands = value.filter(isUnresolvedAmpersand);
        const hasOtherSelectorParts = value.some((part) => {
          return !isNode(part, N.Combinator) && !isNode(part, N.Nil) && !isNode(part, N.Ampersand);
        });
        if (hasOtherSelectorParts && unresolvedAmpersands.length > 0) {
          for (const amp of unresolvedAmpersands) {
            const file = amp.treeContext?.file;
            const selectorText = String(selector.valueOf?.() ?? '&');
            context.warnings.push(toDiagnostic(WARN.parentlessAmpersand({
              ctx: file ? { file } : undefined,
              filePath: file?.fullPath,
              line: amp.location?.[1],
              column: amp.location?.[2],
              meta: { selector: selectorText }
            })));
          }
        }
        value = value.filter((part) => {
          if (isNode(part, N.Nil)) {
            return false;
          }
          if (hasOtherSelectorParts && isUnresolvedAmpersand(part)) {
            return false;
          }
          return true;
        });
        value = value.filter((part, i) => {
          if (!isNode(part, N.Combinator)) {
            return true;
          }
          const prev = value[i - 1];
          const next = value[i + 1];
          if (i === 0) {
            return Boolean(next && !isNode(next, N.Combinator));
          }
          return Boolean(prev && next && !isNode(prev, N.Combinator) && !isNode(next, N.Combinator));
        });
        if (value.length === 0) {
          return new Nil().inherit(selector);
        }
        if (value.length === 1) {
          const only = value[0]!.inherit(selector);
          if (selector.hoistToRoot) {
            Reflect.set(only, 'hoistToRoot', true);
          }
          return only;
        }
        const changed = (
          value.length !== currentValue.length
          || value.some((part, idx) => part !== currentValue[idx])
        );
        if (!changed) {
          return selector;
        }
        return selector.withComponents(value.filter(isComplexSelectorComponent), currentValue);
      }
    );
  }
  // override async evalNode(context: Context): Promise<ComplexSelector | SelectorList | Nil> {
  //   let elements = [...selector.value] as ComplexSelectorValue
  //   selector.value = elements

  //   let collapseNesting = context.opts.collapseNesting
  //   if (collapseNesting) {
  //     let hasAmp = elements.find(el => el instanceof Ampersand)
  //     /**
  //      * Try to evaluate all selectors as if they are prepended by `&`
  //      */
  //     if (!hasAmp && context.rulesetFrames.length > 0) {
  //       if (elements[0] instanceof Combinator) {
  //         elements.unshift(new Ampersand())
  //       } else {
  //         elements.unshift(new Ampersand(), new Combinator(' '))
  //       }
  //     }
  //   }

  //   for (let [sel, i] of getEntries(selector.value)) {
  //     selector.value[i] = await sel.eval(context) as ComplexSelectorComponent
  //   }

  //   let cleanElements = (elements: Array<Selector | Combinator | Nil>): ComplexSelectorValue => {
  //     let elementsLength = elements.length
  //     for (let i = 0; i < elementsLength; i++) {
  //       let value = elements[i]!

  //       if (
  //         i === 0
  //         && (
  //           (
  //             value instanceof ComplexSelector
  //             && value.value.length === 0
  //           )
  //           || value instanceof Nil
  //           || (collapseNesting && (value instanceof Ampersand || value instanceof Combinator))
  //         )
  //       ) {
  //         elements.shift()
  //         elementsLength -= 1
  //         i -= 1
  //       /**
  //        * @note The following two can occur because of evaluation of `&`
  //        */
  //       } else if (value instanceof ComplexSelector) {
  //         elements = elements.slice(0, i).concat(value.value).concat(elements.slice(i + 1))
  //         elementsLength += value.value.length - 1
  //       } else if (isNode(value, 'SelectorList') && elementsLength > 1) {
  //         /**
  //          * Wrap returned lists with :is(), if
  //          * there are more elements in the sequence
  //          */
  //         elements[i] = new PseudoSelector({
  //           name: ':is',
  //           arg: value
  //         })
  //       }
  //     }
  //     return elements as ComplexSelectorValue
  //     // This can/should only happen with compound selectors
  //     // elements.sort((a, b) => {
  //     //   const aVal = a instanceof BasicSelector && a.isTag ? -1 : 0
  //     //   const bVal = b instanceof BasicSelector && b.isTag ? -1 : 0
  //     //   return aVal - bVal
  //     // })
  //   }

  //   /** @todo - Selector lists can have basic selectors */
  //   if (isNode(selector, 'SelectorList')) {
  //     selector.value.forEach(sel => { (sel).value = cleanElements(sel.value) })
  //   } else {
  //     selector.value = cleanElements(selector.value)
  //   }

  //   if (elements.length === 0) {
  //     return new Nil()
  //   }
  //   return selector
  // }

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

type SelectorParams = ConstructorParameters<typeof ComplexSelector>;

export const sel = defineType<ComplexSelectorValue>(ComplexSelector, 'ComplexSelector', 'sel') as (
  value: ComplexSelectorValue,
  options?: SelectorParams[1],
  location?: SelectorParams[2],
  treeContext?: SelectorParams[3]
) => ComplexSelector;
