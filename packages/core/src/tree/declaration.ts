import {
  Node,
  F_STATIC,
  defineType,
  type LocationInfo
} from './node.js';
import { isNode } from './util/is-node.js';
import { Nil } from './nil.js';
import type { Context, TreeContext } from '../context.js';
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
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import { emitCommentTriviaAfterNode } from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';

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
  listValue?: Node[];
  spaceValue?: Node[];
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
      for (const item of child.value) {
        collect(item);
      }
      return;
    }
    const isEmptyPlaceholder = (
      isNode(child, N.Nil)
      || String(child.valueOf?.() ?? '') === ''
    );
    if (!isEmptyPlaceholder) {
      mergedItems.push(child);
    }
  };
  collect(value);
  return mergedItems;
}

export function createDeclarationMergeAdapterState(
  value: Node,
  mode: 'list' | 'space'
): { value: Node; listValue?: Node[]; spaceValue?: Node[] } {
  const canContainMergedItems = mode === 'list'
    ? isNode(value, N.List)
    : isNode(value, N.List | N.Sequence);
  if (!canContainMergedItems) {
    return { value };
  }
  const mergedItems = collectDeclarationMergeAdapterItems(value, {
    includeSequences: mode === 'space'
  });
  if (mergedItems.length === 0) {
    return { value };
  }
  if (mergedItems.length === 1) {
    return { value: mergedItems[0]! };
  }
  return mode === 'list'
    ? { value, listValue: mergedItems }
    : { value, spaceValue: mergedItems };
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
  for (const child of node.children(true)) {
    if (isNode(child) && shouldResolveCustomPropertyValue(child)) {
      return true;
    }
  }
  return false;
};

