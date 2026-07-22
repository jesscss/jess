import { sourceSpanOf } from './util/provenance.js';
import { defineType, type NodeOptions, type LocationInfo, F_AMPERSAND, F_IMPLICIT_AMPERSAND, type Node, type PlacementCloneOptions } from './node.js';
import { createPublicNil, Nil } from './nil.js';
import type { Context } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { createGeneratedIsPseudo } from './selector-pseudo.js';
import { SelectorList, selectorListValueOf } from './selector-list.js';
import { BasicSelector } from './selector-basic.js';
import { CompoundSelector } from './selector-compound.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { isNode } from './util/is-node.js';
import { isCombinator } from './util/combinator.js';
import { N } from './node-type.js';
import { Selector, type SelectorLike } from './selector.js';
import { atIndex } from './util/collections.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { WARN } from '../jess-error.js';

export type AmpersandValue = {
  /**
   * The only value that may exist is an anonymous value
   * This is represented as &(). Any &() will signal
   * a forced output (as well as an adjacent ident starting with
   * a dash or numbers)
   *
   * @example
     .rule {
       &-foo {
         color: red;
       }
     }
     // output:
     .rule-foo {
       color: red;
     }

     .rule {
       &(-foo) {
         color: red;
       }
     }
     // output:
     .rule-foo {
       color: red;
     }

    .rule {
       &.foo {
         color: red;
       }
     }
     // output:
     .rule {
       &.foo {
         color: red;
       }
     }

     .rule {
       &().foo {
         color: red;
       }
     }
     // output:
     .rule.foo {
       color: red;
     }

   */
  /** Set to an empty string to hoist to root */
  appendValue?: string;

  /**
   * When set (e.g. by ruleset prep), returns the current parent ruleset's selector ("pointer").
   * Prefer this over value.selector so extend sees the parent after it has been mutated (e.g. by extend).
   */
  selectorContainer?: { selector?: SelectorLike | Nil | undefined };
};

const isSingleAmpersandWrapper = (node: Node | undefined): boolean => {
  if (isNode(node, N.Ampersand)) {
    return true;
  }
  if (isNode(node, N.ComplexSelector) || isNode(node, N.CompoundSelector)) {
    return node.value.length === 1 && isNode(node.value[0], N.Ampersand);
  }
  return false;
};

type AppendSelectorResult<T extends Selector = Selector> = {
  selector: T;
  appended: boolean;
};

type AmpersandAppendPlacementState = {
  source: Ampersand;
  selector: Selector | Nil;
  appendValue?: string;
  hoistToRoot: boolean;
  result?: Selector | Nil;
  selectorBits: Context['selectorBits'];
};

function createAmpersandAppendPlacementState(
  source: Ampersand,
  selector: Selector | Nil,
  context: Context,
  appendValue?: string
): AmpersandAppendPlacementState {
  return {
    source,
    selector,
    appendValue,
    hoistToRoot: appendValue !== undefined || source.hoistToRoot === true,
    selectorBits: context.selectorBits
  };
}

function throwCannotAppendSelector(appendValue: string): never {
  throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
}

function selectorListItemForAmpersand(item: SelectorList['value'][number]): Selector {
  return typeof item === 'string' ? new BasicSelector(item) : item;
}

function createAmpersandWithSelectorContainer(
  source: Ampersand,
  selectorContainer: { selector?: SelectorLike | Nil | undefined }
): Ampersand {
  return new Ampersand(
    {
      appendValue: source.appendValue,
      selectorContainer
    },
    source.options,
    sourceSpanOf(source)
  ).inherit(source);
}

function ownSelectorForAppend(selector: Selector): Selector {
  // Shared-source sibling in a `&`-append: the appended part is freshly built,
  // but the OTHER parts are shared source selectors copied only to dodge the
  // reparent into the new Compound/Complex container. Share them frozen (B3):
  // the new top-level wrapper is still allocated, but child containers stay at
  // their canonical parent and `inherit`/`adopt` skips the reparent.
  const owned = selector.cloneForPlacement({ reuseLeaves: false, shareChildren: true });
  if (!(owned instanceof Selector)) {
    throw new TypeError('Expected selector copy');
  }
  return owned;
}

