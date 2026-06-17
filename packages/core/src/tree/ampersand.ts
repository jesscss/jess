import { defineType, type NodeOptions, type LocationInfo, F_AMPERSAND, F_IMPLICIT_AMPERSAND, type Node } from './node.js';
import { createPublicNil, Nil } from './nil.js';
import type { Context } from '../context.js';
import { SimpleSelector } from './selector-simple.js';
import { createGeneratedIsPseudo } from './selector-pseudo.js';
import { SelectorList } from './selector-list.js';
import { BasicSelector } from './selector-basic.js';
import { CompoundSelector } from './selector-compound.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { Selector } from './selector.js';
import { atIndex } from './util/collections.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { copyOwnedWithReusableLeaves } from './util/cloning.js';
import { WARN, toDiagnostic } from '../jess-error.js';
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
  selectorContainer?: { selector?: Selector | Nil | undefined };
};

const isSingleAmpersandWrapper = (node: Node | undefined): boolean => {
  if (isNode(node, N.Ampersand)) {
    return true;
  }
  if (isNode(node, N.ComplexSelector) || isNode(node, N.CompoundSelector)) {
    return node.components.length === 1 && isNode(node.components[0], N.Ampersand);
  }
  return false;
};

function splitTopLevelCommas(str: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (inQuote) {
      if (ch === inQuote && str[i - 1] !== '\\') {
        inQuote = null;
      }
    // eslint-disable-next-line @stylistic/quotes
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      const item = str.slice(start, i).trim();
      if (item) {
        items.push(item);
      }
      start = i + 1;
    }
  }
  const last = str.slice(start).trim();
  if (last) {
    items.push(last);
  }
  return items;
}

type AppendSelectorResult<T extends Selector = Selector> = {
  selector: T;
  appended: boolean;
};

type AmpersandAppendPlacementState = {
  source: Ampersand;
  selector: Selector | Nil;
  appendValue?: string;
  templateMerge: boolean;
  templateParts?: string[];
  hoistToRoot: boolean;
  inputItemTexts: string[];
  inputItemCount: number;
  result?: Selector | Nil;
  resultItemTexts?: string[];
  resultItemCount?: number;
  resultText?: string;
  selectorBits: Context['selectorBits'];
};

function getSelectorItemTexts(selector: Selector | Nil): string[] {
  if (isNode(selector, N.SelectorList)) {
    const items = selector.value;
    const texts = new Array<string>(items.length);
    for (let i = 0; i < items.length; i++) {
      texts[i] = items[i]!.toTrimmedString();
    }
    return texts;
  }
  if (isNode(selector, N.Nil)) {
    return [];
  }
  return [selector.toTrimmedString()];
}

function createAmpersandAppendPlacementState(
  source: Ampersand,
  selector: Selector | Nil,
  context: Context,
  appendValue?: string
): AmpersandAppendPlacementState {
  const inputItemTexts = getSelectorItemTexts(selector);
  return {
    source,
    selector,
    appendValue,
    templateMerge: appendValue?.includes('&') === true,
    templateParts: appendValue?.includes('&') === true ? appendValue.split('&') : undefined,
    hoistToRoot: appendValue !== undefined || source.hoistToRoot === true,
    inputItemTexts,
    inputItemCount: inputItemTexts.length,
    selectorBits: context.selectorBits
  };
}

function isIdentJoinChar(char: string | undefined): boolean {
  return !!char && /[a-zA-Z0-9_-]/.test(char);
}

function assertValidAmpersandTemplateJoin(template: string, replacement: string): void {
  if (!replacement) {
    return;
  }
  let searchFrom = 0;
  while (true) {
    const idx = template.indexOf('&', searchFrom);
    if (idx === -1) {
      break;
    }
    const before = idx > 0 ? template[idx - 1] : undefined;
    const after = idx < template.length - 1 ? template[idx + 1] : undefined;
    const first = replacement[0];
    const last = replacement[replacement.length - 1];
    const invalidHeadJoin = (first === '.' || first === '#') && isIdentJoinChar(before);
    const invalidTailJoin = (last === '.' || last === '#') && isIdentJoinChar(after);
    if (invalidHeadJoin || invalidTailJoin) {
      throw new SyntaxError(`Invalid ampersand merge template "${template}" with parent selector "${replacement}"`);
    }
    searchFrom = idx + 1;
  }
}

function throwCannotAppendSelector(appendValue: string): never {
  throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
}

function getAmpersandTemplateReplacements(baseSelector: Selector): Selector[] {
  if (
    isNode(baseSelector, N.PseudoSelector)
    && baseSelector.name === ':is'
    && baseSelector.arg
    && isNode(baseSelector.arg, N.SelectorList)
  ) {
    return baseSelector.arg.selectors;
  }
  if (isNode(baseSelector, N.SelectorList)) {
    return baseSelector.selectors;
  }
  if (isNode(baseSelector, N.SimpleSelector)) {
    const selectorText = baseSelector.toTrimmedString();
    if (!selectorText.includes(',')) {
      return [baseSelector];
    }
    return splitTopLevelCommas(selectorText)
      .map(item => new BasicSelector(item).inherit(baseSelector));
  }
  return [baseSelector];
}

