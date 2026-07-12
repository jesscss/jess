import { sourceSpanOf, spanStartOf, spanEndOf } from './util/provenance.js';
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
import { commentRunsWithinSpan, emitNextSpanComment } from './util/trivia.js';
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

/**
 * PseudoSelector-local flag bits. Live in their own int (not base `flags`) so
 * the shared cross-node flag read isn't widened by pseudo-only state.
 * `F_PSEUDO_PLACEMENT_OVERRIDE` marks a generated `:is()` placement override
 * (the old truthy `generatedPseudoPlacementOverride` object); `F_PSEUDO_OMIT_WRAPPER`
 * carries the single `omitWrapperForSingleSelectorList` boolean that object held.
 */
const F_PSEUDO_PLACEMENT_OVERRIDE = 0b1;
const F_PSEUDO_OMIT_WRAPPER = 0b10;

// The override object held exactly one boolean and was never mutated after
// creation, so two frozen singletons cover every value — the getter hands one
// back instead of allocating a fresh object per generated `:is()`.
const PLACEMENT_OVERRIDE_OMIT: GeneratedPseudoPlacementOverrideState = Object.freeze({ omitWrapperForSingleSelectorList: true });
const PLACEMENT_OVERRIDE_KEEP: GeneratedPseudoPlacementOverrideState = Object.freeze({ omitWrapperForSingleSelectorList: false });

function setGeneratedPseudoPlacementOverride(
  source: PseudoSelector,
  override: GeneratedPseudoPlacementOverrideState
): void {
  let flags = (source.pseudoFlags ?? 0) | F_PSEUDO_PLACEMENT_OVERRIDE;
  if (override.omitWrapperForSingleSelectorList === true) {
    flags |= F_PSEUDO_OMIT_WRAPPER;
  } else {
    flags &= ~F_PSEUDO_OMIT_WRAPPER;
  }
  source.pseudoFlags = flags;
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
    sourceSpanOf(source),
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
  /**
   * Rare: only set on generated `:is()` wrappers (see `setGeneratedPseudoPlacementOverride`).
   * `declare` + conditional ctor assignment so the common pseudo shape (`:hover`,
   * `:focus`, ...) carries NO own slot for it — the eager `= undefined` used to add
   * a hidden-class slot to every one of ~3000 instances in the collapse census.
   */
  declare pseudoFlags?: number;

  /**
   * Back-compat view of the old rare `{ omitWrapperForSingleSelectorList }` field,
   * now packed into `pseudoFlags`. Returns a shared frozen singleton (no per-read
   * alloc) so the external structural read in `selector-analysis.ts` keeps working.
   */
  get generatedPseudoPlacementOverride(): GeneratedPseudoPlacementOverrideState | undefined {
    const flags = this.pseudoFlags;
    if (flags === undefined || (flags & F_PSEUDO_PLACEMENT_OVERRIDE) === 0) {
      return undefined;
    }
    return (flags & F_PSEUDO_OMIT_WRAPPER) !== 0
      ? PLACEMENT_OVERRIDE_OMIT
      : PLACEMENT_OVERRIDE_KEEP;
  }

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
    if (value.generatedPseudoPlacementOverride !== undefined) {
      setGeneratedPseudoPlacementOverride(this, value.generatedPseudoPlacementOverride);
    }
  }

  private renderPseudoSyntax(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name } = this;
    const { arg } = this;
    const mark = w.mark();
    const selectorArg = isSelectorNode(arg) ? arg : undefined;
    const pseudoFlags = this.pseudoFlags ?? 0;
    if (this.generated && name === ':is' && selectorArg && (pseudoFlags & F_PSEUDO_PLACEMENT_OVERRIDE) !== 0) {
      if (this.keySetLibrary) {
        attachSelectorBitLibrary(selectorArg, this.keySetLibrary);
      }
      const omitGeneratedWrapper = (pseudoFlags & F_PSEUDO_OMIT_WRAPPER) !== 0
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
        // Generic (unknown-pseudo) argument: a raw component array. String
        // components carry no own source span, so authored inter-component
        // whitespace is normalized; COMMENTS in those gaps still round-trip.
        // Pull the in-span comment runs in source order and place one at each
        // gap (combinator or adjacent-part boundary), mirroring ComplexSelector.
        const spanComments = options.trivia
          ? commentRunsWithinSpan(options.trivia, spanStartOf(this), spanEndOf(this))
          : [];
        let cursor = 0;
        for (let i = 0; i < arg.length; i++) {
          const part = arg[i];
          if (part === ' ') {
            if (cursor < spanComments.length) {
              cursor = emitNextSpanComment(spanComments, cursor, options);
            } else {
              w.add(' ', this);
            }
            continue;
          }
          // Emit a comment authored before this part — unless the previous part
          // was a ' ' combinator, which already emitted the gap comment.
          if (i > 0 && arg[i - 1] !== ' ' && cursor < spanComments.length) {
            cursor = emitNextSpanComment(spanComments, cursor, options);
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
        // Render each Any item inline; comments between items round-trip via the
        // in-span comment runs, inter-item whitespace is normalized.
        const seqItems = arg.value;
        const spanComments = options.trivia
          ? commentRunsWithinSpan(options.trivia, spanStartOf(this), spanEndOf(this))
          : [];
        let cursor = 0;
        let prevWasSpace = false;
        for (let i = 0; i < seqItems.length; i++) {
          const item = seqItems[i]!;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const itemStr = (item as unknown as { value?: unknown }).value;
          if (itemStr === ' ') {
            if (cursor < spanComments.length) {
              cursor = emitNextSpanComment(spanComments, cursor, options);
            } else {
              w.add(' ', this);
            }
            prevWasSpace = true;
            continue;
          }
          if (i > 0 && !prevWasSpace && cursor < spanComments.length) {
            cursor = emitNextSpanComment(spanComments, cursor, options);
          }
          if (typeof itemStr === 'string') {
            w.add(itemStr, this);
          } else {
            item.toString(options);
          }
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
      sourceSpanOf(this),
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