function expectComplexAppendResult(selector: Selector): ComplexSelectorComponent {
  if (
    isNode(selector, N.SimpleSelector)
    || isNode(selector, N.CompoundSelector)
    || isNode(selector, N.ComplexSelector)
  ) {
    return selector;
  }
  throw new TypeError('Expected complex selector component');
}

function expectComplexAppendComponent(node: Node): ComplexSelectorComponent {
  if (
    isNode(node, N.SimpleSelector)
    || isNode(node, N.CompoundSelector)
    || isNode(node, N.ComplexSelector)
    || isCombinator(node)
  ) {
    return node;
  }
  throw new TypeError('Expected complex selector component');
}

function ownComplexComponentForAppend(component: ComplexSelectorComponent): ComplexSelectorComponent {
  if (typeof component === 'string') {
    return component;
  }
  // Shared-source complex component (see ownSelectorForAppend): share frozen.
  return expectComplexAppendComponent(component.cloneForPlacement({ reuseLeaves: false, shareChildren: true }));
}

function createBasicSelectorLike(selector: SimpleSelector, value: string): BasicSelector {
  const node = new BasicSelector(
    value,
    { ...selector.options },
    sourceSpanOf(selector)
  );
  return node.inherit(selector);
}

function appendSimpleSelector(selector: SimpleSelector, appendValue: string): AppendSelectorResult<SimpleSelector> {
  if (typeof selector.value !== 'string') {
    throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
  }
  return {
    selector: createBasicSelectorLike(selector, selector.value + appendValue),
    appended: true
  };
}

function appendSelector(selector: Selector, appendValue: string): AppendSelectorResult {
  if (isNode(selector, N.SelectorList)) {
    const sourceItems = selector.value;
    const items = new Array<Selector>(sourceItems.length);
    for (let i = 0; i < sourceItems.length; i++) {
      const item = sourceItems[i]!;
      const result = appendSelector(selectorListItemForAmpersand(item), appendValue);
      if (!result.appended) {
        throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
      }
      items[i] = result.selector;
    }
    return {
      selector: SelectorList.create(items).inherit(selector),
      appended: true
    };
  }

  if (isNode(selector, N.ComplexSelector)) {
    for (let i = selector.value.length - 1; i >= 0; i--) {
      const component = selector.value[i]!;
      if (isCombinator(component)) {
        continue;
      }
      if (typeof component === 'string') {
        continue;
      }
      const result = appendSelector(component, appendValue);
      if (!result.appended) {
        continue;
      }
      const sourceComponents = selector.value;
      const value = new Array<ComplexSelectorComponent>(sourceComponents.length);
      for (let j = 0; j < sourceComponents.length; j++) {
        value[j] = j === i
          ? expectComplexAppendResult(result.selector)
          : ownComplexComponentForAppend(sourceComponents[j]!);
      }
      return {
        selector: ComplexSelector.create(value).inherit(selector),
        appended: true
      };
    }
    return { selector, appended: false };
  }

  if (isNode(selector, N.CompoundSelector)) {
    for (let i = selector.value.length - 1; i >= 0; i--) {
      const part = selector.value[i]!;
      if (typeof part === 'string') {
        continue;
      }
      const result = appendSimpleSelector(part, appendValue);
      const sourceParts = selector.value;
      const parts = new Array<SimpleSelector>(sourceParts.length);
      for (let j = 0; j < sourceParts.length; j++) {
        const sp = sourceParts[j]!;
        parts[j] = j === i ? result.selector : (typeof sp !== 'string' ? ownSelectorForAppend(sp) : new BasicSelector(sp));
      }
      return {
        selector: CompoundSelector.create(parts).inherit(selector),
        appended: true
      };
    }
    return { selector, appended: false };
  }

  if (isNode(selector, N.SimpleSelector)) {
    return appendSimpleSelector(selector, appendValue);
  }

  return { selector, appended: false };
}

function finishAmpersandAppendPlacement(
  placement: AmpersandAppendPlacementState,
  selector: Selector | Nil
): Selector | Nil {
  placement.selector = selector;
  placement.result = selector;
  if (placement.hoistToRoot) {
    placement.result.hoistToRoot = true;
  }
  return placement.result;
}

/**
 * The '&' selector element
 */
export class Ampersand extends SimpleSelector<{ appendValue?: string }> {
  static override childKeys: readonly string[] | null = null;

  readonly appendValue: string | undefined;

