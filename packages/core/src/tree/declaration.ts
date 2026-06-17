import {
  Node,
  F_STATIC,
  defineType,
  type LocationInfo
} from './node.js';
import { isNode } from './util/is-node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { Interpolated } from './interpolated.js';
import { Any, any, type AnyRole } from './any.js';
import { Reference } from './reference.js';
import { List, renderListValueSyntax } from './list.js';
import { spaced } from './sequence.js';
import { Operation } from './operation.js';
import { N } from './node-type.js';
import type { Call } from './call.js';
import {
  OutputWriter,
  type PrintOptions,
  getPrintOptions,
  prepareRenderPrintState,
  savePrintState,
  restorePrintState
} from './util/print.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { emitCommentTriviaAfterNode } from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export const enum AssignmentType {
  Default = ':',
  Add = '+:',              // similar to += in JS, but merges lists / sequences / collections
  // Subtract = '-:',      // math subtraction, like -= in JS
  // Multiply = '*:',      // math multiplication, like *= in JS
  // Divide = '/:',        // math division, like /= in JS
  CondAssign = '?:',       // assign only when no value is already defined
  // CondAdd = '?+:',      // add if defined, otherwise assign
  // CondSubtract = '?-:', // subtract if defined, otherwise assign
  // CondMultiply = '?*:', // multiply if defined, otherwise assign
  // CondDivide = '?/:',   // divide if defined, otherwise assign

  /** Legacy Less flags */
  MergeList = '&,:',    // merge into a list if another prop exists with this flag
  MergeSequence = '&_:' // merge into a sequence if another prop exists with this flag
}

export type DeclarationOptions = {
  assign?: AssignmentType;
  /** Tracks that this declaration was created via assignment normalization (e.g. +:, +_:). */
  normalizedFromAssign?: AssignmentType;
  semi?: boolean;
  /**
   * This doesn't prevent shadowing; it prevents declarations like:
   *   ^$overwrite: foo;
   *
   * Written as `!$foo:` in Jess or imported from a readonly context
   */
  readonly?: boolean;
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess's (^$foo:)
   */
  setDefined?: boolean;

  /** Used by SCSS (!default) and Jess (?:) */
  // setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by SCSS in the case of mixins... not Jess?
   */
  throwIfDefined?: boolean;
};
/** Should be Any<'property'> | Interpolated<'property'> */
type NameValue<T extends AnyRole = 'property'> = Any<T> | Interpolated<T>;

export type DeclarationValue<T extends AnyRole = 'property'> = {
  name: NameValue<T>;
  value: Node;
  /** The actual string representation of important, if it exists */
  important?: Any<'flag'>;
};

type DeclarationEvalState = {
  output: Node;
  name?: DeclarationValue['name'];
  value?: Node;
  important?: Any<'flag'>;
  nil: boolean;
};

type CustomInterpolatedRenderValue = {
  source: Interpolated;
  replacements: Node[];
};

type DeclarationRenderState = {
  name: DeclarationValue['name'];
  value: Node;
  customInterpolatedValue?: CustomInterpolatedRenderValue;
  mergeAdapter?: DeclarationMergeAdapterState;
  important?: Any<'flag'>;
  importantText?: string;
  normalizedFromAssign?: AssignmentType;
  output?: Node;
  nil: boolean;
};

export function finalizeContextualImportantState(
  context: Context,
  important: Any<'flag'> | undefined
): { importantText?: string } {
  const importantText = context.hasImportantSource && !important
    ? '!important'
    : undefined;
  if (context.hasImportantSource) {
    context.popImportantSource();
  }
  return importantText ? { importantText } : {};
}

export function finalizeContextualImportantPublicState(
  context: Context,
  important: Any<'flag'> | undefined
): { important?: Any<'flag'>; importantText?: string } {
  if (!context.hasImportantSource) {
    return important ? { important } : {};
  }
  context.popImportantSource();
  return important ? { important } : { important: any('!important', { role: 'flag' }) };
}

export function collectDeclarationMergeAdapterItems(
  value: Node,
  options: { includeSequences?: boolean } = { includeSequences: true }
): Node[] {
  const mergedItems: Node[] = [];
  const collect = (child: Node) => {
    if (isNode(child, N.List) || (options.includeSequences && isNode(child, N.Sequence))) {
      for (const item of child.items) {
        collect(item);
      }
      return;
    }
    const isEmptyPlaceholder = isNode(child, N.Nil)
      || (isNode(child, N.Any) && child.value === '');
    if (!isEmptyPlaceholder) {
      mergedItems.push(child);
    }
  };
  collect(value);
  return mergedItems;
}

type DeclarationMergeAdapterItemsState = {
  kind: 'list' | 'space';
  items: Node[];
};

export type DeclarationMergeAdapterState = DeclarationMergeAdapterItemsState;
type DeclarationMergeAdapterResult = DeclarationMergeAdapterState | Node | undefined;