function mergeAmpersandTemplateSelector(
  baseSelector: Selector,
  placement: AmpersandAppendPlacementState
): Selector {
  const { appendValue, templateParts } = placement;
  if (appendValue === undefined) {
    return baseSelector;
  }
  const replacements = getAmpersandTemplateReplacements(baseSelector);
  const merged = new Array<Selector>(replacements.length);
  for (let i = 0; i < replacements.length; i++) {
    const item = replacements[i]!;
    const value = item.toTrimmedString();
    assertValidAmpersandTemplateJoin(appendValue, value);
    if (templateParts?.length === 2 && templateParts[0] === '' && templateParts[1]) {
      const result = appendSelector(item, templateParts[1]);
      if (result.appended) {
        merged[i] = result.selector;
        continue;
      }
    }
    merged[i] = new BasicSelector((templateParts ?? [appendValue]).join(value)).inherit(baseSelector);
  }
  if (merged.length === 1) {
    return merged[0]!;
  }
  return new SelectorList(merged).inherit(baseSelector);
}

function mergeAmpersandTemplateSelectorList(
  selector: SelectorList,
  placement: AmpersandAppendPlacementState
): SelectorList {
  const mergedItems: Selector[] = [];
  for (const item of selector.value) {
    const merged = mergeAmpersandTemplateSelector(item as Selector, placement);
    if (isNode(merged, N.SelectorList)) {
      mergedItems.push(...merged.value);
    } else {
      mergedItems.push(merged);
    }
  }
  return new SelectorList(mergedItems).inherit(selector);
}

function createAmpersandWithSelectorContainer(
  source: Ampersand,
  selectorContainer: { selector?: Selector | Nil | undefined }
): Ampersand {
  return new Ampersand(
    {
      appendValue: source.appendValue,
      selectorContainer
    },
    source.options,
    source.location.length === 0 ? undefined : source.location
  ).inherit(source);
}

function ownSelectorForAppend(selector: Selector): Selector {
  const owned = copyOwnedWithReusableLeaves(selector);
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
    || isNode(node, N.Combinator)
  ) {
    return node;
  }
  throw new TypeError('Expected complex selector component');
}

function ownComplexComponentForAppend(component: ComplexSelectorComponent): ComplexSelectorComponent {
  return expectComplexAppendComponent(copyOwnedWithReusableLeaves(component));
}

function createSimpleSelectorLike(selector: SimpleSelector, value: unknown): SimpleSelector {
  const node = Reflect.construct(
    selector.constructor,
    [
      value,
      { ...selector.options },
      selector.location.length === 0 ? undefined : selector.location
    ]
  );
  if (!(node instanceof SimpleSelector)) {
    throw new TypeError('Expected simple selector copy');
  }
  return node.inherit(selector);
}

