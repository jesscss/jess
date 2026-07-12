import {
  defineType,
  type Node
} from './node.js';
import { SimpleSelector } from './selector-simple.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { attachSelectorBitLibrary, Selector } from './selector.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { consumeTriviaBetweenOffsets, emitTriviaTokens } from './util/trivia.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

function normalizeSelectorArg(text: string): string {
  return text.replace(/\n\s*/g, ' ').trim();
}

export type PseudoSelectorValue = {
  /**
   * The name of the pseudo-selector
   * @note - this will contain the `:` prefix,
   * to support `::before` and `::after`
   */
  name: string;
  arg?: Node;
  generatedPseudoPlacementOverride?: GeneratedPseudoPlacementOverrideState;
};

type GeneratedPseudoPlacementOverrideState = {
  omitWrapperForSingleSelectorList?: boolean;
};

function setGeneratedPseudoPlacementOverride(
  source: PseudoSelector,
  override: GeneratedPseudoPlacementOverrideState
): void {
  source.generatedPseudoPlacementOverride = override;
}

function createEvaluatedPseudoSelector(
  source: PseudoSelector,
  arg: Node
): PseudoSelector {
  const node = new PseudoSelector(
    {
      name: source.name,
      arg,
      generatedPseudoPlacementOverride: source.generatedPseudoPlacementOverride
    },
    source.options ? { ...source.options } : undefined,
    source.location.length === 6 ? source.location : undefined,
    source.sourceRoot?._treeContext
  ).inherit(source);
  node.generated = source.generated;
  return node;
}

function isSelectorNode(node: Node | undefined): node is Selector {
  return isNode(node, N.Selector);
}

/**
 * A pseudo selector
 * @see https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Selectors/Pseudo-classes_and_pseudo-elements
 *   e.g. :hover, :focus, :active
*/
export class PseudoSelector extends SimpleSelector<PseudoSelectorValue> {
  static override childKeys = ['name', 'arg'] as const;

  readonly name: string;
  arg: Node | undefined;
  generatedPseudoPlacementOverride: GeneratedPseudoPlacementOverrideState | undefined;

  constructor(
    value: PseudoSelectorValue,
    options?: ConstructorParameters<typeof SimpleSelector<PseudoSelectorValue>>[1],
    location?: ConstructorParameters<typeof SimpleSelector<PseudoSelectorValue>>[2],
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.name = value.name;
    this.arg = value.arg;
    this.generatedPseudoPlacementOverride = value.generatedPseudoPlacementOverride;
  }

