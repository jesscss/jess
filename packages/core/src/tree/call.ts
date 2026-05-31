import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, F_STATIC, type NodeLocation, type TreeContext } from './node.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { cast } from './util/cast.js';
import { callWithContext, getRawArgsPlacement, setRawArgsPlacement } from '../define-function.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { Paren } from './paren.js';
import { isThenable, pipe, type MaybePromise } from '@jesscss/awaitable-pipe';
import { callableRulesEntry, MixinCollection, Rules } from './rules.js';
import { Any } from './any.js';
import { copyWithReusableLeaves } from './util/cloning.js';
import { List, list } from './list.js';
import { Reference } from './reference.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderTextResult
} from './util/render-buffer.js';

function stringifyValueOf(value: unknown): string {
  if (value && typeof value === 'object' && 'valueOf' in value) {
    return String((value as { valueOf(): unknown }).valueOf());
  }
  return String(value);
}

function isExtendedFn(value: unknown): value is ExtendedFn {
  return typeof value === 'function';
}

function createImportantFlag(): Any<'flag'> {
  return new Any<'flag'>('!important', { role: 'flag' });
}

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin or variable lookup
   *   e.g. $|#mixin|.class() is -> [Call name: [Ref (#mixin.class)], args: []]
   */
  name: string | Node;
  args?: List<Node>;
  /**
   * Optional content node, used for passing blocks to mixins/functions.
   * This is how Jess represents "call with content block" forms like:
   *   $ > foo(): @{ ... }
   * or:
   *   $ > foo(): @($x) { ... }
   */
  contentNode?: Node;
};

export type CallOptions = {
  /**
   * Legacy Less feature -- if a ruleset is returned,
   * all the properties can be marked as important.
   */
  markImportant?: boolean;
  silentFail?: boolean;
  /** Parser-provided hint for modern color-call syntax (space/slash form). */
  modernSyntax?: boolean;
};

type CallEvalState = {
  source: Call;
  name: string | Node;
  args?: List<Node>;
  contentNode?: Node;
  caller?: Call;
  markImportant?: boolean;
  preservesRulesLikeVariableTarget: boolean;
};

type FinalizedCallSyntax = {
  name: string | Node;
  args?: List<Node>;
  contentNode?: Node;
};

type CallContentPlacementState = {
  source: Call;
  contentNode: Node;
  reusesSourceContent: boolean;
  output?: Node;
};

type CallRawArgsPlacementState = {
  source: Call;
  sourceArgs: List<Node>;
};

export type CallRawArgDiagnosticSource = {
  source: Call;
  sourceArg: Node;
  index: number;
};

type OptionalFallbackRenderOutput = Node | string;

export function getCallRawArgsPlacement(rawArgs: List<Node>): CallRawArgsPlacementState | undefined {
  const placement = getRawArgsPlacement(rawArgs);
  if (!placement || !(placement.source instanceof Call) || !isNode(placement.sourceArgs, N.List)) {
    return undefined;
  }
  return {
    source: placement.source,
    sourceArgs: placement.sourceArgs
  };
}

export function getCallRawArgSourceNode(rawArgs: List<Node>, index: number): Node | undefined {
  const placement = getCallRawArgsPlacement(rawArgs);
  return placement?.sourceArgs.value[index];
}

export function getCallRawArgDiagnosticSource(rawArgs: List<Node>, index: number): CallRawArgDiagnosticSource | undefined {
  const placement = getCallRawArgsPlacement(rawArgs);
  const sourceArg = placement?.sourceArgs.value[index];
  if (!placement || !sourceArg) {
    return undefined;
  }
  return {
    source: placement.source,
    sourceArg,
    index
  };
}

export function getCallRawArgDiagnosticMessageSource(rawArgs: List<Node>, index: number): string | undefined {
  const diagnosticSource = getCallRawArgDiagnosticSource(rawArgs, index);
  if (!diagnosticSource) {
    return undefined;
  }
  return `argument ${diagnosticSource.index + 1} from ${diagnosticSource.source.valueOf()}`;
}

/**
 * This is an exported type that allows extra properties
 * and specifies the shape of `this` for a function call.
 */