function appendSimpleSelector(selector: SimpleSelector, appendValue: string): AppendSelectorResult<SimpleSelector> {
  if (typeof selector.value !== 'string') {
    throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`);
  }
  return {
    selector: createSimpleSelectorLike(selector, selector.value + appendValue),
    appended: true
  };
}

function appendSelector(selector: Selector, appendValue: string): AppendSelectorResult {
  if (isNode(selector, N.SelectorList)) {
    const sourceItems = selector.selectors;
    const items = new Array<Selector>(sourceItems.length);
    for (let i = 0; i < sourceItems.length; i++) {
      const item = sourceItems[i]!;
      const result = appendSelector(item as Selector, appendValue);
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
    for (let i = selector.components.length - 1; i >= 0; i--) {
      const component = selector.components[i]!;
      if (isNode(component, N.Combinator)) {
        continue;
      }
      const result = appendSelector(component, appendValue);
      if (!result.appended) {
        continue;
      }
      const sourceComponents = selector.components;
      const components = new Array<ComplexSelectorComponent>(sourceComponents.length);
      for (let j = 0; j < sourceComponents.length; j++) {
        components[j] = j === i
          ? expectComplexAppendResult(result.selector)
          : ownComplexComponentForAppend(sourceComponents[j]!);
      }
      return {
        selector: ComplexSelector.create(components).inherit(selector),
        appended: true
      };
    }
    return { selector, appended: false };
  }

  if (isNode(selector, N.CompoundSelector)) {
    for (let i = selector.components.length - 1; i >= 0; i--) {
      const part = selector.components[i]!;
      const result = appendSimpleSelector(part, appendValue);
      const sourceParts = selector.components;
      const parts = new Array<SimpleSelector>(sourceParts.length);
      for (let j = 0; j < sourceParts.length; j++) {
        parts[j] = j === i ? result.selector : ownSelectorForAppend(sourceParts[j]!);
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
  placement.resultItemTexts = getSelectorItemTexts(selector);
  placement.resultItemCount = placement.resultItemTexts.length;
  placement.resultText = placement.resultItemTexts.length === 1
    ? placement.resultItemTexts[0]
    : selector.toTrimmedString();
  if (placement.hoistToRoot) {
    placement.result.hoistToRoot = true;
  }
  return placement.result;
}

/**
 * The '&' selector element
 */
export class Ampersand extends SimpleSelector<{ appendValue?: string }> {
  static override childKeys = null;

  readonly appendValue: string | undefined;

  private _storedSelector: Selector | Nil | undefined;
  private _selectorContainer: { selector?: Selector | Nil | undefined } | undefined;

  constructor(
    value?: AmpersandValue | string,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
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
        this._storedSelector = selectorContainer?.selector;
      }
    }
    this.appendValue = finalValue.appendValue;
    this._treeContext = treeContext;

    // Set the F_AMPERSAND flag so it bubbles up to parent selectors
    this.addFlag(F_AMPERSAND);
  }

  override computeKeySets(): void {
    let library = this.keySetLibrary;
    if (!library) {
      library = this._requireKeySetLibrary();
    }
    const stored = this._storedSelector;
    const current = this._selectorContainer?.selector;
    /** Ampersands don't participate to the visible key set */
    if (!this._visibleKeySet) {
      this._visibleKeySet = library.getBitset();
    }
    if (!this._requiredKeySet) {
      this._requiredKeySet = library.getBitset();
    }
    if (!current || isNode(current, N.Nil)) {
      if (!this._keySet) {
        this._keySet = library.getBitset();
      }
      return;
    }
    if ((current as Selector).isSelector && !(current as Selector).keySetLibrary) {
      (current as Selector).keySetLibrary = library;
    }
    if (!this._keySet || stored !== current) {
      this._keySet = current.keySet;
    }
  }

  override getKeySet(context?: Context) {
    if (!context) {
      return this.keySet;
    }

    const current = this._selectorContainer?.selector;
    if (!current || isNode(current, N.Nil)) {
      const library = this.keySetLibrary;
      if (!library) {
        return this._requireKeySetLibrary().getBitset();
      }
      return library.getBitset();
    }

    return current.getKeySet(context);
  }

  /**
   * Returns the raw stored container selector (without any `:is()` wrapping).
   * Used by extend-walk to peek at the container parent for "within-ampersand"
   * matching. Prefer `getResolvedSelector()` when you want the serialization
   * view (SelectorList gets wrapped for implicit-& use).
   */
  getStoredSelector(): Selector | Nil | undefined {
    return this._storedSelector ?? this._selectorContainer?.selector;
  }

  /**
   * Returns the current selector from the selector container (live when container is ruleset value).
   * Used by extend, serialization, and matching so nested rules see the parent after extend.
   */
  getResolvedSelector(): Selector | Nil | undefined {
    const selector = this._selectorContainer?.selector;
    if (selector && isNode(selector, N.SelectorList) && this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      const arg = copyOwnedWithReusableLeaves(selector);
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
      return selector.valueOf();
    }
    return '&';
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
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
      // Use the stored selector if available, otherwise fall back to frame selector
      let frame = atIndex(context.rulesetFrames, -1);
      let selector = storedSelector ?? frame?.selector;
      if (!selector) {
        return createPublicNil();
      }
      const placement = createAmpersandAppendPlacementState(this, selector, context, appendValue);
      if (appendValue && !isNode(selector, N.Nil)) {
        if (placement.templateMerge) {
          if (isNode(selector, N.SelectorList)) {
            selector = mergeAmpersandTemplateSelectorList(selector, placement);
          } else {
            selector = mergeAmpersandTemplateSelector(selector, placement);
          }
        } else {
          const result = appendSelector(selector, appendValue);
          if (!result.appended) {
            throwCannotAppendSelector(appendValue);
          }
          selector = result.selector;
        }
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
      amp = createAmpersandWithSelectorContainer(this, frame);
    } else if (!amp._selectorContainer) {
      const parentSelector = amp.parent;
      const isBareWrapperAmp = isSingleAmpersandWrapper(parentSelector);
      if (!isBareWrapperAmp) {
        const file = amp.sourceRoot?._treeContext?.file;
        const selectorText = String(amp.parent?.valueOf?.() ?? '&');
        context.warnings.push(toDiagnostic(WARN.parentlessAmpersand({
          ctx: file ? { file } : undefined,
          filePath: file?.fullPath,
          line: amp.location?.[1],
          column: amp.location?.[2],
          meta: { selector: selectorText }
        })));
      }
      return createPublicNil();
    }
    return amp;
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newNode = super.clone(deep, cloneFn) as this;
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
      this.location.length === 0 ? undefined : this.location
    ).inherit(this);
    if (this._storedSelector) {
      node._storedSelector = this._storedSelector;
    }
    return node;
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');