export function createDeclarationMergeAdapterState(
  value: Node,
  mode: 'list' | 'space'
): DeclarationMergeAdapterResult {
  const canContainMergedItems = mode === 'list'
    ? isNode(value, N.List)
    : isNode(value, N.List | N.Sequence);
  if (!canContainMergedItems) {
    return undefined;
  }
  const mergedItems = collectDeclarationMergeAdapterItems(value, {
    includeSequences: mode === 'space'
  });
  if (mergedItems.length === 0) {
    return undefined;
  }
  if (mergedItems.length === 1) {
    return mergedItems[0]!;
  }
  return { kind: mode, items: mergedItems };
}

type DeclarationValueState<T extends Declaration = Declaration> = {
  source: T;
  value: Node;
  important?: Any<'flag'>;
  changed: boolean;
};

type DeclarationRegistrationState = {
  name: DeclarationValue['name'];
  value: Node;
  important?: Any<'flag'>;
  normalizedFromAssign?: AssignmentType;
  renderOnly?: boolean;
  renderAssignment?: {
    items: Node[];
    sep: ',' | ' ';
  };
  bindOutput?: (node: Declaration) => void;
};

type DeclarationRegistrationOptions = {
  reuseCanonical?: boolean;
};

type DeclarationRenderValue = Node | Nil | Node[] | CustomInterpolatedRenderValue;

const isCustomInterpolatedRenderValue = (value: DeclarationRenderValue): value is CustomInterpolatedRenderValue => (
  !(value instanceof Node)
  && !Array.isArray(value)
  && value.source instanceof Interpolated
);

const shouldResolveCustomPropertyValue = (node: Node): boolean => {
  if (isNode(node, N.Reference)) {
    return node.options?.type !== 'function';
  }
  if (node.type === 'Interpolated') {
    return true;
  }
  return valueShouldResolveCustomProperty(node.value);
};

const valueShouldResolveCustomProperty = (value: unknown): boolean => {
  if (isNode(value)) {
    return shouldResolveCustomPropertyValue(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (valueShouldResolveCustomProperty(value[i])) {
        return true;
      }
    }
    return false;
  }
  if (isRecord(value)) {
    for (const key in value) {
      if (valueShouldResolveCustomProperty(value[key])) {
        return true;
      }
    }
  }
  return false;
};

const unwrapAtomicCustomValue = (node: Node): Node => {
  if (isNode(node, N.List) && node.items.length === 1) {
    return unwrapAtomicCustomValue(node.items[0]!);
  }
  if (isNode(node, N.Sequence) && node.items.length === 1) {
    return unwrapAtomicCustomValue(node.items[0]!);
  }
  return node;
};

const canReuseSourceFreeAssignmentInput = (node: Node): boolean => {
  if (!isNode(node, N.Sequence | N.List)) {
    return false;
  }
  if (node.location.length !== 0 || !node.hasFlag(F_STATIC)) {
    return false;
  }
  return node.items.every(child => child instanceof Node && canReuseLeaf(child));
};

type LessFunctionFallbackCall = Call & {
  name: Reference;
};

const isLessFunctionFallbackCall = (node: Node): node is LessFunctionFallbackCall => (
  isNode(node, N.Call)
  && isNode(node.name, N.Reference)
  && node.name.options?.type === 'function'
  && node.name.options?.fallbackValue === true
);

const stringifyDetached = (node: Node, options: PrintOptions): string => {
  const printOptions = getPrintOptions(options);
  return node.toString({
    ...printOptions,
    writer: new OutputWriter()
  });
};