  private renderPseudoSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name } = this;
    const { arg } = this;
    const mark = w.mark();
    const selectorArg = isSelectorNode(arg) ? arg : undefined;
    if (this.generated && name === ':is' && selectorArg && this.generatedPseudoPlacementOverride) {
      const generatedOverride = this.generatedPseudoPlacementOverride;
      if (this.keySetLibrary) {
        attachSelectorBitLibrary(selectorArg, this.keySetLibrary);
      }
      const omitGeneratedWrapper = generatedOverride.omitWrapperForSingleSelectorList === true
        && (!isNode(selectorArg, N.SelectorList) || selectorArg.value.length === 1);
      if (omitGeneratedWrapper) {
        selectorArg.toString(options);
        return w.getSince(mark);
      }
      const argMark = w.mark();
      selectorArg.toString(options);
      w.replaceSince(argMark, normalizeSelectorArg, selectorArg);
      const out = w.getSince(argMark);
      w.restore(argMark);
      w.add(name, this);
      w.add('(');
      w.add(out, selectorArg);
      w.add(')');
      return w.getSince(mark);
    }
    w.add(name, this);
    if (arg) {
      w.add('(');
      if (Array.isArray(arg)) {
        // Generic (unknown-pseudo) argument: a raw component array. Emit each
        // component, recovering trivia between them from this node's valueSpans.
        // A ' ' descendant combinator carries no own text — its surrounding
        // trivia (whitespace + comments) spans from the previous part's end to
        // the next part's start, so recover it across the combinator rather than
        // emitting a bare space (mirrors ComplexSelector.toString).
        const spans = this.valueSpans;
        for (let i = 0; i < arg.length; i++) {
          const part = arg[i];
          if (part === ' ') {
            const run = (options.trivia && spans)
              ? consumeTriviaBetweenOffsets(options.trivia, spans[(i - 1) * 3 + 1], spans[(i + 1) * 3], options)
              : undefined;
            if (run) {
              emitTriviaTokens(run, options);
            } else {
              w.add(' ', this);
            }
            continue;
          }
          // Recover trivia before this part — unless the previous part was a ' '
          // combinator, which already consumed the trivia up to this part's start.
          if (i > 0 && arg[i - 1] !== ' ' && options.trivia && spans) {
            emitTriviaTokens(
              consumeTriviaBetweenOffsets(options.trivia, spans[(i - 1) * 3 + 1], spans[i * 3], options),
              options
            );
          }
          if (typeof part === 'string') {
            w.add(part, this);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          } else if (part && typeof (part as Node).toString === 'function') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            (part as Node).toString(options);
          }
        }
      } else if (isNode(arg, N.Sequence)) {
        // Unknown-pseudo arg stored as Sequence for AST serialization.
        // Render each Any item inline (no separators), using valueSpans for trivia.
        const seqItems = arg.value;
        const spans = this.valueSpans;
        let srcIdx = 0;
        let prevWasSpace = false;
        for (let i = 0; i < seqItems.length; i++) {
          const item = seqItems[i]!;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const itemStr = (item as unknown as { value?: unknown }).value;
          if (itemStr === ' ') {
            const run = (options.trivia && spans)
              ? consumeTriviaBetweenOffsets(options.trivia, spans[(srcIdx - 1) * 3 + 1], spans[(srcIdx + 1) * 3], options)
              : undefined;
            if (run) {
              emitTriviaTokens(run, options);
            } else {
              w.add(' ', this);
            }
            srcIdx++;
            prevWasSpace = true;
            continue;
          }
          if (srcIdx > 0 && !prevWasSpace && options.trivia && spans) {
            emitTriviaTokens(
              consumeTriviaBetweenOffsets(options.trivia, spans[(srcIdx - 1) * 3 + 1], spans[srcIdx * 3], options),
              options
            );
          }
          if (typeof itemStr === 'string') {
            w.add(itemStr, this);
          } else {
            item.toString(options);
          }
          srcIdx++;
          prevWasSpace = false;
        }
      } else if (isNode(arg, N.SelectorList)) {
        const argMark = w.mark();
        arg.toString(options);
        w.replaceSince(argMark, normalizeSelectorArg, arg);
      } else {
        arg.toString(options);
      }
      w.add(')');
    }
    return w.getSince(mark);
  }

  override computeKeySets(): void {
    if (this._keySet && this._visibleKeySet && this._requiredKeySet) {
      return;
    }
    const { name } = this;
    const { arg } = this;
    const library = this._requireKeySetLibrary();
    if (isNode(arg, N.Selector)) {
      arg.keySetLibrary ??= library;
      if (name === ':is') {
        this._keySet = arg.keySet;
        this._visibleKeySet = arg.visibleKeySet;
        if (isNode(arg, N.SelectorList)) {
          const omitGeneratedWrapper = this.generated
            && this.generatedPseudoPlacementOverride?.omitWrapperForSingleSelectorList === true
            && arg.value.length === 1;
          const firstItem = arg.value[0]!;
          this._requiredKeySet = omitGeneratedWrapper && typeof firstItem !== 'string'
            ? firstItem.requiredKeySet
            : library.getBitset();
        } else {
          this._requiredKeySet = arg.requiredKeySet;
        }
      } else {
        let pos = library.add(name);
        let keySet = this._keySet = arg.keySet.clone();
        let visibleKeySet = this._visibleKeySet = arg.visibleKeySet.clone();
        keySet.set(pos, 1);
        visibleKeySet.set(pos, 1);
        this._requiredKeySet = arg.requiredKeySet.clone();
        this._requiredKeySet.set(pos, 1);
      }
    } else {
      this._keySet = library.getBitset([this.valueOf()]);
      this._visibleKeySet = this._keySet;
      this._requiredKeySet = this._keySet;
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.renderPseudoSyntax(options);
  }

  override valueOf(): string {
    let valueOf = this._valueOf;
    if (!valueOf) {
      const { name } = this;
      const { arg } = this;
      // For :is() with SelectorList, use valueOf() to avoid newlines

      /**
       * Normalizes :nth-child(n + 1) to match :nth-child(n+1)
       * That is, anything that doesn't hold a selector as a value
       * is, by definition, not space-sensitive.
       *
       * @todo 1n === n, 2n + 0 === 2n
       */
      valueOf = `${name}${arg ? `(${arg.valueOf()})` : ''}`;

      this._valueOf = valueOf;
    }
    return valueOf;
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const currentArg = this.arg;
    const clonedArg = cloneFn && currentArg ? cloneFn(currentArg) : currentArg;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const cloned = new PseudoSelector(
      {
        name: this.name,
        arg: clonedArg,
        generatedPseudoPlacementOverride: this.generatedPseudoPlacementOverride
      },
      this._options ? { ...this._options } : undefined,
      this._location?.length ? this._location : undefined,
      this._treeContext
    ).inherit(this) as this;
    cloned.keySetLibrary = this.keySetLibrary;
    return cloned;
  }

  override evalNode(context: Context): MaybePromise<PseudoSelector> {
    attachSelectorBitLibrary(this, context.selectorBits);
    const currentArg = this.arg;
    if (!currentArg) {
      return this;
    }
    context.parenFrames.push(false);
    try {
      const evaluatedArg = currentArg.eval(context);
      if (isThenable(evaluatedArg)) {
        return (evaluatedArg as Promise<Node>).then(
          (arg) => {
            context.parenFrames.pop();
            return this.finalizeEvaluatedArg(context, currentArg, arg);
          },
          (error) => {
            context.parenFrames.pop();
            throw error;
          }
        );
      }
      context.parenFrames.pop();
      return this.finalizeEvaluatedArg(context, currentArg, evaluatedArg as Node);
    } catch (error) {
      context.parenFrames.pop();
      throw error;
    }
  }

  private finalizeEvaluatedArg(context: Context, currentArg: Node, evaluatedArg: Node): PseudoSelector {
    if (evaluatedArg === currentArg) {
      return this;
    }
    const node = createEvaluatedPseudoSelector(this, evaluatedArg);
    if (
      this.generated
      && (
        isNode(currentArg, N.SelectorList)
        || isNode(evaluatedArg, N.SelectorList)
        || (evaluatedArg !== currentArg && isNode(evaluatedArg, N.Selector))
      )
    ) {
      setGeneratedPseudoPlacementOverride(node, {
        omitWrapperForSingleSelectorList: true
      });
    }
    attachSelectorBitLibrary(node, context.selectorBits);
    return node;
  }

  override resolve(context: Context): MaybePromise<PseudoSelector> {
    return this.evalNode(context);
  }
}