  private _storedSelector: Selector | Nil | undefined;
  private _selectorContainer: { selector?: SelectorLike | Nil | undefined } | undefined;

  constructor(
    value?: AmpersandValue | string,
    options?: NodeOptions,
    location?: LocationInfo
  ) {
    let finalValue: AmpersandValue = {};
    if (typeof value === 'string') {
      finalValue.appendValue = value;
      super(finalValue, options, location);
    } else {
      finalValue = value ? { appendValue: value.appendValue } : {};
      super(finalValue, options, location);
      const selectorContainer = value?.selectorContainer;
      if (selectorContainer) {
        this._selectorContainer = selectorContainer;
        const initSelector = selectorContainer?.selector;
        this._storedSelector = typeof initSelector === 'string'
          ? new BasicSelector(initSelector)
          : Array.isArray(initSelector)
            ? SelectorList.create(initSelector)
            : initSelector;
      }
    }
    this.appendValue = finalValue.appendValue;

    // Set the F_AMPERSAND flag so it bubbles up to parent value
    this.addFlag(F_AMPERSAND);
  }

  /**
   * Returns the raw stored container selector (without any `:is()` wrapping).
   * Used by extend-walk to peek at the container parent for "within-ampersand"
   * matching. Prefer `getResolvedSelector()` when you want the serialization
   * view (SelectorList gets wrapped for implicit-& use).
   */
  getStoredSelector(): Selector | Nil | undefined {
    const containerSelector = this._selectorContainer?.selector;
    const resolved = typeof containerSelector === 'string'
      ? new BasicSelector(containerSelector)
      : Array.isArray(containerSelector)
        ? SelectorList.create(containerSelector)
        : containerSelector;
    return this._storedSelector ?? resolved;
  }

  /**
   * Returns the current selector from the selector container (live when container is ruleset value).
   * Used by extend, serialization, and matching so nested rules see the parent after extend.
   */
  // The raw container selector used for key-set analysis: only a concrete parent
  // Selector contributes keys (a bare `&`, a string, or Nil contributes none).
  // Unlike getResolvedSelector this does NOT wrap a list in `:is()` — key-set
  // computation unions the list's keys directly. Used by SelectorAnalysis.
  getKeySetContainerSelector(): SelectorLike | undefined {
    const current = this._selectorContainer?.selector;
    if (!current || typeof current === 'string' || isNode(current, N.Nil)) {
      return undefined;
    }
    return current;
  }

  getResolvedSelector(): Selector | Nil | undefined {
    const rawSelector = this._selectorContainer?.selector;
    const selector: Selector | Nil | undefined = typeof rawSelector === 'string'
      ? new BasicSelector(rawSelector)
      : Array.isArray(rawSelector)
        ? SelectorList.create(rawSelector)
        : rawSelector;
    if (selector && isNode(selector, N.SelectorList) && this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      // Wrapping the container SelectorList in a generated `:is()`: the list's
      // child selectors are shared SOURCE nodes, wrapped (not owned) — share them
      // frozen (B3) so the wrapper's `inherit`/`adopt` skips the reparent and the
      // source container is never mutated.
      const arg = selector.cloneForPlacement({ shareChildren: true });
      if (!(arg instanceof Selector)) {
        throw new TypeError('Expected selector copy');
      }
      return createGeneratedIsPseudo(arg);
    }
    return selector;
  }

  override valueOf() {
    const selector = this._selectorContainer?.selector;
    if (selector) {
      return Array.isArray(selector) ? selectorListValueOf(selector) : selector.valueOf();
    }
    return '&';
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return w.getSince(position);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const { appendValue } = this;
    if (appendValue) {
      w.add('&(');
      w.add(appendValue, this);
      w.add(')');
    } else if (options.collapseNesting && options.composedSelectorStack?.length) {
      // Temporarily pop the top so any nested Ampersand inside the parent
      // resolves to the grandparent, then restore it after rendering.
      const parent = options.composedSelectorStack.pop()!;
      if (options.ampersandFirst !== false) {
        parent.writeSyntax(options);
      } else {
        w.add(':is(');
        parent.writeSyntax(options);
        w.add(')');
      }
      options.composedSelectorStack.push(parent);
    } else {
      w.add('&', this);
    }
  }

