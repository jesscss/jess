import { defineType, type NodeOptions, type LocationInfo, F_AMPERSAND, F_IMPLICIT_AMPERSAND, type Node, type PlacementCloneOptions } from './node.js';
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
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
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
  selectorContainer?: { selector?: Selector | Nil | string | undefined };
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
    templateMerge: appendValue?.includes('&') === true,
    templateParts: appendValue?.includes('&') === true ? appendValue.split('&') : undefined,
    hoistToRoot: appendValue !== undefined || source.hoistToRoot === true,
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

function getExactBasicSelectorText(selector: Selector): string | undefined {
  return selector.constructor === BasicSelector
    ? (selector as BasicSelector).valueOf()
    : undefined;
}

function getSelectorSyntaxText(selector: Selector): string {
  const exactBasicText = getExactBasicSelectorText(selector);
  if (exactBasicText !== undefined) {
    return exactBasicText;
  }
  const writer = new OutputWriter(false);
  selector.writeSyntax(getPrintOptions({ writer }));
  return writer.toString();
}

function selectorListItemForAmpersand(item: SelectorList['value'][number]): Selector {
  return typeof item === 'string' ? new BasicSelector(item) : item;
}

function selectorListValueForAmpersand(value: SelectorList['value']): Selector[] {
  const selectors = new Array<Selector>(value.length);
  for (let i = 0; i < value.length; i++) {
    selectors[i] = selectorListItemForAmpersand(value[i]!);
  }
  return selectors;
}

function getAmpersandTemplateReplacements(baseSelector: Selector): Selector[] {
  if (
    isNode(baseSelector, N.PseudoSelector)
    && baseSelector.name === ':is'
    && baseSelector.arg
    && isNode(baseSelector.arg, N.SelectorList)
  ) {
    return selectorListValueForAmpersand(baseSelector.arg.value);
  }
  if (isNode(baseSelector, N.SelectorList)) {
    return selectorListValueForAmpersand(baseSelector.value);
  }
  const exactBasicText = getExactBasicSelectorText(baseSelector);
  if (exactBasicText !== undefined) {
    if (!exactBasicText.includes(',')) {
      return [baseSelector];
    }
    const parts = splitTopLevelCommas(exactBasicText);
    const value = new Array<Selector>(parts.length);
    for (let i = 0; i < parts.length; i++) {
      value[i] = new BasicSelector(parts[i]!).inherit(baseSelector);
    }
    return value;
  }
  if (isNode(baseSelector, N.SimpleSelector)) {
    const selectorText = baseSelector.toTrimmedString();
    if (!selectorText.includes(',')) {
      return [baseSelector];
    }
    const parts = splitTopLevelCommas(selectorText);
    const value = new Array<Selector>(parts.length);
    for (let i = 0; i < parts.length; i++) {
      value[i] = new BasicSelector(parts[i]!).inherit(baseSelector);
    }
    return value;
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
    const value = getSelectorSyntaxText(item);
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
    const merged = mergeAmpersandTemplateSelector(selectorListItemForAmpersand(item), placement);
    if (isNode(merged, N.SelectorList)) {
      for (let i = 0; i < merged.value.length; i++) {
        mergedItems.push(selectorListItemForAmpersand(merged.value[i]!));
      }
    } else {
      mergedItems.push(merged);
    }
  }
  return new SelectorList(mergedItems).inherit(selector);
}

function createAmpersandWithSelectorContainer(
  source: Ampersand,
  selectorContainer: { selector?: Selector | Nil | string | undefined }
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
  const owned = selector.cloneForPlacement({ reuseLeaves: false });
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
  if (typeof component === 'string') {
    return component;
  }
  return expectComplexAppendComponent(component.cloneForPlacement({ reuseLeaves: false }));
}

function createBasicSelectorLike(selector: SimpleSelector, value: string): BasicSelector {
  const node = new BasicSelector(
    value,
    { ...selector.options },
    selector.location.length === 0 ? undefined : selector.location
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
      if (isNode(component, N.Combinator)) {
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
  private _selectorContainer: { selector?: Selector | Nil | string | undefined } | undefined;

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
        const initSelector = selectorContainer?.selector;
        this._storedSelector = typeof initSelector === 'string' ? new BasicSelector(initSelector) : initSelector;
      }
    }
    this.appendValue = finalValue.appendValue;
    this._treeContext = treeContext;

    // Set the F_AMPERSAND flag so it bubbles up to parent value
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
    if (!current || typeof current === 'string' || isNode(current, N.Nil)) {
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
    if (!current || typeof current === 'string' || isNode(current, N.Nil)) {
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
    const containerSelector = this._selectorContainer?.selector;
    const resolved = typeof containerSelector === 'string' ? new BasicSelector(containerSelector) : containerSelector;
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
  getKeySetContainerSelector(): Selector | undefined {
    const current = this._selectorContainer?.selector;
    return current && typeof current !== 'string' && !isNode(current, N.Nil)
      ? current
      : undefined;
  }

  getResolvedSelector(): Selector | Nil | undefined {
    const rawSelector = this._selectorContainer?.selector;
    const selector: Selector | Nil | undefined = typeof rawSelector === 'string'
      ? new BasicSelector(rawSelector)
      : rawSelector;
    if (selector && isNode(selector, N.SelectorList) && this.hasFlag(F_IMPLICIT_AMPERSAND)) {
      const arg = selector.cloneForPlacement();
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
      // Use the stored selector if available, otherwise fall back to frame selector
      let frame = atIndex(context.rulesetFrames, -1);
      let selectorRaw = storedSelector ?? frame?.selector;
      if (!selectorRaw) {
        return createPublicNil();
      }
      let selector: Selector | Nil = typeof selectorRaw === 'string' ? new BasicSelector(selectorRaw) : selectorRaw;
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
      const frameSelector = frame.selector;
      const container: { selector?: Selector | Nil | string | undefined } = typeof frameSelector === 'string'
        ? { selector: frameSelector }
        : frame;
      amp = createAmpersandWithSelectorContainer(this, container);
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
      this.location.length === 0 ? undefined : this.location
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
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp');