const unwrapAtomicCustomValue = (node: Node): Node => {
  if ((isNode(node, N.Sequence) || isNode(node, N.List)) && node.value.length === 1) {
    return unwrapAtomicCustomValue(node.value[0]!);
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
  return node.value.every(child => child instanceof Node && canReuseLeaf(child));
};

type LessFunctionFallbackCall = Call & {
  value: Call['value'] & {
    name: Reference;
  };
};

const isLessFunctionFallbackCall = (node: Node): node is LessFunctionFallbackCall => (
  isNode(node, N.Call)
  && isNode(node.value.name, N.Reference)
  && node.value.name.options?.type === 'function'
  && node.value.name.options?.fallbackValue === true
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

  const { name, args } = atomicValue.value;
  const printableKey = name.value.rawKey ?? name.value.key;
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
  override allowRuleRoot = true;

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
        this.location,
        this.treeContext
      ]
    );
    return this.applyDerivedMetadata(node);
  }

  private derive(): this {
    return this.withParts({
      name: this.copyNameForDerived(this.value.name),
      value: this.copyValueForDerived(this.value.value),
      important: this.copyImportantForDerived(this.value.important)
    });
  }

  deriveWithOptions(options: Opts & DeclarationOptions): this {
    const node = this.derive();
    node.options = options;
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
    return this.valueRequiresSemi(this.value.value);
  }

  private valueRequiresSemi(value: Node): boolean {
    return !isNode(value, N.Collection) && !isNode(value, N.Mixin);
  }

  protected declTrimmedString(options?: PrintOptions) {
    return this.declValueTrimmedString(this.value, options);
  }

  private declValueTrimmedString(
    valueParts: DeclarationValue,
    options?: PrintOptions,
    renderState?: {
      customInterpolatedValue?: DeclarationRenderState['customInterpolatedValue'];
      listValue?: Node[];
      spaceValue?: Node[];
      importantText?: string;
      normalizedFromAssign?: AssignmentType;
    }
  ) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name, value, important } = valueParts;
    const { listValue, spaceValue, importantText } = renderState ?? {};
    const { assign = ':', normalizedFromAssign, setDefined } = this._options ?? {};
    const mark = w.mark();
    // setDefined uses `:=` (with default spacing rules) instead of the historical `$^` prefix.
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
      if (listValue) {
        renderListValueSyntax(listValue, options);
      } else if (spaceValue) {
        this.renderSpaceValueSyntax(spaceValue, options);
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
    value.forEach((item, index) => {
      if (index > 0) {
        w.queueSpacer(' ');
      }
      item.toString(printOptions);
    });
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.declTrimmedString(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.type !== 'Declaration') {
      return pipe(
        () => this.evalPreparedState(context),
        state => this.renderEvaluatedDeclaration(context, state, bufferOrOptions, options)
      );
    }
    return pipe(
      () => this.evalRenderState(context),
      state => this.renderDeclarationRenderState(context, state, bufferOrOptions, options)
    );
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
          name: state.name ?? state.output.value.name,
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
      listValue: state.listValue,
      spaceValue: state.spaceValue,
      customInterpolatedValue: state.customInterpolatedValue,
      importantText: state.importantText,
      normalizedFromAssign: state.normalizedFromAssign
    });
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.evalPreparedState(context),
      state => state.output
    );
  }

  private evalRenderState(context: Context): MaybePromise<DeclarationRenderState> {
    return pipe(
      () => this._prepareDeclarationRegistrationState(context, { ownParts: false }),
      state => this.evalRegistrationRenderState(context, state)
    );
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
          ...(isList ? { listValue: newValue } : { spaceValue: newValue }),
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
      value = normalized.value;
      let important = state.important;
      const { importantText } = finalizeContextualImportantState(context, important);
      return {
        name: state.name,
        value,
        listValue: normalized.listValue,
        spaceValue: normalized.spaceValue,
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
    const replacements = [...node.value.replacements];
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
  ): { value: Node; listValue?: Node[]; spaceValue?: Node[] } {
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
      return { value };
    }
    let emptyPlaceholder: Node | undefined;
    const collect = (child: Node): void => {
      if (
        (isListMergedAssign && isNode(child, N.List))
        || (isSpaceMergedAssign && isNode(child, N.Sequence))
      ) {
        for (const item of child.value) {
          collect(item);
        }
        return;
      }
      const isEmptyPlaceholder = (
        isNode(child, N.Nil)
        || String(child.valueOf?.() ?? '') === ''
      );
      if (isEmptyPlaceholder) {
        emptyPlaceholder ??= child;
      }
    };
    collect(value);
    const adapter = createDeclarationMergeAdapterState(value, isListMergedAssign ? 'list' : 'space');
    const mergedItems = adapter.listValue ?? adapter.spaceValue ?? (adapter.value !== value ? [adapter.value] : []);
    if (mergedItems.length === 0) {
      return { value: emptyPlaceholder ?? value };
    }
    return adapter;
  }

  private evalPreparedState(context: Context): MaybePromise<DeclarationEvalState> {
    return pipe(
      () => this.evalPreparedValueState(context),
      valueState => valueState instanceof Nil
        ? valueState
        : this.materializeValueState(valueState),
      output => ({
        output,
        name: output instanceof Declaration ? output.value.name : undefined,
        value: output instanceof Declaration ? output.value.value : undefined,
        important: output instanceof Declaration ? output.value.important : undefined,
        nil: output instanceof Nil
      })
    );
  }

  private evalPreparedValueState(context: Context): MaybePromise<DeclarationValueState<this> | Nil> {
    return pipe(
      () => this.prepareRegistration(context),
      node => node.evalValueState(context)
    );
  }

  override prepareRegistration(context: Context): MaybePromise<this> {
    return pipe(
      () => this._prepareDeclarationRegistrationState(context),
      state => this.materializeRegistrationState(state)
    );
  }

  private createRegistrationState(): DeclarationRegistrationState {
    return {
      name: this.copyNameForDerived(this.value.name),
      value: this.copyValueForDerived(this.value.value),
      important: this.copyImportantForDerived(this.value.important)
    };
  }

  private createRenderRegistrationState(): DeclarationRegistrationState {
    return {
      name: this.value.name,
      value: this.value.value,
      important: this.value.important,
      renderOnly: true
    };
  }

  private _prepareDeclarationRegistrationState(
    context: Context,
    options: { ownParts?: boolean } = {}
  ): MaybePromise<DeclarationRegistrationState> {
    const state = options.ownParts === false
      ? this.createRenderRegistrationState()
      : this.createRegistrationState();
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
          const isLessMergeAssign = (assignValue: string): boolean => (
            assignValue === AssignmentType.MergeList
            || assignValue === AssignmentType.MergeSequence
            || assignValue === '+,:'
            || assignValue === '+_:'
          );
          const ref = new Reference({ key: referenceKey }, {
            type,
            fallbackValue: new Nil(),
            // Assignment normalization clears `assign` to Default, so matching by
            // assignment flag prevents later merge iterations from seeing prior values.
            // For Less-style property merges, any prior merge node participates in the chain,
            // but plain declarations do not.
            // Exclude only the current node to avoid self-reference.
            filter: n => (
              n !== outputNode
              && n !== this
              && isLessMergeAssign(String(n.options?.normalizedFromAssign ?? ''))
            )
          });
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
            });
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
                new Reference({ key: referenceKey }, { type }),
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
            })
          );
          break;
        }
      }
      state.normalizedFromAssign = normalizedAssign;
    }
  }

  private materializeRegistrationState(state: DeclarationRegistrationState): this {
    const node = this.withParts({
      name: state.name,
      value: state.value,
      important: state.important
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
        value: this.value.value,
        important: this.value.important,
        changed: false
      };
    }
    return pipe(
      () => {
        let node = this;
        const state: DeclarationValueState = {
          source: node,
          value: node.value.value,
          important: node.value.important,
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
          setVal(new List(mergedItems.map(item => (
            this.ownMergedAssignmentOutputItem(item)
          ))));
        };
        /** Registration prep already stabilized the name; eval handles the value. */
        if (node.type === 'VarDeclaration') {
          return state;
        }
        const { name, value } = node.value;
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
    );
  }

  private materializeValueState(state: DeclarationValueState<this>): this {
    const node = state.source;
    if (!state.changed) {
      return node;
    }
    const output = node.withParts({
      name: this.copyNameForDerived(node.value.name),
      value: state.value === node.value.value
        ? this.copyValueForDerived(state.value)
        : state.value,
      important: state.important === node.value.important
        ? this.copyImportantForDerived(state.important)
        : state.important
    });
    output.registrationPrepared = node.registrationPrepared;
    return output;
  }

  override evalNode(context: Context): MaybePromise<this | Nil> {
    return pipe(
      () => this.evalValueState(context),
      state => state instanceof Nil ? state : this.materializeValueState(state)
    ) as MaybePromise<this | Nil>;
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
  location?: LocationInfo,
  treeContext?: TreeContext
) => {
  if (!isDeclarationValue(value)) {
    return new Declaration({
      name: any(value.name, { role: 'property' }),
      value: value.value,
      important: value.important
    }, options, location, treeContext);
  }
  return new Declaration(value, options, location, treeContext);
};