export type ExtendedFn<T extends unknown[] = unknown[], R = unknown> = ((this: Context, ...args: T) => R) & {
  /**
   * Allow for optional calling, which means an optional
   * reference to a function will output a stringified
   * function representation if there's an evaluation error.
   *
   * This is done for Less, which sets this for functions
   * that have a CSS equivalent.
   */
  allowOptional?: boolean;
  evalArgs?: boolean;
  _internal?: (this: Context, ...args: T) => R;
  options?: {
    params?: unknown;
  };
};

/**
 * @note In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export class Call extends Node<CallValue, CallOptions> {
  override _requiredSemi = true;

  private renderChildToActiveWriter(
    node: Node,
    context: Context,
    options: PrintOptions
  ): MaybePromise<string> {
    const rendered = node.eval(context);
    const writeRendered = (value: Node): string => value.toTrimmedString(options);
    return isThenable(rendered)
      ? (rendered as Promise<Node>).then(writeRendered)
      : writeRendered(rendered as Node);
  }

  private deriveCall(value: CallValue, options?: CallOptions): Call {
    return new Call(
      value,
      options,
      this.location,
      this.treeContext
    ).inherit(this);
  }

  private createEvalState(context: Context): CallEvalState {
    const preservesRulesLikeVariableTarget = isNode(this.value.name, N.Reference) && this.value.name.options?.type === 'variable';
    const name = typeof this.value.name === 'string'
      ? this.value.name
      : preservesRulesLikeVariableTarget
        ? this.derivePreserveRulesLikeReference(this.value.name)
        : this.value.name;
    return {
      source: this,
      name,
      args: this.value.args,
      contentNode: this.value.contentNode,
      caller: context.caller,
      markImportant: this._options?.markImportant,
      preservesRulesLikeVariableTarget
    };
  }

  private evalState(context: Context): Promise<Node> {
    const state = this.createEvalState(context);
    return this.evalFromState(context, state).then((node) => {
      node.evaluated = true;
      if (node !== this) {
        node.inherit(this);
      }
      return node;
    });
  }

  private createFinalizedCallOutput(state: CallEvalState, syntax: FinalizedCallSyntax): Call {
    return state.source.deriveCall(
      {
        name: syntax.name,
        args: syntax.args,
        ...(syntax.contentNode && { contentNode: syntax.contentNode })
      },
      state.source._options
        ? { ...state.source._options, silentFail: false }
        : { silentFail: false }
    );
  }

  private createFinalizedCallContentState(state: CallEvalState): CallContentPlacementState | undefined {
    const { contentNode } = state;
    if (!contentNode) {
      return undefined;
    }
    const placement: CallContentPlacementState = {
      source: state.source,
      contentNode,
      reusesSourceContent: false
    };
    if (contentNode.location.length === 0 && contentNode.hasFlag(F_STATIC)) {
      contentNode.frozen = true;
      placement.reusesSourceContent = true;
      placement.output = contentNode;
      return placement;
    }
    placement.output = copyWithReusableLeaves(contentNode);
    return placement;
  }

  private createFinalizedCallContentNode(state: CallEvalState): Node | undefined {
    return this.createFinalizedCallContentState(state)?.output;
  }

  private async evalFinalizedCallSyntax(
    context: Context,
    state: CallEvalState,
    name: string | Node | unknown
  ): Promise<Call> {
    const evaluatedArgs = await state.source.evalArgNodes(
      context,
      state.args,
      { preserveSourceParents: true }
    );
    return state.source.createFinalizedCallOutput(
      state,
      {
        name: typeof name === 'string' || name instanceof Node
          ? name
          : stringifyValueOf(name),
        args: evaluatedArgs,
        contentNode: state.source.createFinalizedCallContentNode(state)
      }
    );
  }

  private derivePreserveRulesLikeReference(name: Node): Node {
    if (!isNode(name, N.Reference)) {
      return name;
    }
    if (name.options?.preserveRulesLike === true) {
      return name;
    }
    return new Reference(
      name.value,
      {
        ...name.options,
        preserveRulesLike: true
      },
      name.location.length === 0 ? undefined : name.location,
      name.treeContext
    ).inherit(name);
  }

  private async evalArgNodes(
    context: Context,
    nodes?: List<Node>,
    options?: { preserveSourceParents?: boolean }
  ): Promise<List<Node> | undefined> {
    if (!nodes) {
      return undefined;
    }
    const out: Node[] = [];
    for (const node of nodes.value) {
      const canUseStaticContainer = (
        isNode(node, N.List | N.Sequence)
        && node.location.length === 0
        && node.hasFlag(F_STATIC)
      );
      const evalTarget = options?.preserveSourceParents && isNode(node, N.List | N.Sequence) && !canUseStaticContainer
        ? copyWithReusableLeaves(node)
        : node;
      const evald = await evalTarget.eval(context) as Node;
      if (evald === node && options?.preserveSourceParents) {
        evald.frozen = true;
      }
      out.push(evald);
    }
    return list(out, nodes.options);
  }

  private markCallOutput<T extends Node>(node: T): T {
    node.inherit(this);
    if (
      isNode(node, N.Rules)
      && node.value.length > 0
      && node.value.every(child => isNode(child, N.Declaration | N.Comment))
      && !(
        isNode(this.value.name, N.Reference)
        && (this.value.name.options?.type === 'mixin'
          || this.value.name.options?.type === 'mixin-ruleset')
      )
    ) {
      node.options.callDeclarationOutput = true;
    }
    return node;
  }

  private async runInCallFrame<T>(
    context: Context,
    options: { caller?: boolean },
    work: () => Promise<T>
  ): Promise<T> {
    context.callStack.push(this);
    context.parenFrames.push(false);
    const originalCaller = context.caller;
    if (options.caller) {
      context.caller = this;
    }
    try {
      return await work();
    } finally {
      if (options.caller) {
        context.caller = originalCaller;
      }
      context.parenFrames.pop();
      context.callStack.pop();
    }
  }

  private async runAsCaller<T>(
    context: Context,
    work: () => Promise<T>
  ): Promise<T> {
    const originalCaller = context.caller;
    context.caller = this;
    try {
      return await work();
    } finally {
      context.caller = originalCaller;
    }
  }

  private evalOptionalFallbackOutput(context: Context): Promise<Node | undefined>;
  private evalOptionalFallbackOutput(
    context: Context,
    renderFailureWith: PrintOptions
  ): Promise<OptionalFallbackRenderOutput | undefined>;
  private async evalOptionalFallbackOutput(
    context: Context,
    renderFailureWith?: PrintOptions
  ): Promise<OptionalFallbackRenderOutput | undefined> {
    if (
      typeof this.value.name === 'string'
      || !this.options?.silentFail
      || this.options?.markImportant
      || this.value.contentNode
    ) {
      return undefined;
    }

    const state = this.createEvalState(context);
    const name = state.name;
    if (typeof name === 'string') {
      return undefined;
    }
    return this.runInCallFrame(context, {}, async () => {
      let evaluatedName: unknown = await name.eval(context);
      if (isNode(evaluatedName, N.Reference) && evaluatedName.options?.type === 'mixin-ruleset') {
        evaluatedName = await evaluatedName.eval(context);
      }
      const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.value : evaluatedName;
      if (isExtendedFn(fn) && !fn._internal && !fn.options?.params) {
        return this.runAsCaller(context, async () => {
          try {
            const result = state.args
              ? await callWithContext(context, fn, ...state.args.value)
              : await callWithContext(context, fn);
            if (isNode(result)) {
              return this.markCallOutput(await result.eval(context));
            }
            const castResult = cast(result);
            if (isNode(castResult, N.Rules) && castResult.value.length === 1) {
              return this.markCallOutput(castResult.value[0]!);
            }
            return this.markCallOutput(castResult);
          } catch (error) {
            const unitMode = context?.opts?.unitMode ?? 'loose';
            if (unitMode === 'strict') {
              throw error;
            }
            const fallbackName = isNode(this.value.name, N.Reference) && this.value.name.options.fallbackValue === true
              ? String(this.value.name.value.key)
              : stringifyValueOf(fn);
            if (renderFailureWith) {
              return this.renderFinalizedCallSyntax(fallbackName, state, context, renderFailureWith);
            }
            return this.markCallOutput(await this.evalFinalizedCallSyntax(context, state, fallbackName));
          }
        });
      }
      if (
        isNode(evaluatedName, N.Call | N.Mixin | N.Ruleset | N.Rules | N.Collection | N.Func)
        || evaluatedName instanceof MixinCollection
        || Array.isArray(evaluatedName)
      ) {
        return undefined;
      }
      return this.markCallOutput(await this.evalFinalizedCallSyntax(context, state, evaluatedName));
    });
  }

  private async evalPlainDynamicFunction(context: Context): Promise<Node | undefined> {
    if (
      typeof this.value.name === 'string'
      || this.value.contentNode
      || this.options?.silentFail
      || this.options?.markImportant
    ) {
      return undefined;
    }
    const state = this.createEvalState(context);
    const { name } = state;
    if (typeof name === 'string') {
      return undefined;
    }
    const evaluatedName = await name.eval(context);
    const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.value : evaluatedName;
    if (
      !isExtendedFn(fn)
      || fn._internal
      || fn.options?.params
    ) {
      return undefined;
    }

    return this.runInCallFrame(context, { caller: true }, async () => {
      const result = state.args
        ? await callWithContext(context, fn, ...state.args.value)
        : await callWithContext(context, fn);
      if (isNode(result)) {
        return this.markCallOutput(await result.eval(context));
      }
      const castResult = cast(result);
      if (isNode(castResult, N.Rules) && castResult.value.length === 1) {
        return this.markCallOutput(castResult.value[0]!);
      }
      return this.markCallOutput(castResult);
    });
  }

  private async finalizeFunctionResult(
    result: unknown,
    context: Context,
    markImportant?: boolean
  ): Promise<Node> {
    if (isNode(result)) {
      let evald = result.eval(context);
      if (isThenable(evald)) {
        evald = await evald;
      }
      if (markImportant && isNode(evald, N.Rules)) {
        this.makeImportant(evald);
      }
      return this.markCallOutput(evald);
    }
    const castResult = cast(result);
    if (isNode(castResult, N.Rules) && castResult.value.length === 1) {
      return this.markCallOutput(castResult.value[0]!);
    }
    return this.markCallOutput(castResult);
  }

  private async evalMetadataDynamicFunction(context: Context): Promise<Node | undefined> {
    if (
      typeof this.value.name === 'string'
      || this.value.contentNode
    ) {
      return undefined;
    }
    const state = this.createEvalState(context);
    const { name } = state;
    if (typeof name === 'string') {
      return undefined;
    }
    const evaluatedName = await name.eval(context);
    const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.value : evaluatedName;
    if (
      !isExtendedFn(fn)
      || (!fn._internal && !fn.options?.params)
    ) {
      return undefined;
    }

    return this.runInCallFrame(context, { caller: true }, async () => {
      const result = state.args
        ? await callWithContext(context, fn, state.args)
        : await callWithContext(context, fn);
      return await this.finalizeFunctionResult(result, context, this._options?.markImportant);
    });
  }

  private serializeRenderedArgs(
    args: List<Node> | undefined,
    context: Context,
    options: PrintOptions
  ): MaybePromise<string> {
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer!;
    const mark = w.mark();
    if (!args) {
      return '';
    }
    const normalizedArgs = args.value.filter(Boolean);
    const last = normalizedArgs.length - 1;
    const serializeArgAt = (i: number): MaybePromise<string> => {
      if (i > last) {
        return w.getSince(mark);
      }
      const arg = normalizedArgs[i]!;
      const finishArg = (argMark: number): MaybePromise<string> => {
        w.trimHorizontalStartSince(argMark);
        w.trimHorizontalEndSince(argMark);
        if (i < last) {
          w.add(', ');
        }
        return serializeArgAt(i + 1);
      };
      if (arg instanceof Paren && arg.options?.escaped) {
        w.add('(', arg);
        if (arg.value) {
          const innerMark = w.mark();
          const rendered = this.renderChildToActiveWriter(arg.value, context, printOptions);
          const finishParen = (): MaybePromise<string> => {
            w.trimHorizontalStartSince(innerMark);
            w.trimHorizontalEndSince(innerMark);
            w.add(')', arg);
            if (i < last) {
              w.add(', ');
            }
            return serializeArgAt(i + 1);
          };
          return isThenable(rendered)
            ? rendered.then(finishParen)
            : finishParen();
        }
        w.add(')', arg);
        if (i < last) {
          w.add(', ');
        }
        return serializeArgAt(i + 1);
      } else {
        const argMark = w.mark();
        const rendered = this.renderChildToActiveWriter(arg, context, printOptions);
        return isThenable(rendered)
          ? rendered.then(() => finishArg(argMark))
          : finishArg(argMark);
      }
    };
    return serializeArgAt(0);
  }

  private renderPlainFunctionCall(
    callNode: Call,
    context: Context,
    prepared: PrintOptions
  ): MaybePromise<string> {
    const w = getPrintOptions(prepared).writer!;
    const mark = w.mark();
    const { name, contentNode } = callNode.value;
    if (typeof name === 'string') {
      w.add(name, callNode);
    } else {
      name.toTrimmedString(prepared);
    }
    if (callNode.options?.silentFail) {
      w.add('?');
    }
    w.add('(');
    const isCalc = name === 'calc';
    if (isCalc) {
      context.calcFrames++;
    }
    const finishCall = (): MaybePromise<string> => {
      if (isCalc) {
        context.calcFrames--;
      }
      w.add(')');
      if (callNode.options?.markImportant) {
        w.add(' !important');
      }
      if (contentNode) {
        w.add(': ');
        const renderedContent = this.renderChildToActiveWriter(contentNode, context, prepared);
        return isThenable(renderedContent)
          ? renderedContent.then(() => w.getSince(mark))
          : w.getSince(mark);
      }
      return w.getSince(mark);
    };
    let renderedArgs: MaybePromise<string>;
    try {
      renderedArgs = this.serializeRenderedArgs(callNode.value.args, context, prepared);
    } catch (error) {
      if (isCalc) {
        context.calcFrames--;
      }
      throw error;
    }
    if (isThenable(renderedArgs)) {
      return renderedArgs.then(finishCall, (error: unknown) => {
        if (isCalc) {
          context.calcFrames--;
        }
        throw error;
      });
    }
    return finishCall();
  }

  private renderFinalizedCallSyntax(
    name: string | Node | unknown,
    state: CallEvalState,
    context: Context,
    prepared: PrintOptions
  ): MaybePromise<string> {
    const w = getPrintOptions(prepared).writer!;
    const mark = w.mark();
    if (typeof name === 'string') {
      w.add(name, state.source);
    } else if (name instanceof Node) {
      name.toTrimmedString(prepared);
    } else {
      w.add(stringifyValueOf(name), state.source);
    }
    w.add('(');
    const finishCall = (): MaybePromise<string> => {
      w.add(')');
      if (state.markImportant) {
        w.add(' !important');
      }
      if (state.contentNode) {
        w.add(': ');
        const renderedContent = this.renderChildToActiveWriter(state.contentNode, context, prepared);
        return isThenable(renderedContent)
          ? renderedContent.then(() => w.getSince(mark))
          : w.getSince(mark);
      }
      return w.getSince(mark);
    };
    const renderedArgs = this.serializeRenderedArgs(state.args, context, prepared);
    return isThenable(renderedArgs)
      ? renderedArgs.then(finishCall)
      : finishCall();
  }

  private async renderOptionalFallbackCallSyntax(
    context: Context,
    prepared: PrintOptions
  ): Promise<string | undefined> {
    if (
      typeof this.value.name === 'string'
      || !this.options?.silentFail
    ) {
      return undefined;
    }

    const state = this.createEvalState(context);
    const name = state.name;
    if (typeof name === 'string') {
      return undefined;
    }
    return this.runInCallFrame(context, {}, async () => {
      let evaluatedName: unknown = await name.eval(context);
      if (isNode(evaluatedName, N.Reference) && evaluatedName.options?.type === 'mixin-ruleset') {
        evaluatedName = await evaluatedName.eval(context);
      }
      const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.value : evaluatedName;
      if (isExtendedFn(fn)) {
        return undefined;
      }
      if (
        isNode(evaluatedName, N.Call | N.Mixin | N.Ruleset | N.Rules | N.Collection | N.Func)
        || evaluatedName instanceof MixinCollection
        || Array.isArray(evaluatedName)
      ) {
        return undefined;
      }
      return this.renderFinalizedCallSyntax(evaluatedName, state, context, prepared);
    });
  }

  constructor(value: CallValue, options?: CallOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    // Function calls are always non-static and may be async
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  override toTrimmedString(options?: PrintOptions) {
    const silentFail = this._options?.silentFail;
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { name, contentNode } = this.value;
    const args = this.value.args;
    if (typeof name === 'string') {
      w.add(name, this);
    } else {
      name.toString(options);
    }
    if (silentFail) {
      w.add('?');
    }
    w.add('(');
    if (args) {
      const argsMark = w.mark();
      args.toTrimmedString(options);
      w.trimHorizontalStartSince(argsMark);
      w.trimHorizontalEndSince(argsMark);
    }
    w.add(')');
    if (this._options?.markImportant) {
      w.add(' !important');
    }
    if (contentNode) {
      w.add(': ');
      contentNode.toString(options);
    }
    return w.getSince(mark);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      if (this.evaluated) {
        const prepared = prepareBufferPrintState(context, options);
        return writeRenderTextResult(
          bufferOrOptions,
          this.renderPlainFunctionCall(this, context, prepared)
        );
      }
      if (typeof this.value.name !== 'string') {
        const prepared = prepareBufferPrintState(context, options);
        return pipe(
          () => this.evalPlainDynamicFunction(context),
          node => node
            ? this.renderOutput(context, node, bufferOrOptions, options)
            : pipe(
                () => this.renderOptionalFallbackCallSyntax(context, prepared),
                fallbackText => fallbackText
                  ? writeRenderTextResult(bufferOrOptions, fallbackText)
                  : pipe(
                      () => this.evalOptionalFallbackOutput(context, prepared),
                      fallback => fallback
                        ? (
                            typeof fallback === 'string'
                              ? writeRenderTextResult(bufferOrOptions, fallback)
                              : this.renderOutput(context, fallback, bufferOrOptions, options)
                          )
                        : pipe(
                            () => this.evalMetadataDynamicFunction(context),
                            metadataOutput => metadataOutput
                              ? this.renderOutput(context, metadataOutput, bufferOrOptions, options)
                              : pipe(
                                  () => this.evalState(context),
                                  output => this.renderOutput(context, output, bufferOrOptions, options)
                                )
                          )
                    )
              )
        );
      }
      // Plain CSS calls render args/content explicitly so async child failures
      // keep calc-frame cleanup instead of falling back to source text.
      const prepared = prepareBufferPrintState(context, options);
      return writeRenderTextResult(
        bufferOrOptions,
        this.renderPlainFunctionCall(this, context, prepared)
      );
    }
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    if (this.evaluated) {
      return this.renderPlainFunctionCall(this, context, prepared);
    }
    if (typeof this.value.name === 'string') {
      return this.renderPlainFunctionCall(this, context, prepared);
    }
    return pipe(
      () => this.evalPlainDynamicFunction(context),
      node => node
        ? this.renderOutput(context, node, bufferOrOptions, options)
        : pipe(
            () => this.renderOptionalFallbackCallSyntax(context, prepared),
            fallbackText => fallbackText
              ? fallbackText
              : pipe(
                  () => this.evalOptionalFallbackOutput(context, prepared),
                  fallback => fallback
                    ? (
                        typeof fallback === 'string'
                          ? fallback
                          : this.renderOutput(context, fallback, bufferOrOptions, options)
                      )
                    : pipe(
                        () => this.evalMetadataDynamicFunction(context),
                        metadataOutput => metadataOutput
                          ? this.renderOutput(context, metadataOutput, bufferOrOptions, options)
                          : pipe(
                              () => this.evalState(context),
                              output => this.renderOutput(context, output, bufferOrOptions, options)
                            )
                      )
                )
          )
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.evaluated) {
      return this;
    }
    if (
      typeof this.value.name === 'string'
      && !this.value.contentNode
    ) {
      return this.evalNode(context);
    }
    return pipe(
      () => this.evalPlainDynamicFunction(context),
      node => node ?? pipe(
        () => this.evalOptionalFallbackOutput(context),
        fallback => fallback ?? pipe(
          () => this.evalMetadataDynamicFunction(context),
          metadataOutput => metadataOutput ?? this.evalState(context)
        )
      )
    );
  }

  /** Recursively makes declarations important */
  makeImportant(rules: Rules): Rules {
    const important = createImportantFlag();
    for (const rule of rules.value) {
      if (isNode(rule, N.Declaration)) {
        rule.value.important = important;
      } else if (isNode(rule, N.Rules)) {
        this.makeImportant(rule);
      } else if (isNode(rule, N.AtRule)) {
        if (rule.value.rules) {
          this.makeImportant(rule.value.rules);
        }
      } else if (isNode(rule, N.Ruleset)) {
        if (rule.value.rules) {
          this.makeImportant(rule.value.rules);
        }
      }
    }
    return rules;
  }

  /** Come back and redo -- too hard to reason about as a MaybePromise */
  override async evalNode(context: Context): Promise<Node> {
    const state = this.createEvalState(context);
    return this.evalFromState(context, state);
  }

  private async evalFromState(context: Context, state: CallEvalState): Promise<Node> {
    return this.runInCallFrame(context, {}, () => this.evalFromStateInFrame(context, state));
  }

  private async evalFromStateInFrame(context: Context, state: CallEvalState): Promise<Node> {
    const { name, args, markImportant } = state;

    let n: string | Node | MixinCollection | unknown;
    if (typeof name === 'string') {
      n = name;
    } else {
      n = await name.eval(context);
    }
    // Resolve mixin reference only at call time (same as variable refs: evaluate when used, not when stored).
    if (isNode(n, N.Reference) && n.options?.type === 'mixin-ruleset') {
      n = await n.eval(context);
    }
    // Note: Stylesheet-defined functions should be represented as a Reference(type='function')
    // by parsers that support them. We intentionally avoid implicit string→function lookup here
    // to prevent surprising behavior for plain CSS function-like calls.
    // If the evaluated name is a Call node, execute it directly
    // This handles cases like @alias: .something(foo); @alias();
    if (isNode(n, N.Call)) {
      // Execute the inner Call node (it will handle its own callStack push/pop)
      const result = await n.eval(context);
      // Apply markImportant if needed
      if (markImportant && isNode(result, N.Rules)) {
        this.makeImportant(result);
      }
      return result;
    } else if (isNode(n, N.Mixin) || isNode(n, N.Ruleset) || Array.isArray(n)) {
      n = new MixinCollection(Array.isArray(n) ? n : [n]);
    } else if (n instanceof MixinCollection) {
      // already a MixinCollection from Reference, use as-is
    } else if (isNode(n, N.Func)) {
      // Execute stylesheet-defined functions via their evalCall behavior.
      const argNodes = await this.evalArgNodes(context, args) ?? list([]);
      const result = await n.evalCall(context, argNodes);
      return result;
    } else if (isNode(n, N.Rules) || isNode(n, N.Collection)) {
      // PreserveRulesLike variable calls intentionally evaluate from the
      // detached ruleset's lexical parent. Removing this lets non-leaky calls
      // see caller variables; see call.test.ts "does not let detached ruleset
      // calls read caller scope in non-leaky mode".
      if (state.preservesRulesLikeVariableTarget) {
        const sourceParent = n.sourceNode?.parent;
        if (sourceParent) {
          Reflect.set(n, 'parent', sourceParent);
        }
      }
      // Detached rulesets/collections share the same callable-body path as
      // anonymous mixin bodies. They still reject explicit arguments.
      if (args && args.value.length > 0) {
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      n = new MixinCollection([
        callableRulesEntry(
          { rules: n },
          n.parent,
          n.index
        )
      ]);
    }

    if (n instanceof MixinCollection) {
      return this.runAsCaller(context, async () => {
        try {
          const result = await n.evalCall(context, args);
          if (isNode(result)) {
            let evald = result.eval(context);
            if (isThenable(evald)) {
              evald = await evald;
            }
            if (markImportant && isNode(evald, N.Rules)) {
              this.makeImportant(evald);
            }
            return this.markCallOutput(evald);
          }
          return this.markCallOutput(cast(result));
        } catch (e) {
          if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
            if (this.parent?.type === 'SelectorCapture') {
              return this.markCallOutput(new Any(stringifyValueOf(n), { role: 'ident' }).inherit(this));
            }
            if (isNode(name, N.Reference)) {
              throw new ReferenceError(`No matching mixins found for '${name.value.key.valueOf()}'`);
            }
            throw e;
          }
          if (!this._options?.silentFail) {
            throw e;
          }
          const fallbackName = isNode(name, N.Reference) && name.options.fallbackValue === true
            ? String(name.value.key)
            : stringifyValueOf(n);
          return this.markCallOutput(await this.evalFinalizedCallSyntax(context, state, fallbackName));
        }
      });
    }

    let fn = isNode(n, N.JsFunction) ? n.value : n;
    if (isExtendedFn(fn)) {
      const callable = fn;
      return this.runAsCaller(context, async () => {
        try {
          const shouldPassListArgs = Boolean(callable._internal || callable.options?.params);
          let callArgs = args;
          if (shouldPassListArgs && callArgs && state.args) {
            setRawArgsPlacement(callArgs, {
              source: state.source,
              sourceArgs: state.args
            });
          }
          const result = await (
            callArgs
              ? (
                  shouldPassListArgs
                    ? callWithContext(context, callable, callArgs)
                    : callWithContext(context, callable, ...callArgs.value)
                )
              : callWithContext(context, callable)
          );
          if (isNode(result)) {
            let evald = result.eval(context);
            if (isThenable(evald)) {
              evald = await evald;
              if (markImportant && isNode(evald, N.Rules)) {
                this.makeImportant(evald);
              }
              return this.markCallOutput(evald);
            }
            if (markImportant && isNode(evald, N.Rules)) {
              this.makeImportant(evald);
            }
            return this.markCallOutput(evald);
          }
          let castResult = cast(result);
          if (isNode(castResult, N.Rules) && castResult.value.length === 1) {
            return this.markCallOutput(castResult.value[0]!);
          }
          return this.markCallOutput(castResult);
        } catch (e) {
          const unitMode = context?.opts?.unitMode ?? 'loose';
          const shouldRethrowForMode = unitMode === 'strict';
          if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
            if (this.parent?.type === 'SelectorCapture') {
              return this.markCallOutput(new Any(stringifyValueOf(n), { role: 'ident' }).inherit(this));
            }
            if (isNode(name, N.Reference)) {
              throw new ReferenceError(`No matching mixins found for '${name.value.key.valueOf()}'`);
            }
            throw e;
          }
          if (!this._options?.silentFail || shouldRethrowForMode) {
            throw e;
          }
          const fallbackName = isNode(name, N.Reference) && name.options.fallbackValue === true
            ? String(name.value.key)
            : stringifyValueOf(n);
          return this.markCallOutput(await this.evalFinalizedCallSyntax(context, state, fallbackName));
        }
      });
    } else {
      if (n === 'calc') {
        context.calcFrames++;
      }
      const evaluatedArgs = await this.evalArgNodes(context, args, { preserveSourceParents: true })
        .finally(() => {
          if (n === 'calc') {
            context.calcFrames--;
          }
        });
      if (
        n === 'calc' && evaluatedArgs
      ) {
        if (isNode(evaluatedArgs.value[0], N.Dimension)) {
          return evaluatedArgs.value[0]!;
        } else if (context.calcFrames !== 0) {
          return new Paren(evaluatedArgs.value[0]!);
        }
      }
      const node = this.createFinalizedCallOutput(
        state,
        {
          name: typeof n === 'string' || n instanceof Node ? n : stringifyValueOf(n),
          args: evaluatedArgs,
          contentNode: this.createFinalizedCallContentNode(state)
        }
      );
      return this.markCallOutput(node);
    };
  }
}

type Params = ConstructorParameters<typeof Call>;

export const call = defineType(Call, 'Call') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Call;