  /** Hmm this should never return Extend */
  override evalNode(context: Context): Selector | Nil {
    this.keySetLibrary = context.selectorBits;
    const { appendValue } = this;
    const selectorContainer = this._selectorContainer;
    const storedSelector = selectorContainer?.selector;
    if (appendValue !== undefined || this.hoistToRoot) {
      // Use the stored selector if available, otherwise fall back to frame selector.
      // In spine mode the parent frame's `frame.selector` is the RAW authored selector
      // (a nested `&-b`), so prefer the spine-resolved concrete selector for the frame
      // (`.a-b`) when present — nested append (`.a { &-b { &-c {…} } }` → `.a-b-c`)
      // must append against the RESOLVED parent, not the raw `&-b` (which would throw
      // `Cannot append`). The eval pass gets this for free by pushing the resolved
      // OUTPUT node; the spine uses the `spineResolvedFrameSelector` side-channel to
      // avoid mutating the shared canonical source node.
      let frame = atIndex(context.rulesetFrames, -1);
      const resolvedFrameSelector = frame ? context.spineResolvedFrameSelector?.get(frame) : undefined;
      let selectorRaw = storedSelector ?? resolvedFrameSelector ?? frame?.selector;
      if (!selectorRaw) {
        return createPublicNil();
      }
      let selector: Selector | Nil = typeof selectorRaw === 'string'
        ? new BasicSelector(selectorRaw)
        : Array.isArray(selectorRaw)
          ? SelectorList.create(selectorRaw)
          : selectorRaw;
      const placement = createAmpersandAppendPlacementState(this, selector, context, appendValue);
      if (appendValue && !isNode(selector, N.Nil)) {
        // `&` is always leading, so `appendValue` is a plain suffix (`&-bar` → `-bar`,
        // `&1` → `1`, `&(-foo)` → `-foo`) — never an embedded-`&` template. Just append
        // it to the parent's trailing selector.
        const result = appendSelector(selector, appendValue);
        if (!result.appended) {
          throwCannotAppendSelector(appendValue);
        }
        selector = result.selector;
      }

      // No `:is()` wrapping here: for the append/hoist case, the result is
      // the new top-level selector (marked hoistToRoot so composeSelector
      // won't re-prepend the parent). A SelectorList or ComplexSelector
      // result renders correctly on its own at the top level.
      return finishAmpersandAppendPlacement(placement, selector);
    }

    let frame = atIndex(context.rulesetFrames, -1);
    let amp: Ampersand = this;
    /**
     * Attach the current context selector if we need it later, for extends and such.
     * The frame is constant, so we can use the selector directly.
     * If the ampersand already has a stored selector (from getImplicitSelector),
     * preserve it instead of overwriting with the frame selector.
     */
    if (!amp._selectorContainer && frame && frame.selector) {
      const frameSelector = frame.selector;
      const container: { selector?: SelectorLike | Nil | undefined } = typeof frameSelector === 'string'
        ? { selector: frameSelector }
        : frame;
      amp = createAmpersandWithSelectorContainer(this, container);
    } else if (!amp._selectorContainer) {
      const parentSelector = amp.parent;
      const isBareWrapperAmp = isSingleAmpersandWrapper(parentSelector);
      if (!isBareWrapperAmp) {
        const file = amp.sourceRoot?._treeContext?.file;
        const selectorText = String(amp.parent?.valueOf?.() ?? '&');
        context.warn(WARN.parentlessAmpersand({
          ctx: file ? { file } : undefined,
          filePath: file?.fullPath,

          meta: { selector: selectorText }
        }));
      }
      return createPublicNil();
    }
    return amp;
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const newNode = super.clone(cloneFn) as this;
    if (this._selectorContainer) {
      newNode._selectorContainer = this._selectorContainer;
    }
    if (this._storedSelector) {
      newNode._storedSelector = this._storedSelector;
    }
    return newNode;
  }

  derive(): Ampersand {
    const node = new Ampersand(
      {
        appendValue: this.appendValue,
        selectorContainer: this._selectorContainer
      },
      this._options ? { ...this._options } : undefined,
      sourceSpanOf(this)
    ).inherit(this);
    if (this._storedSelector) {
      node._storedSelector = this._storedSelector;
    }
    return node;
  }

  override cloneForPlacement(_options?: PlacementCloneOptions): Node {
    const derived = this.derive();
    derived.frozen = true;
    return derived;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', sourceSpanOf(this))
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');