const stringifyCustomFallbackFunctionCall = (node: Node, options: PrintOptions): string | undefined => {
  const atomicValue = unwrapAtomicCustomValue(node);
  if (!isLessFunctionFallbackCall(atomicValue)) {
    return undefined;
  }

  const { name, args } = atomicValue;
  const printableKey = name.value.rawKey ?? name.key;
  const nameText = typeof printableKey === 'string' || typeof printableKey === 'number'
    ? String(printableKey)
    : Array.isArray(printableKey)
      ? printableKey.map(part => String(part)).join('')
      : stringifyDetached(printableKey, options).trim();
  const argTexts = (args?.value ?? [])
    .filter(Boolean)
    .map(arg => stringifyDetached(arg, options).trim());

  return `${nameText}(${argTexts.join(', ')})`;
};

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue, Opts> {
  static override childKeys = ['name', 'valueNode', 'important'];

  readonly name: DeclarationValue['name'];
  readonly valueNode: DeclarationValue['value'];
  readonly important: DeclarationValue['important'];

  override allowRuleRoot = true;

  constructor(
    value: DeclarationValue,
    options?: Opts,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, treeContext);
    this.name = value.name;
    this.valueNode = value.value;
    this.important = value.important;
  }

  private copyNameForDerived(node: DeclarationValue['name']): DeclarationValue['name'] {
    if (canReuseLeaf(node)) {
      return reuseLeaf(node);
    }
    const copy = copyWithReusableLeaves(node);
    if (!(copy instanceof Any) && !(copy instanceof Interpolated)) {
      throw new TypeError('Copied declaration name must remain a declaration name');
    }
    copy.frozen = true;
    return copy;
  }

  private copyValueForDerived(node: Node): Node {
    return canReuseLeaf(node) ? reuseLeaf(node) : copyWithReusableLeaves(node);
  }

  private ownRenderAssignmentInput(node: Node): Node {
    return canReuseLeaf(node) || canReuseSourceFreeAssignmentInput(node)
      ? reuseLeaf(node)
      : this.copyValueForDerived(node);
  }

  private ownMergedAssignmentOutputItem(node: Node): Node {
    return canReuseLeaf(node) ? reuseLeaf(node) : this.copyValueForDerived(node);
  }

  private copyImportantForDerived(node: Any<'flag'> | undefined): Any<'flag'> | undefined {
    if (!node) {
      return undefined;
    }
    if (canReuseLeaf(node)) {
      return reuseLeaf(node);
    }
    const copy = copyWithReusableLeaves(node);
    if (!(copy instanceof Any)) {
      throw new TypeError('Copied important flag must remain an Any node');
    }
    copy.frozen = true;
    return copy;
  }

  private applyDerivedMetadata<T extends this>(node: T): T {
    return node.inherit(this);
  }

  private withParts(value: DeclarationValue): this {
    const node: this = Reflect.construct(
      this.constructor,
      [
        value,
        this._options ? { ...this._options } : undefined,
        this.location
      ]
    );
    return this.applyDerivedMetadata(node);
  }

  private derive(): this {
    return this.withParts({
      name: this.copyNameForDerived(this.name),
      value: this.copyValueForDerived(this.valueNode),
      important: this.copyImportantForDerived(this.important)
    });
  }

  deriveWithOptions(options: Opts & DeclarationOptions): this {
    const node = this.derive();
    node.options = options;
    return node;
  }

  deriveWithParts(parts: Partial<DeclarationValue>): this {
    const node = this.withParts({
      name: parts.name === undefined
        ? this.copyNameForDerived(this.name)
        : parts.name,
      value: parts.value === undefined
        ? this.copyValueForDerived(this.valueNode)
        : parts.value,
      important: parts.important === undefined
        ? this.copyImportantForDerived(this.important)
        : parts.important
    });
    node.registrationPrepared = this.registrationPrepared;
    return node;
  }

  private formatNonCustomValue(valOut: string, _options: PrintOptions) {
    const trimmedEnd = valOut.replace(/\s+$/g, '');
    if (!trimmedEnd.includes('\n')) {
      return ` ${trimmedEnd.replace(/^[ \t]+/g, '')}`;
    }

    // Authored multiline declaration values keep their line breaks. We normalize
    // only the minimum continuation indent rather than emulating historical
    // Less fixture cases that collapsed some unindented continuations.
    const continuationIndent = '  ';
    const lines = trimmedEnd.split('\n');
    let out = '';
    const [firstLine = '', ...restLines] = lines;
    const firstContent = firstLine.replace(/^[ \t]+/g, '').trimEnd();

    if (firstContent) {
      out = ` ${firstContent}`;
    }

    for (const line of restLines) {
      if (!line.trim()) {
        out += '\n';
        continue;
      }

      const lineIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
      const content = line.replace(/^[ \t]+/g, '').trimEnd();
      const isClosingLine = /^[}\])]([,;])?$/.test(content);
      const normalizedIndent = ' '.repeat(
        isClosingLine ? lineIndent : Math.max(continuationIndent.length, lineIndent)
      );
      out += `\n${normalizedIndent}${content}`;
    }

    return out || `\n${continuationIndent}`;
  }

  /** If the value has curly braces, a semi-colon is not required */
  override get requiredSemi() {
    return this.valueRequiresSemi(this.valueNode);
  }

  private valueRequiresSemi(value: Node): boolean {
    return !isNode(value, N.Collection) && !isNode(value, N.Mixin);
  }

  protected declTrimmedString(options?: PrintOptions) {
    return this.declValueTrimmedString({
      name: this.name,
      value: this.valueNode,
      important: this.important
    }, options);
  }

  private declValueTrimmedString(
    valueParts: DeclarationValue,
    options?: PrintOptions,
    renderState?: {
      customInterpolatedValue?: DeclarationRenderState['customInterpolatedValue'];
      mergeAdapter?: DeclarationMergeAdapterState;
      importantText?: string;
      normalizedFromAssign?: AssignmentType;
    }
  ) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name, value, important } = valueParts;
    const { mergeAdapter, importantText } = renderState ?? {};
    const { assign = ':', normalizedFromAssign, setDefined } = this._options ?? {};
    const mark = w.mark();
    // setDefined uses `:=` with default spacing rules.
    const printedAssign = (normalizedFromAssign || renderState?.normalizedFromAssign)
      ? AssignmentType.Default
      : assign;
    const effAssign = (setDefined && printedAssign === ':') ? ':=' : printedAssign;
    let a = effAssign === ':' ? ':' : ` ${effAssign}`;
    // Normalize property name by trimming trailing whitespace
    const nameMark = w.mark();
    name.toTrimmedString(options);
    w.trimEndSince(nameMark);
    emitCommentTriviaAfterNode(name, options);
    w.add(a);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = name.valueOf().startsWith('--');
    if (isCustomProperty) {
      const saved = savePrintState(options, ['inCustom']);
      options.inCustom = true;
      // Preserve custom value text, but normalize boundary artifacts:
      // - if capture ended with a line break before declaration termination,
      //   drop that trailing line break so semicolon insertion stays inline.
      const valueMark = w.mark();
      if (renderState?.customInterpolatedValue?.source === value) {
        renderState.customInterpolatedValue.source.writeWithReplacements(
          renderState.customInterpolatedValue.replacements,
          options
        );
      } else {
        value.toString(options);
      }
      w.replaceSince(valueMark, (valueOut) => {
        const fallbackOut = stringifyCustomFallbackFunctionCall(value, options);
        const customOut = fallbackOut === undefined
          ? valueOut
          : `${valueOut.match(/^[ \t\r\f]*/)?.[0] ?? ''}${fallbackOut}`;
        return customOut.replace(/[ \t\r\f]*\n[ \t\r\f]*$/g, '');
      }, value);
      restorePrintState(options, saved);
    } else {
      const valueMark = w.mark();
      if (mergeAdapter?.kind === 'list') {
        renderListValueSyntax(mergeAdapter.items, options);
      } else if (mergeAdapter?.kind === 'space') {
        this.renderSpaceValueSyntax(mergeAdapter.items, options);
      } else {
        value.toTrimmedString(options);
      }
      w.replaceSince(valueMark, valOut => this.formatNonCustomValue(valOut, options), value);
      if (!isNode(value, N.Collection)) {
        if (important || importantText) {
          w.add(' ');
          if (important) {
            const importantMark = w.mark();
            important.toString(options);
            w.trimStartSince(importantMark);
            w.trimEndSince(importantMark);
          } else {
            w.add(importantText!, value);
          }
        }
      }
    }
    if (this.valueRequiresSemi(value)) {
      emitCommentTriviaAfterNode(important ?? value, options);
    }
    return w.getSince(mark);
  }

  private renderSpaceValueSyntax(value: Node[], options: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer!;
    const mark = w.mark();
    for (let index = 0; index < value.length; index++) {
      if (index !== 0) {
        w.queueSpacer(' ');
      }
      const item = value[index]!;
      item.toString(printOptions);
    }
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.declTrimmedString(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.type !== 'Declaration') {
      const state = this.evalPreparedState(context);
      return isThenable(state)
        ? (state as Promise<DeclarationEvalState>).then(resolved => this.renderEvaluatedDeclaration(context, resolved, bufferOrOptions, options))
        : this.renderEvaluatedDeclaration(context, state as DeclarationEvalState, bufferOrOptions, options);
    }
    const state = this.evalRenderState(context);
    return isThenable(state)
      ? (state as Promise<DeclarationRenderState>).then(resolved => this.renderDeclarationRenderState(context, resolved, bufferOrOptions, options))
      : this.renderDeclarationRenderState(context, state as DeclarationRenderState, bufferOrOptions, options);
  }

  private renderEvaluatedDeclaration(
    context: Context,
    state: DeclarationEvalState,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string | MaybePromise<string> {
    const node = state.output;
    if (isNode(node, N.VarDeclaration)) {
      return isRenderBuffer(bufferOrOptions)
        ? Node.prototype.render.call(node, context, bufferOrOptions, options)
        : Node.prototype.render.call(node, context, bufferOrOptions);
    }
    if (state.nil || !(node instanceof Declaration)) {
      return isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = state.value
      ? this.declValueTrimmedString({
          name: state.name ?? state.output.name,
          value: state.value,
          important: state.important
        }, prepared)
      : state.output.declTrimmedString(prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  private renderDeclarationRenderState(
    context: Context,
    state: DeclarationRenderState,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    if (state.nil) {
      const output = state.output ?? state.value;
      return isRenderBuffer(bufferOrOptions)
        ? output.render(context, bufferOrOptions, options)
        : output.render(context, bufferOrOptions);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = this.declValueTrimmedString({
      name: state.name,
      value: state.value,
      important: state.important
    }, prepared, {
      mergeAdapter: state.mergeAdapter,
      customInterpolatedValue: state.customInterpolatedValue,
      importantText: state.importantText,
      normalizedFromAssign: state.normalizedFromAssign
    });
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  override resolve(context: Context): MaybePromise<Node> {
    const state = this.evalPreparedState(context);
    return isThenable(state)
      ? (state as Promise<DeclarationEvalState>).then(resolved => resolved.output)
      : (state as DeclarationEvalState).output;
  }

  private evalRenderState(context: Context): MaybePromise<DeclarationRenderState> {
    const state = this._prepareDeclarationRegistrationState(context, { ownParts: false });
    return isThenable(state)
      ? (state as Promise<DeclarationRegistrationState>).then(resolved => this.evalRegistrationRenderState(context, resolved))
      : this.evalRegistrationRenderState(context, state as DeclarationRegistrationState);
  }

  private evalRegistrationRenderState(
    context: Context,
    state: DeclarationRegistrationState
  ): MaybePromise<DeclarationRenderState> {
    if (this.hasFlag(F_STATIC) && !state.normalizedFromAssign && !context.hasImportantSource) {
      return {
        name: state.name,
        value: state.value,
        important: state.important,
        nil: false
      };
    }
    const evaluateRenderAssignment = (): MaybePromise<Node[]> => {
      const evaluated: Node[] = [];
      let chain: Promise<void> | undefined;
      const evaluateItem = (item: Node): MaybePromise<void> => {
        const out = item.eval(context);
        if (isThenable(out)) {
          return Promise.resolve(out).then((node) => {
            if (!(node instanceof Nil)) {
              evaluated.push(node);
            }
          });
        }
        if (!(out instanceof Nil)) {
          evaluated.push(out as Node);
        }
      };
      for (const item of state.renderAssignment?.items ?? []) {
        if (chain) {
          chain = chain.then(() => evaluateItem(item));
          continue;
        }
        const out = evaluateItem(item);
        if (isThenable(out)) {
          chain = Promise.resolve(out);
        }
      }
      return chain ? chain.then(() => evaluated) : evaluated;
    };
    const evaluate = (): MaybePromise<DeclarationRenderValue> => {
      const isCustomProperty = state.name.valueOf().startsWith('--');
      const previousInCustom = context.inCustom;
      if (isCustomProperty) {
        if (!shouldResolveCustomPropertyValue(state.value)) {
          return state.value;
        }
        context.inCustom = true;
      }
      let maybeValue: MaybePromise<DeclarationRenderValue>;
      try {
        maybeValue = isCustomProperty && state.value instanceof Interpolated && !state.renderAssignment
          ? this.evalCustomInterpolatedRenderValue(context, state.value)
          : state.renderAssignment
            ? evaluateRenderAssignment()
            : state.value.eval(context);
      } finally {
        if (!isThenable(maybeValue!)) {
          context.inCustom = previousInCustom;
        }
      }
      if (isThenable(maybeValue)) {
        return Promise.resolve(maybeValue).finally(() => {
          context.inCustom = previousInCustom;
        });
      }
      return maybeValue;
    };
    const finish = (newValue: DeclarationRenderValue): DeclarationRenderState => {
      if (isCustomInterpolatedRenderValue(newValue)) {
        const { importantText } = finalizeContextualImportantState(context, state.important);
        return {
          name: state.name,
          value: state.value,
          customInterpolatedValue: newValue,
          important: state.important,
          importantText,
          normalizedFromAssign: state.normalizedFromAssign,
          nil: false
        };
      }
      if (Array.isArray(newValue)) {
        const value = newValue[0] ?? state.value;
        const isList = state.renderAssignment?.sep === ',';
        const { importantText } = finalizeContextualImportantState(context, state.important);
        return {
          name: state.name,
          value,
          mergeAdapter: {
            kind: isList ? 'list' : 'space',
            value,
            items: newValue
          },
          important: state.important,
          importantText,
          normalizedFromAssign: state.normalizedFromAssign,
          nil: false
        };
      }
      if (newValue instanceof Nil) {
        return {
          name: state.name,
          value: newValue,
          important: state.important,
          output: newValue,
          nil: true
        };
      }
      let value = newValue instanceof Node ? newValue : state.value;
      const normalized = this.normalizeMergedLeadingPlaceholderForRender(state, value);
      value = normalized instanceof Node ? normalized : normalized?.value ?? value;
      let important = state.important;
      const { importantText } = finalizeContextualImportantState(context, important);
      return {
        name: state.name,
        value,
        mergeAdapter: normalized instanceof Node ? undefined : normalized,
        important,
        importantText,
        normalizedFromAssign: state.normalizedFromAssign,
        nil: false
      };
    };
    const maybeValue = evaluate();
    return isThenable(maybeValue)
      ? maybeValue.then(finish)
      : finish(maybeValue);
  }

  private evalCustomInterpolatedRenderValue(
    context: Context,
    node: Interpolated
  ): MaybePromise<DeclarationRenderState['customInterpolatedValue']> {
    const replacements = [...node.replacements];
    let chain: Promise<void> | undefined;
    const evaluateReplacement = (replacement: Node, index: number): MaybePromise<void> => {
      const out = replacement.eval(context);
      if (isThenable(out)) {
        return Promise.resolve(out).then((evaluated) => {
          replacements[index] = evaluated;
        });
      }
      replacements[index] = out as Node;
    };
    for (const [index, replacement] of replacements.entries()) {
      if (chain) {
        chain = chain.then(() => evaluateReplacement(replacement, index));
        continue;
      }
      const out = evaluateReplacement(replacement, index);
      if (isThenable(out)) {
        chain = Promise.resolve(out);
      }
    }
    const finish = (): DeclarationRenderState['customInterpolatedValue'] => ({
      source: node,
      replacements
    });
    return chain ? chain.then(finish) : finish();
  }

  private normalizeMergedLeadingPlaceholderForRender(
    state: DeclarationRegistrationState,
    value: Node
  ): DeclarationMergeAdapterResult {
    const normalizedAssign = state.normalizedFromAssign;
    const isListMergedAssign =
      normalizedAssign === AssignmentType.Add
      || normalizedAssign === AssignmentType.MergeList;
    const isSpaceMergedAssign = normalizedAssign === AssignmentType.MergeSequence;
    const isMergedContainer = (
      (isListMergedAssign && isNode(value, N.List))
      || (isSpaceMergedAssign && isNode(value, N.Sequence))
    );
    if (!isMergedContainer) {
      return undefined;
    }
    let emptyPlaceholder: Node | undefined;
    const collect = (child: Node): void => {
      if (
        (isListMergedAssign && isNode(child, N.List))
        || (isSpaceMergedAssign && isNode(child, N.Sequence))
      ) {
        for (const item of child.items) {
          collect(item);
        }
        return;
      }
      const isEmptyPlaceholder = isNode(child, N.Nil)
        || (isNode(child, N.Any) && child.value === '');
      if (isEmptyPlaceholder) {
        emptyPlaceholder ??= child;
      }
    };
    collect(value);
    const adapter = createDeclarationMergeAdapterState(value, isListMergedAssign ? 'list' : 'space');
    if (!adapter) {
      return emptyPlaceholder;
    }
    return adapter;
  }

  private evalPreparedState(context: Context): MaybePromise<DeclarationEvalState> {
    const valueState = this.evalPreparedValueState(context);
    const finish = (resolved: DeclarationValueState<this> | Nil): DeclarationEvalState => {
      const output = resolved instanceof Nil
        ? resolved
        : this.materializeValueState(resolved);
      return {
        output,
        name: output instanceof Declaration ? output.name : undefined,
        value: output instanceof Declaration ? output.valueNode : undefined,
        important: output instanceof Declaration ? output.important : undefined,
        nil: output instanceof Nil
      };
    };
    return isThenable(valueState)
      ? (valueState as Promise<DeclarationValueState<this> | Nil>).then(finish)
      : finish(valueState as DeclarationValueState<this> | Nil);
  }

  private evalPreparedValueState(context: Context): MaybePromise<DeclarationValueState<this> | Nil> {
    const node = this.prepareRegistration(context);
    return isThenable(node)
      ? (node as Promise<this>).then(prepared => prepared.evalValueState(context))
      : (node as this).evalValueState(context);
  }

  override prepareRegistration(
    context: Context,
    options: DeclarationRegistrationOptions = {}
  ): MaybePromise<this> {
    const state = this._prepareDeclarationRegistrationState(context, options);
    return isThenable(state)
      ? (state as Promise<DeclarationRegistrationState>).then(resolved => this.materializeRegistrationState(resolved, options))
      : this.materializeRegistrationState(state as DeclarationRegistrationState, options);
  }

  private createRegistrationState(
    options: DeclarationRegistrationOptions = {}
  ): DeclarationRegistrationState {
    if (options.reuseCanonical === true) {
      return {
        name: this.name,
        value: this.valueNode,
        important: this.important
      };
    }
    return {
      name: this.copyNameForDerived(this.name),
      value: this.copyValueForDerived(this.valueNode),
      important: this.copyImportantForDerived(this.important)
    };
  }

  private createRenderRegistrationState(): DeclarationRegistrationState {
    return {
      name: this.name,
      value: this.valueNode,
      important: this.important,
      renderOnly: true
    };
  }

  private _prepareDeclarationRegistrationState(
    context: Context,
    options: { ownParts?: boolean; reuseCanonical?: boolean } = {}
  ): MaybePromise<DeclarationRegistrationState> {
    const state = options.ownParts === false
      ? this.createRenderRegistrationState()
      : this.createRegistrationState(options);
    const preparedName = this._prepareDeclarationNameIdentity(state, context);
    if (isThenable(preparedName)) {
      return preparedName.then(key => this._finishDeclarationRegistrationPrep(state, key));
    }
    return this._finishDeclarationRegistrationPrep(state, preparedName);
  }

  private _prepareDeclarationNameIdentity(
    state: DeclarationRegistrationState,
    context: Context
  ): MaybePromise<Any<'property'>> {
    const { name } = state;
    if (name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          state.name = key;
          return key;
        });
      }
      state.name = maybeKey;
      return maybeKey;
    }
    return name;
  }

  private _finishDeclarationRegistrationPrep(
    state: DeclarationRegistrationState,
    name: Any<'property'>
  ): DeclarationRegistrationState {
    this._normalizeAssignmentValue(state, name);
    return state;
  }

  private _normalizeAssignmentValue(state: DeclarationRegistrationState, key: Any<'property'>): void {
    let { value } = state;
    const setValue = (newValue: Node) => {
      state.value = newValue;
      value = newValue;
    };
    /** Normalize assignment types */
    let assign = this.options?.assign;
    const rawAssign = assign as string | undefined;
    if (rawAssign === '+,:') {
      assign = AssignmentType.MergeList;
    } else if (rawAssign === '+_:') {
      assign = AssignmentType.MergeSequence;
    }
    if (!assign && this.options?.normalizedFromAssign) {
      state.normalizedFromAssign = this.options.normalizedFromAssign;
      return;
    }
    if (assign) {
      const normalizedAssign = assign;
      const referenceKey = state.renderOnly ? this.copyNameForDerived(key) : key;
      const inputValue = state.renderOnly ? this.ownRenderAssignmentInput(value) : value;
      /** Reference type */
      let type: 'declaration' | 'variable' =
        this.type === 'VarDeclaration' ? 'variable' : 'declaration';
      let outputNode: Declaration | undefined;
      state.bindOutput = (node: Declaration) => {
        outputNode = node;
      };
      switch (assign) {
        case AssignmentType.MergeList:
        case AssignmentType.MergeSequence: {
          let boundOutputNode: Declaration | undefined;
          const ref = new Reference({ key: referenceKey }, {
            type,
            fallbackValue: new Nil(),
            excludedNode0: this,
            get excludedNode1() {
              return boundOutputNode;
            },
            get excludedNodesLength() {
              return boundOutputNode ? 2 : 1;
            },
            requiredNormalizedFromAssign: [
              AssignmentType.MergeList,
              AssignmentType.MergeSequence,
              '+,:',
              '+_:'
            ]
          }, undefined, this.sourceRoot?._treeContext);
          state.bindOutput = (node: Declaration) => {
            outputNode = node;
            boundOutputNode = node;
          };
          /**
           * @note - It's up to Sequence and List to handle
           *         the merging of the values, if Nil()
           *         or a nested list.
           */
          const isMergeListAssign = assign === AssignmentType.MergeList;
          if (state.renderOnly) {
            state.renderAssignment = {
              items: [ref, inputValue],
              sep: isMergeListAssign ? ',' : ' '
            };
            state.normalizedFromAssign = normalizedAssign;
          } else {
            value = isMergeListAssign
              ? new List([ref, inputValue])
              : spaced([ref, inputValue]);
            setValue(value);
          }
          break;
        }
        case AssignmentType.Add: {
          if (this.type === 'Declaration') {
            // Less property `+:` appends comma-separated items.
            // Use list composition (not generic `Operation +`) so scalar previous values
            // remain distinct list members rather than string-concatenating.
            const ref = new Reference({ key: referenceKey }, {
              type,
              fallbackValue: new Nil(),
              // Prevent self-referential reads while normalizing this node.
              filter: n => n !== outputNode && n !== this
            }, undefined, this.sourceRoot?._treeContext);
            if (state.renderOnly) {
              state.renderAssignment = {
                items: [ref, inputValue],
                sep: ','
              };
              state.normalizedFromAssign = normalizedAssign;
            } else {
              setValue(new List([ref, inputValue]));
            }
          } else {
            setValue(
              new Operation([
                new Reference({ key: referenceKey }, { type }, undefined, this.sourceRoot?._treeContext),
                '+',
                inputValue
              ])
            );
          }
          break;
        }
        case AssignmentType.CondAssign: {
          setValue(
            new Reference({ key: referenceKey }, {
              type,
              fallbackValue: inputValue
            }, undefined, this.sourceRoot?._treeContext)
          );
          break;
        }
      }
      state.normalizedFromAssign = normalizedAssign;
    }
  }

  private materializeRegistrationState(
    state: DeclarationRegistrationState,
    options: DeclarationRegistrationOptions = {}
  ): this {
    const changed = (
      state.name !== this.name
      || state.value !== this.valueNode
      || state.important !== this.important
      || state.normalizedFromAssign !== undefined
      || state.bindOutput !== undefined
    );
    if (options.reuseCanonical === true && !changed) {
      this.registrationPrepared = true;
      return this;
    }
    const node = this.withParts({
      name: state.name === this.name ? this.copyNameForDerived(state.name) : state.name,
      value: state.value === this.valueNode ? this.copyValueForDerived(state.value) : state.value,
      important: state.important === this.important
        ? this.copyImportantForDerived(state.important)
        : state.important
    });
    if (state.normalizedFromAssign) {
      node.options.normalizedFromAssign = state.normalizedFromAssign;
    }
    state.bindOutput?.(node);
    node.registrationPrepared = true;
    return node;
  }

  private evalValueState(context: Context): MaybePromise<DeclarationValueState<this> | Nil> {
    if (this.hasFlag(F_STATIC)) {
      this.evaluated = true;
      return {
        source: this,
        value: this.valueNode,
        important: this.important,
        changed: false
      };
    }
    {
      let node = this;
      const state: DeclarationValueState = {
        source: node,
        value: node.valueNode,
        important: node.important,
        changed: false
      };
      const setVal = (newValue: Node) => {
        if (state.value !== newValue) {
          state.value = newValue;
          state.changed = true;
        }
      };
      const setImportant = (important: Any<'flag'>) => {
        if (state.important !== important) {
          state.important = important;
          state.changed = true;
        }
      };
      const normalizeMergedLeadingPlaceholder = () => {
        const normalizedAssign = node.options.normalizedFromAssign;
        const isListMergedAssign =
            normalizedAssign === AssignmentType.Add
            || normalizedAssign === AssignmentType.MergeList;
        if (!isListMergedAssign || !isNode(state.value, N.List)) {
          return;
        }
        const mergedItems = collectDeclarationMergeAdapterItems(state.value, { includeSequences: false });
        if (mergedItems.length === 0) {
          setVal(new Nil());
          return;
        }
        if (mergedItems.length === 1) {
          const item = mergedItems[0]!;
          setVal(this.ownMergedAssignmentOutputItem(item));
          return;
        }
        const outputItems = new Array<Node>(mergedItems.length);
        for (let i = 0; i < mergedItems.length; i++) {
          outputItems[i] = this.ownMergedAssignmentOutputItem(mergedItems[i]!);
        }
        setVal(new List(outputItems));
      };
        /** Registration prep already stabilized the name; eval handles the value. */
      if (node.type === 'VarDeclaration') {
        return state;
      }
      const { name, valueNode: value } = node;
      if (value instanceof Node) {
        const isCustomProperty = name.valueOf().startsWith('--');
        if (isCustomProperty) {
          if (!shouldResolveCustomPropertyValue(value)) {
            return state;
          }
          context.inCustom = true;
        }
        const maybeNewValue = value.eval(context);
        if (isThenable(maybeNewValue)) {
          return maybeNewValue.then((newValue: Node | Nil) => {
            context.inCustom = false;
            if (newValue instanceof Nil) {
              return newValue.inherit(node);
            }
            setVal(newValue);
            normalizeMergedLeadingPlaceholder();
            const importantState = finalizeContextualImportantPublicState(context, state.important);
            if (importantState.important && importantState.important !== state.important) {
              setImportant(importantState.important);
            }
            return state;
          });
        }
        context.inCustom = false;
        if (maybeNewValue instanceof Nil) {
          return maybeNewValue.inherit(node);
        }
        if (!(maybeNewValue instanceof Node)) {
          return node;
        }
        setVal(maybeNewValue);
        normalizeMergedLeadingPlaceholder();
        const importantState = finalizeContextualImportantPublicState(context, state.important);
        if (importantState.important && importantState.important !== state.important) {
          setImportant(importantState.important);
        }
      }
      return state;
    }
  }

  private materializeValueState(state: DeclarationValueState<this>): this {
    const node = state.source;
    if (!state.changed) {
      return node;
    }
    const output = node.withParts({
      name: this.copyNameForDerived(node.name),
      value: state.value === node.valueNode
        ? this.copyValueForDerived(state.value)
        : state.value,
      important: state.important === node.important
        ? this.copyImportantForDerived(state.important)
        : state.important
    });
    output.registrationPrepared = node.registrationPrepared;
    return output;
  }

  override evalNode(context: Context): MaybePromise<this | Nil> {
    const state = this.evalValueState(context);
    return isThenable(state)
      ? (state as Promise<DeclarationValueState<this> | Nil>).then(resolved => resolved instanceof Nil ? resolved : this.materializeValueState(resolved))
      : state instanceof Nil ? state : this.materializeValueState(state as DeclarationValueState<this>);
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.name.toCSS(context, out)
  //   out.add(': ')
  //   context.cast(this.value).toCSS(context, out)
  //   if (this.important) {
  //     out.add(' ')
  //     this.important.toCSS(context, out)
  //   }
  //   out.add(';')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.decl({\n', loc)
  //   context.indent++
  //   out.add(`  name: `)
  //   this.name.toModule(context, out)
  //   out.add(`,\n  value: `)
  //   this.value.toModule(context, out)
  //   if (this.important) {
  //     out.add(`,\n  important: `)
  //     this.important.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n})`)
  // }
}

export type DeclarationParams = ConstructorParameters<typeof Declaration>;

defineType<DeclarationValue>(Declaration, 'Declaration', 'decl');

function isDeclarationValue(
  value: DeclarationValue | { name: string; value: Node; important?: Any<'flag'> }
): value is DeclarationValue {
  return typeof value.name !== 'string';
}

export const decl = (
  value: DeclarationValue | { name: string; value: Node; important?: Any<'flag'> },
  options?: DeclarationOptions,
  location?: LocationInfo
) => {
  if (!isDeclarationValue(value)) {
    return new Declaration({
      name: any(value.name, { role: 'property' }),
      value: value.value,
      important: value.important
    }, options, location);
  }
  return new Declaration(value, options, location);
};