// Some experiments with type narrowing
// type SelectorValue = {
//   value: ':is' | ':where'
//   arg: Selector
// }

// type PseudoFunctionValue = {
//   value: string
//   arg: Node
// }

// type GetType<T extends Array<[string, any]>> = TupleToUnion<{
//   [K in keyof T]: T[K][0] extends 'arg'
//     ? T[K][1]
//     : never
// }>

// type PseudoFunctionClass<T extends PseudoFunctionValue = PseudoFunctionValue> =
//   Class<PseudoSelector<T>, ConstructorParameters<typeof PseudoSelector<T>>>

// export const PseudoFunction = PseudoSelector as unknown as (new<const T extends Array<[string, any]>>(value: T, opts?: NodeOptions) => Omit<PseudoFunctionClass, 'arg'> & { arg: GetType<T> }) // Omit<PseudoFunctionClass, 'arg'> & GetType<T>)

// const foo = new PseudoFunction([
//   ['value', ':is'],
//   ['arg', new BasicSelector([['value', 'div']])]
// ])
// foo.arg

export const pseudo = defineType<PseudoSelectorValue, typeof PseudoSelector>(PseudoSelector, 'PseudoSelector', 'pseudo');

export function createGeneratedIsPseudo(
  arg: Selector,
  override?: GeneratedPseudoPlacementOverrideState
): PseudoSelector {
  const node = pseudo({
    name: ':is',
    arg
  });
  node.generated = true;
  setGeneratedPseudoPlacementOverride(node, {
    omitWrapperForSingleSelectorList: override?.omitWrapperForSingleSelectorList ?? isNode(arg, N.SelectorList)
  });
  return node;
}

/**
 * Convenience function to create a :is() pseudo-selector
 * @param arg The selector that goes inside :is()
 * @returns A PseudoSelector with name ":is" and the provided selector as argument
 */
export function is(arg: Selector): PseudoSelector {
  return pseudo({
    name: ':is',
    arg: arg
  });
}
