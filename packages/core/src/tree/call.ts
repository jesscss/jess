import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type NodeLocation } from './node.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { cast } from './util/cast.js';
import { callWithContext, getRawArgsPlacement, setRawArgsPlacement } from '../define-function.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { Paren } from './paren.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { Rules } from './rules.js';
import { callableRulesEntry } from './util/callable-entry.js';
import { MixinCollection } from './util/callable-collection.js';
import { evaluateCallableCollection } from './util/callable-eval.js';
import { Any } from './any.js';
import { List, list } from './list.js';
import { Reference } from './reference.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  type RenderBuffer,
  writeRenderTextResult
} from './util/render-buffer.js';
import { emitCommentTriviaBetweenNodes } from './util/trivia.js';
import { copyWithReusableLeaves } from './util/cloning.js';

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

function withMixinRulesetCallArgsHint(name: string | Node, args?: List<Node>): string | Node;
function withMixinRulesetCallArgsHint<T extends unknown>(name: T, args?: List<Node>): T | Reference;
function withMixinRulesetCallArgsHint<T extends unknown>(name: T, args?: List<Node>): T | Reference {
  if (
    args?.items.length
    && isNode(name, N.Reference)
    && name.options?.type === 'mixin-ruleset'
    && name.options.mixinRulesetCallHasArgs !== true
  ) {
    return new Reference(
      name.value,
      {
        ...name.options,
        mixinRulesetCallHasArgs: true
      },
      name.location.length === 0 ? undefined : name.location,
      name.sourceRoot?._treeContext
    );
  }
  return name;
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
  preservesRulesLikeVariableTarget: boolean;
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
type CallRenderTextState = { text: string | undefined };

function getKnownRenderedCallText(node: Node): string | undefined {
  switch (node.type) {
    case 'Any':
    case 'Keyword':
    case 'Anonymous':
      return typeof node.value === 'string' ? node.value : undefined;
    case 'Bool':
      return node.value ? 'true' : 'false';
    case 'Num':
      return typeof node.number === 'number' ? `${node.number}` : undefined;
    case 'Color':
      return typeof node.node === 'string' ? node.node : undefined;
    case 'List': {
      const parts = new Array<string>(node.items.length);
      for (let i = 0; i < node.items.length; i++) {
        const text = getKnownRenderedCallText(node.items[i]!);
        if (text === undefined) {
          return undefined;
        }
        parts[i] = text;
      }
      const sep = node.options?.sep ?? ',';
      if (sep === '/') {
        return parts.join(' / ');
      }
      return parts.join(`${sep} `);
    }
    case 'Sequence': {
      if (node.preserveWhitespace) {
        return undefined;
      }
      const parts = new Array<string>(node.items.length);
      for (let i = 0; i < node.items.length; i++) {
        const text = getKnownRenderedCallText(node.items[i]!);
        if (text === undefined) {
          return undefined;
        }
        parts[i] = text;
      }
      return parts.join(' ');
    }
    case 'Paren': {
      const open = node.options?.delimiter === 'square' ? '[' : '(';
      const close = node.options?.delimiter === 'square' ? ']' : ')';
      if (!node.value) {
        return `${open}${close}`;
      }
      const value = getKnownRenderedCallText(node.value);
      if (value === undefined) {
        return undefined;
      }
      return `${open}${value}${close}`;
    }
    default:
      return undefined;
  }
}

function getKnownSourceCallText(node: Node): string | undefined {
  switch (node.type) {
    case 'Any':
    case 'Keyword':
    case 'Anonymous':
      return typeof node.value === 'string' ? node.value : undefined;
    case 'Bool':
      return node.value ? 'true' : 'false';
    case 'Num':
      return typeof node.number === 'number' ? `${node.number}` : undefined;
    case 'Color':
      return typeof node.node === 'string' ? node.node : undefined;
    case 'List': {
      const parts = new Array<string>(node.items.length);
      for (let i = 0; i < node.items.length; i++) {
        const text = getKnownSourceCallText(node.items[i]!);
        if (text === undefined) {
          return undefined;
        }
        parts[i] = text;
      }
      const sep = node.options?.sep ?? ',';
      if (sep === '/') {
        return parts.join(' / ');
      }
      return parts.join(`${sep} `);
    }
    case 'Sequence': {
      if (node.preserveWhitespace) {
        return undefined;
      }
      const parts = new Array<string>(node.items.length);
      for (let i = 0; i < node.items.length; i++) {
        const text = getKnownSourceCallText(node.items[i]!);
        if (text === undefined) {
          return undefined;
        }
        parts[i] = text;
      }
      return parts.join(' ');
    }
    case 'Paren': {
      const open = node.options?.delimiter === 'square' ? '[' : '(';
      const close = node.options?.delimiter === 'square' ? ']' : ')';
      if (!node.value) {
        return `${node.options?.escaped ? '~' : ''}${open}${close}`;
      }
      const value = getKnownSourceCallText(node.value);
      if (value === undefined) {
        return undefined;
      }
      return `${node.options?.escaped ? '~' : ''}${open}${value}${close}`;
    }
    default:
      return undefined;
  }
}

function callRenderSharesWriter(bufferOrOptions?: RenderBuffer | PrintOptions): bufferOrOptions is RenderBuffer & { shareWriter: true } {
  return Boolean(isRenderBuffer(bufferOrOptions) && 'shareWriter' in bufferOrOptions && bufferOrOptions.shareWriter);
}

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
  return placement?.sourceArgs.items[index];
}

export function getCallRawArgDiagnosticSource(rawArgs: List<Node>, index: number): CallRawArgDiagnosticSource | undefined {
  const placement = getCallRawArgsPlacement(rawArgs);
  const sourceArg = placement?.sourceArgs.items[index];
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
  static override childKeys = ['name', 'args', 'contentNode'] as const;

  readonly name: CallValue['name'];
  readonly args: CallValue['args'];
  readonly contentNode: CallValue['contentNode'];

  override _requiredSemi = true;

  private createEvalState(): CallEvalState {
    const preservesRulesLikeVariableTarget = isNode(this.name, N.Reference) && this.name.options?.type === 'variable';
    let name = this.name;
    if (
      preservesRulesLikeVariableTarget
      && isNode(name, N.Reference)
      && name.options?.preserveRulesLike !== true
    ) {
      name = new Reference(
        name.value,
        {
          ...name.options,
          preserveRulesLike: true
        },
        name.location.length === 0 ? undefined : name.location,
        name.sourceRoot?._treeContext
      );
    }
    name = withMixinRulesetCallArgsHint(name, this.args);
    return {
      source: this,
      name,
      args: this.args,
      contentNode: this.contentNode,
      preservesRulesLikeVariableTarget
    };
  }

  private evalState(context: Context): Promise<Node> {
    const state = this.createEvalState();
    return this.evalFromState(context, state).then((node) => {
      node.evaluated = true;
      if (node !== this) {
        node.inherit(this);
      }
      return node;
    });
  }

  private async evalOptionalFallbackCallSyntax(
    context: Context,
    state: CallEvalState,
    name: Node | string | unknown,
    fallbackValue: unknown
  ): Promise<Node> {
    const fallbackName = isNode(name, N.Reference) && name.options.fallbackValue === true
      ? String(name.key)
      : stringifyValueOf(fallbackValue);
    const rendered = await state.source.renderFinalizedCallSyntax(fallbackName, state, context, prepareRenderPrintState(context), {
      args: state.args,
      ...(state.contentNode && { contentNode: state.contentNode })
    });
    return state.source.markCallOutput(new Any(rendered, { role: 'any' }));
  }

  private async evalArgNodes(
    context: Context,
    nodes?: List<Node>,
    options?: { ownResults?: boolean }
  ): Promise<List<Node> | undefined> {
    if (!nodes) {
      return undefined;
    }
    const ownResults = options?.ownResults ?? true;
    const source = nodes.items;
    const out = new Array<Node>(source.length);
    let changed = false;
    const evalImmediate = (node: Node): Node => {
      const evald = node.evaluated ? node : node.evalNode(context);
      if (!(evald instanceof Node)) {
        throw new TypeError('Expected sync node result.');
      }
      evald.evaluated = true;
      if (node !== evald) {
        evald.inherit(node);
      }
      return evald;
    };
    const continueAsync = async (startIndex: number, first: Promise<Node>): Promise<List<Node>> => {
      let evald = await first;
      out[startIndex] = evald === source[startIndex]!
        ? ownResults ? copyWithReusableLeaves(evald) : evald
        : evald;
      changed ||= evald !== source[startIndex]!;
      for (let i = startIndex + 1; i < source.length; i++) {
        const next = source[i]!;
        let nextEvald: Node;
        if (
          !next.hasFlag(F_MAY_ASYNC)
          && next.eval === Node.prototype.eval
        ) {
          nextEvald = evalImmediate(next);
        } else {
          nextEvald = await next.eval(context) as Node;
        }
        out[i] = nextEvald === next
          ? ownResults ? copyWithReusableLeaves(nextEvald) : nextEvald
          : nextEvald;
        changed ||= nextEvald !== next;
      }
      return !ownResults && !changed ? nodes : list(out, nodes.options);
    };
    for (let i = 0; i < source.length; i++) {
      const node = source[i]!;
      if (
        !node.hasFlag(F_MAY_ASYNC)
        && node.eval === Node.prototype.eval
      ) {
        const evald = evalImmediate(node);
        out[i] = evald === node
          ? ownResults ? copyWithReusableLeaves(evald) : evald
          : evald;
        changed ||= evald !== node;
        continue;
      }
      const evald = node.eval(context);
      if (isThenable(evald)) {
        return continueAsync(i, evald as Promise<Node>);
      }
      const resolved = evald as Node;
      out[i] = resolved === node
        ? ownResults ? copyWithReusableLeaves(resolved) : resolved
        : resolved;
      changed ||= resolved !== node;
    }
    return !ownResults && !changed ? nodes : list(out, nodes.options);
  }

  private markCallOutput<T extends Node>(node: T, ownOutput = true): T {
    if (ownOutput) {
      node.inherit(this);
    }
    if (!isNode(node, N.Rules) || node.rules.length === 0) {
      return node;
    }
    let hasOnlyDeclarationsAndComments = true;
    for (let i = 0; i < node.rules.length; i++) {
      if (!isNode(node.rules[i]!, N.Declaration | N.Comment)) {
        hasOnlyDeclarationsAndComments = false;
        break;
      }
    }
    if (
      hasOnlyDeclarationsAndComments
      && !(
        isNode(this.name, N.Reference)
        && (this.name.options?.type === 'mixin'
          || this.name.options?.type === 'mixin-ruleset')
      )
    ) {
      node.options.callDeclarationOutput = true;
    }
    return node;
  }

  private async finalizeCallResult(
    context: Context,
    result: unknown,
    options?: {
      ownOutput?: boolean;
      markImportant?: boolean;
    }
  ): Promise<Node> {
    const ownOutput = options?.ownOutput ?? true;
    if (isNode(result)) {
      let evald = result.eval(context);
      if (isThenable(evald)) {
        evald = await evald;
      }
      if (options?.markImportant && isNode(evald, N.Rules)) {
        this.makeImportant(evald);
      }
      return this.markCallOutput(evald, ownOutput);
    }
    const castResult = cast(result);
    if (isNode(castResult, N.Rules) && castResult.rules.length === 1) {
      return this.markCallOutput(castResult.rules[0]!, ownOutput);
    }
    return this.markCallOutput(castResult, ownOutput);
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
      typeof this.name === 'string'
      || !this.options?.silentFail
      || this.options?.markImportant
      || (!renderFailureWith && this.contentNode)
    ) {
      return undefined;
    }

    const state = this.createEvalState();
    const name = state.name;
    if (typeof name === 'string') {
      return undefined;
    }
    const ownOutput = !renderFailureWith;
    return this.runInCallFrame(context, {}, async () => {
      let evaluatedName: unknown = await name.eval(context);
      evaluatedName = withMixinRulesetCallArgsHint(evaluatedName, state.args);
      if (isNode(evaluatedName, N.Reference) && evaluatedName.options?.type === 'mixin-ruleset') {
        evaluatedName = await evaluatedName.eval(context);
      }
      const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.fn : evaluatedName;
      if (isExtendedFn(fn) && !fn._internal && !fn.options?.params) {
        return this.runAsCaller(context, async () => {
          try {
            const result = state.args
              ? await callWithContext(context, fn, ...state.args.items)
              : await callWithContext(context, fn);
            return this.finalizeCallResult(context, result, { ownOutput });
          } catch (error) {
            const unitMode = context?.opts?.unitMode ?? 'loose';
            if (unitMode === 'strict') {
              throw error;
            }
            const fallbackName = isNode(this.name, N.Reference) && this.name.options.fallbackValue === true
              ? String(this.name.key)
              : stringifyValueOf(fn);
            if (renderFailureWith) {
              return this.renderFinalizedCallSyntax(fallbackName, state, context, renderFailureWith);
            }
            return this.evalOptionalFallbackCallSyntax(context, state, this.name, fn);
          }
        });
      }
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
      const rendered = await state.source.renderFinalizedCallSyntax(
        typeof evaluatedName === 'string' || evaluatedName instanceof Node
          ? evaluatedName
          : stringifyValueOf(evaluatedName),
        state,
        context,
        prepareRenderPrintState(context)
      );
      return this.markCallOutput(new Any(rendered, { role: 'any' }), ownOutput);
    });
  }

  private async evalPlainDynamicFunction(
    context: Context,
    ownOutput = true
  ): Promise<Node | undefined> {
    if (
      typeof this.name === 'string'
      || this.contentNode
      || this.options?.silentFail
      || this.options?.markImportant
    ) {
      return undefined;
    }
    const state = this.createEvalState();
    const { name } = state;
    if (typeof name === 'string') {
      return undefined;
    }
    const evaluatedName = await name.eval(context);
    const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.fn : evaluatedName;
    if (
      !isExtendedFn(fn)
      || fn._internal
      || fn.options?.params
    ) {
      return undefined;
    }

    return this.runInCallFrame(context, { caller: true }, async () => {
      const result = state.args
        ? await callWithContext(context, fn, ...state.args.items)
        : await callWithContext(context, fn);
      return this.finalizeCallResult(context, result, { ownOutput });
    });
  }

  private async evalMetadataDynamicFunction(
    context: Context,
    ownOutput = true
  ): Promise<Node | undefined> {
    if (
      typeof this.name === 'string'
      || this.contentNode
    ) {
      return undefined;
    }
    const state = this.createEvalState();
    const { name } = state;
    if (typeof name === 'string') {
      return undefined;
    }
    const evaluatedName = await name.eval(context);
    const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.fn : evaluatedName;
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
      return this.finalizeCallResult(context, result, {
        ownOutput,
        markImportant: this._options?.markImportant
      });
    });
  }

  private writeRenderedArgs(
    args: List<Node> | undefined,
    context: Context,
    options: PrintOptions,
    textState?: CallRenderTextState
  ): MaybePromise<void> {
    if (!args || args.items.length === 0) {
      return;
    }
    const printOptions = getPrintOptions(options);
    const w = printOptions.writer!;
    const rawArgs = args.items;
    const last = rawArgs.length - 1;
    const findNextArgIndex = (start: number): number => {
      let i = start;
      while (i <= last && !rawArgs[i]) {
        i++;
      }
      return i;
    };
    const writeArgSeparator = (arg: Node, next: number): void => {
      if (next > last) {
        return;
      }
      emitCommentTriviaBetweenNodes(arg, rawArgs[next]!, printOptions);
      w.add(', ');
      if (textState?.text !== undefined) {
        textState.text += ', ';
      }
    };
    const finishArg = (arg: Node, argMark: number, next: number): void => {
      w.trimHorizontalStartSince(argMark);
      w.trimHorizontalEndSince(argMark);
      writeArgSeparator(arg, next);
    };
    const finishEscapedParenArg = (arg: Paren, innerMark: number, next: number): void => {
      w.trimHorizontalStartSince(innerMark);
      w.trimHorizontalEndSince(innerMark);
      w.add(')', arg);
      if (textState?.text !== undefined) {
        textState.text += ')';
      }
      writeArgSeparator(arg, next);
    };
    const finishDirectEscapedParenArg = (arg: Paren, next: number): void => {
      w.add(')', arg);
      if (textState?.text !== undefined) {
        textState.text += ')';
      }
      writeArgSeparator(arg, next);
    };
    const appendKnownRenderedText = (node: Node): boolean => {
      const text = getKnownRenderedCallText(node);
      if (text === undefined) {
        return false;
      }
      w.add(text, node);
      if (textState?.text !== undefined) {
        textState.text += text;
      }
      return true;
    };
    const writeArgAt = (i: number): MaybePromise<void> => {
      const arg = rawArgs[i]!;
      const next = findNextArgIndex(i + 1);
      if (arg instanceof Paren && arg.options?.escaped) {
        w.add('(', arg);
        if (textState?.text !== undefined) {
          textState.text += '(';
        }
        if (!arg.value) {
          w.add(')', arg);
          if (textState?.text !== undefined) {
            textState.text += ')';
          }
          writeArgSeparator(arg, next);
          return;
        }
        const rendered = arg.value.eval(context);
        if (isThenable(rendered)) {
          return rendered.then((value) => {
            if (appendKnownRenderedText(value)) {
              finishDirectEscapedParenArg(arg, next);
              return;
            }
            const innerMark = w.mark();
            if (textState) {
              textState.text = undefined;
            }
            value.writeSyntax(printOptions);
            finishEscapedParenArg(arg, innerMark, next);
          });
        }
        if (appendKnownRenderedText(rendered as Node)) {
          finishDirectEscapedParenArg(arg, next);
          return;
        }
        const innerMark = w.mark();
        if (textState) {
          textState.text = undefined;
        }
        (rendered as Node).writeSyntax(printOptions);
        finishEscapedParenArg(arg, innerMark, next);
        return;
      }
      if (
        arg.eval === Node.prototype.eval
        && appendKnownRenderedText(arg)
      ) {
        writeArgSeparator(arg, next);
        return;
      }
      const rendered = arg.eval(context);
      if (isThenable(rendered)) {
        return rendered.then((value) => {
          if (!appendKnownRenderedText(value)) {
            const argMark = w.mark();
            if (textState) {
              textState.text = undefined;
            }
            value.writeSyntax(printOptions);
            finishArg(arg, argMark, next);
            return;
          }
          writeArgSeparator(arg, next);
        });
      }
      if (!appendKnownRenderedText(rendered as Node)) {
        const argMark = w.mark();
        if (textState) {
          textState.text = undefined;
        }
        (rendered as Node).writeSyntax(printOptions);
        finishArg(arg, argMark, next);
        return;
      }
      writeArgSeparator(arg, next);
      return;
    };
    const writeArgsAsync = async (start: number): Promise<void> => {
      for (let i = start; i <= last;) {
        const nextIndex = findNextArgIndex(i);
        if (nextIndex > last) {
          return;
        }
        await writeArgAt(nextIndex);
        i = nextIndex + 1;
      }
    };

    for (let i = 0; i <= last;) {
      const nextIndex = findNextArgIndex(i);
      if (nextIndex > last) {
        return;
      }
      const rendered = writeArgAt(nextIndex);
      if (isThenable(rendered)) {
        return rendered.then(() => writeArgsAsync(nextIndex + 1));
      }
      i = nextIndex + 1;
    }
  }

  private renderPlainFunctionCall(
    callNode: Call,
    context: Context,
    prepared: PrintOptions
  ): MaybePromise<string> {
    const printOptions = getPrintOptions(prepared);
    const w = printOptions.writer!;
    const { name, contentNode } = callNode.value;
    if (!callNode.args && !contentNode && typeof name === 'string') {
      const out = `${name}${callNode.options?.silentFail ? '?' : ''}()${callNode.options?.markImportant ? ' !important' : ''}`;
      w.add(out, callNode);
      return out;
    }
    const mark = w.mark();
    const textState: CallRenderTextState = {
      text: typeof name === 'string'
        ? name
        : getKnownRenderedCallText(name)
    };
    if (typeof name === 'string') {
      w.add(name, callNode);
    } else if (textState.text !== undefined) {
      w.add(textState.text, name);
    } else {
      name.writeSyntax(printOptions);
    }
    if (callNode.options?.silentFail) {
      w.add('?');
      if (textState.text !== undefined) {
        textState.text += '?';
      }
    }
    w.add('(');
    if (textState.text !== undefined) {
      textState.text += '(';
    }
    const isCalc = name === 'calc';
    if (isCalc) {
      context.calcFrames++;
    }
    const finishCall = (): MaybePromise<string> => {
      if (isCalc) {
        context.calcFrames--;
      }
      w.add(')');
      if (textState.text !== undefined) {
        textState.text += ')';
      }
      if (callNode.options?.markImportant) {
        w.add(' !important');
        if (textState.text !== undefined) {
          textState.text += ' !important';
        }
      }
      if (contentNode) {
        w.add(': ');
        if (textState.text !== undefined) {
          textState.text += ': ';
        }
        const renderedContent = contentNode.eval(context);
        if (isThenable(renderedContent)) {
          return renderedContent.then((value) => {
            const contentText = getKnownRenderedCallText(value);
            if (contentText !== undefined) {
              w.add(contentText, value);
              if (textState.text !== undefined) {
                textState.text += contentText;
                return textState.text;
              }
            } else {
              textState.text = undefined;
              value.writeSyntax(printOptions);
            }
            return w.getSince(mark);
          });
        }
        const contentText = getKnownRenderedCallText(renderedContent as Node);
        if (contentText !== undefined) {
          w.add(contentText, renderedContent as Node);
          if (textState.text !== undefined) {
            textState.text += contentText;
            return textState.text;
          }
        } else {
          textState.text = undefined;
          (renderedContent as Node).writeSyntax(printOptions);
        }
        return w.getSince(mark);
      }
      return textState.text ?? w.getSince(mark);
    };
    let renderedArgs: MaybePromise<void>;
    try {
      renderedArgs = this.writeRenderedArgs(callNode.args, context, prepared, textState);
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
    prepared: PrintOptions,
    syntax?: { args?: List<Node>; contentNode?: Node }
  ): MaybePromise<string> {
    const printOptions = getPrintOptions(prepared);
    const w = printOptions.writer!;
    const args = syntax && 'args' in syntax ? syntax.args : state.args;
    const contentNode = syntax && 'contentNode' in syntax ? syntax.contentNode : state.contentNode;
    if (
      typeof name === 'string'
      && (!args || args.items.length === 0)
      && !contentNode
    ) {
      const out = `${name}()${this._options?.markImportant ? ' !important' : ''}`;
      w.add(out, state.source);
      return out;
    }
    const mark = w.mark();
    const textState: CallRenderTextState = {
      text: typeof name === 'string'
        ? name
        : name instanceof Node
          ? getKnownRenderedCallText(name)
          : undefined
    };
    if (typeof name === 'string') {
      w.add(name, state.source);
    } else if (name instanceof Node) {
      if (textState.text !== undefined) {
        w.add(textState.text, name);
      } else {
        name.writeSyntax(printOptions);
      }
    } else {
      textState.text = undefined;
      w.add(stringifyValueOf(name), state.source);
    }
    w.add('(');
    if (textState.text !== undefined) {
      textState.text += '(';
    }
    const finishCall = (): MaybePromise<string> => {
      w.add(')');
      if (textState.text !== undefined) {
        textState.text += ')';
      }
      if (this._options?.markImportant) {
        w.add(' !important');
        if (textState.text !== undefined) {
          textState.text += ' !important';
        }
      }
      if (contentNode) {
        w.add(': ');
        if (textState.text !== undefined) {
          textState.text += ': ';
        }
        const renderedContent = contentNode.eval(context);
        if (isThenable(renderedContent)) {
          return renderedContent.then((value) => {
            const contentText = getKnownRenderedCallText(value);
            if (contentText !== undefined) {
              w.add(contentText, value);
              if (textState.text !== undefined) {
                textState.text += contentText;
                return textState.text;
              }
            } else {
              textState.text = undefined;
              value.writeSyntax(printOptions);
            }
            return w.getSince(mark);
          });
        }
        const contentText = getKnownRenderedCallText(renderedContent as Node);
        if (contentText !== undefined) {
          w.add(contentText, renderedContent as Node);
          if (textState.text !== undefined) {
            textState.text += contentText;
            return textState.text;
          }
        } else {
          textState.text = undefined;
          (renderedContent as Node).writeSyntax(printOptions);
        }
        return w.getSince(mark);
      }
      return textState.text ?? w.getSince(mark);
    };
    const renderedArgs = this.writeRenderedArgs(args, context, prepared, textState);
    return isThenable(renderedArgs)
      ? renderedArgs.then(finishCall)
      : finishCall();
  }

  private async renderOptionalFallbackCallSyntax(
    context: Context,
    prepared: PrintOptions
  ): Promise<string | undefined> {
    if (
      typeof this.name === 'string'
      || !this.options?.silentFail
    ) {
      return undefined;
    }

    const state = this.createEvalState();
    const name = state.name;
    if (typeof name === 'string') {
      return undefined;
    }
    return this.runInCallFrame(context, {}, async () => {
      let evaluatedName: unknown = await name.eval(context);
      evaluatedName = withMixinRulesetCallArgsHint(evaluatedName, state.args);
      if (isNode(evaluatedName, N.Reference) && evaluatedName.options?.type === 'mixin-ruleset') {
        evaluatedName = await evaluatedName.eval(context);
      }
      const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.fn : evaluatedName;
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

  private async renderDynamicFunctionOutput(
    context: Context,
    prepared: PrintOptions,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): Promise<string> {
    const sharesWriter = callRenderSharesWriter(bufferOrOptions);
    if (typeof this.name !== 'string') {
      const state = this.createEvalState();
      const { name } = state;
      if (typeof name !== 'string') {
        let evaluatedName: unknown = await name.eval(context);
        evaluatedName = withMixinRulesetCallArgsHint(evaluatedName, state.args);
        if (isNode(evaluatedName, N.Reference) && evaluatedName.options?.type === 'mixin-ruleset') {
          evaluatedName = await evaluatedName.eval(context);
        }
        const fn = isNode(evaluatedName, N.JsFunction) ? evaluatedName.fn : evaluatedName;
        if (isExtendedFn(fn)) {
          const isMetadataFunction = Boolean(fn._internal || fn.options?.params);
          if (isMetadataFunction || !this.options?.markImportant) {
            const output = await this.runInCallFrame(context, { caller: true }, async () => {
              let result: unknown;
              try {
                result = state.args
                  ? (
                      isMetadataFunction
                        ? await callWithContext(context, fn, state.args)
                        : await callWithContext(context, fn, ...state.args.items)
                    )
                  : await callWithContext(context, fn);
              } catch (error) {
                if (
                  isMetadataFunction
                  || !this.options?.silentFail
                  || (context?.opts?.unitMode ?? 'loose') === 'strict'
                ) {
                  throw error;
                }
                const fallbackName = isNode(this.name, N.Reference) && this.name.options.fallbackValue === true
                  ? String(this.name.key)
                  : stringifyValueOf(fn);
                return this.renderFinalizedCallSyntax(fallbackName, state, context, prepared);
              }
              return this.finalizeCallResult(context, result, {
                ownOutput: false,
                markImportant: isMetadataFunction && this._options?.markImportant
              });
            });
            if (typeof output === 'string') {
              return isRenderBuffer(bufferOrOptions)
                ? sharesWriter ? output : writeRenderTextResult(bufferOrOptions, output)
                : output;
            }
            return this.renderOutput(context, output, bufferOrOptions, options);
          }
        } else if (isNode(evaluatedName, N.Call)) {
          const output = await evaluatedName.eval(context);
          if (this._options?.markImportant && isNode(output, N.Rules)) {
            this.makeImportant(output);
          }
          return this.renderOutput(context, output, bufferOrOptions, options);
        } else if (isNode(evaluatedName, N.Func)) {
          const argNodes = await this.evalArgNodes(context, state.args) ?? list([]);
          const output = await evaluatedName.evalCall(context, argNodes);
          return this.renderOutput(context, output, bufferOrOptions, options);
        } else if (isNode(evaluatedName, N.Rules | N.Collection)) {
          if (state.preservesRulesLikeVariableTarget) {
            const sourceParent = 'sourceNode' in evaluatedName && isNode(evaluatedName.sourceNode)
              ? evaluatedName.sourceNode.parent
              : undefined;
            if (sourceParent) {
              evaluatedName.parent = sourceParent;
            }
          }
          if (state.args && state.args.items.length > 0) {
            throw new ReferenceError(`Cannot call ${evaluatedName.type} with arguments`);
          }
          const output = await this.runInCallFrame(context, { caller: true }, async () => {
            const result = await evaluateCallableCollection({
              context,
              mixinEntries: [
                callableRulesEntry(
                  { rules: evaluatedName },
                  evaluatedName.parent,
                  evaluatedName.index
                )
              ],
              args: state.args?.value ?? []
            });
            return this.finalizeCallResult(context, result, {
              ownOutput: false,
              markImportant: this._options?.markImportant
            });
          });
          return this.renderOutput(context, output, bufferOrOptions, options);
        } else if (
          isNode(evaluatedName, N.Mixin | N.Ruleset)
          || evaluatedName instanceof MixinCollection
          || Array.isArray(evaluatedName)
        ) {
          const collection = evaluatedName instanceof MixinCollection
            ? evaluatedName
            : new MixinCollection(Array.isArray(evaluatedName) ? evaluatedName : [evaluatedName]);
          const output = await this.runInCallFrame(context, { caller: true }, async () => {
            try {
              const result = await collection.evalCall(context, state.args);
              return this.finalizeCallResult(context, result, {
                ownOutput: false,
                markImportant: this._options?.markImportant
              });
            } catch (error) {
              if (error instanceof ReferenceError && error.message.includes('No matching mixins')) {
                if (this.parent?.type === 'SelectorCapture') {
                  return this.markCallOutput(new Any(stringifyValueOf(collection), { role: 'ident' }), false);
                }
                if (isNode(name, N.Reference)) {
                  throw new ReferenceError(`No matching mixins found for '${name.key.valueOf()}'`);
                }
                throw error;
              }
              if (!this._options?.silentFail) {
                throw error;
              }
              return this.renderFinalizedCallSyntax(name, state, context, prepared);
            }
          });
          if (typeof output === 'string') {
            return isRenderBuffer(bufferOrOptions)
              ? sharesWriter ? output : writeRenderTextResult(bufferOrOptions, output)
              : output;
          }
          return this.renderOutput(context, output, bufferOrOptions, options);
        } else if (
          !(
            isNode(evaluatedName, N.Call | N.Mixin | N.Ruleset | N.Rules | N.Collection | N.Func)
            || evaluatedName instanceof MixinCollection
            || Array.isArray(evaluatedName)
          )
          && (this.options?.silentFail || evaluatedName !== 'calc')
        ) {
          const fallbackText = await this.renderFinalizedCallSyntax(evaluatedName, state, context, prepared);
          return isRenderBuffer(bufferOrOptions)
            ? sharesWriter ? fallbackText : writeRenderTextResult(bufferOrOptions, fallbackText)
            : fallbackText;
        }
      }
    }
    const node = await this.evalPlainDynamicFunction(context, false);
    if (node) {
      return this.renderOutput(context, node, bufferOrOptions, options);
    }
    const fallbackText = await this.renderOptionalFallbackCallSyntax(context, prepared);
    if (fallbackText) {
      return isRenderBuffer(bufferOrOptions)
        ? sharesWriter ? fallbackText : writeRenderTextResult(bufferOrOptions, fallbackText)
        : fallbackText;
    }
    const fallback = await this.evalOptionalFallbackOutput(context, prepared);
    if (fallback) {
      if (typeof fallback === 'string') {
        return isRenderBuffer(bufferOrOptions)
          ? sharesWriter ? fallback : writeRenderTextResult(bufferOrOptions, fallback)
          : fallback;
      }
      return this.renderOutput(context, fallback, bufferOrOptions, options);
    }
    const metadataOutput = await this.evalMetadataDynamicFunction(context, false);
    if (metadataOutput) {
      return this.renderOutput(context, metadataOutput, bufferOrOptions, options);
    }
    const output = await this.evalState(context);
    return this.renderOutput(context, output, bufferOrOptions, options);
  }

  constructor(
    value: CallValue,
    options?: CallOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.name = value.name;
    this.args = value.args;
    this.contentNode = value.contentNode;
    // Function calls are always non-static and may be async
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    if ((!this.args || this.args.items.length === 0) && !this.contentNode && typeof this.name === 'string') {
      const out = `${this.name}${this._options?.silentFail ? '?' : ''}()${this._options?.markImportant ? ' !important' : ''}`;
      w.add(out, this);
      return out;
    }
    if (!options.trivia) {
      const nameText = typeof this.name === 'string'
        ? this.name
        : getKnownSourceCallText(this.name);
      if (nameText !== undefined) {
        let out = `${nameText}${this._options?.silentFail ? '?' : ''}(`;
        if (this.args?.items.length) {
          const sep = this.args.options?.sep ?? ',';
          const joiner = sep === '/' ? ' / ' : `${sep} `;
          for (let i = 0; i < this.args.items.length; i++) {
            const text = getKnownSourceCallText(this.args.items[i]!);
            if (text === undefined) {
              out = '';
              break;
            }
            if (i > 0) {
              out += joiner;
            }
            out += text;
          }
        }
        if (out) {
          out += ')';
          if (this._options?.markImportant) {
            out += ' !important';
          }
          if (this.contentNode) {
            const contentText = getKnownSourceCallText(this.contentNode);
            if (contentText === undefined) {
              out = '';
            } else {
              out += `: ${contentText}`;
            }
          }
          if (out) {
            w.add(out, this);
            return out;
          }
        }
      }
    }
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const silentFail = this._options?.silentFail;
    const w = options.writer;
    const { name, contentNode, args } = this;
    const directSource = !options.trivia;
    const nameText = typeof name === 'string'
      ? name
      : directSource ? getKnownSourceCallText(name) : undefined;
    if (nameText !== undefined) {
      w.add(nameText, typeof name === 'string' ? this : name);
    } else {
      name.writeSyntax(options);
    }
    if (silentFail) {
      w.add('?');
    }
    w.add('(');
    if (args && args.items.length > 0) {
      if (directSource) {
        const sep = args.options?.sep ?? ',';
        const joiner = sep === '/' ? ' / ' : `${sep} `;
        let directArgs = true;
        for (let i = 0; i < args.items.length; i++) {
          const argText = getKnownSourceCallText(args.items[i]!);
          if (argText === undefined) {
            directArgs = false;
            break;
          }
          if (i > 0) {
            w.add(joiner);
          }
          w.add(argText, args.items[i]!);
        }
        if (!directArgs) {
          const argsMark = w.mark();
          args.writeSyntax(options);
          w.trimHorizontalStartSince(argsMark);
          w.trimHorizontalEndSince(argsMark);
        }
      } else {
        const argsMark = w.mark();
        args.writeSyntax(options);
        w.trimHorizontalStartSince(argsMark);
        w.trimHorizontalEndSince(argsMark);
      }
    }
    w.add(')');
    if (this._options?.markImportant) {
      w.add(' !important');
    }
    if (contentNode) {
      w.add(': ');
      const contentText = directSource ? getKnownSourceCallText(contentNode) : undefined;
      if (contentText !== undefined) {
        w.add(contentText, contentNode);
      } else {
        contentNode.writeSyntax(options);
      }
    }
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      const sharesWriter = callRenderSharesWriter(bufferOrOptions);
      const prepared = sharesWriter
        ? prepareRenderPrintState(context, {
            ...options,
            writer: bufferOrOptions.kind === 'flat' && context.printState.writer?.writesTo(bufferOrOptions.parts)
              ? context.printState.writer
              : new OutputWriter(false, bufferOrOptions.kind === 'flat' ? bufferOrOptions.parts : undefined)
          })
        : prepareBufferPrintState(context, options);
      if (this.evaluated) {
        const rendered = this.renderPlainFunctionCall(this, context, prepared);
        return sharesWriter
          ? rendered
          : writeRenderTextResult(bufferOrOptions, rendered);
      }
      if (typeof this.name !== 'string') {
        return this.renderDynamicFunctionOutput(context, prepared, bufferOrOptions, options);
      }
      // Plain CSS calls render args/content explicitly so async child failures
      // keep calc-frame cleanup instead of falling back to source text.
      const rendered = this.renderPlainFunctionCall(this, context, prepared);
      return sharesWriter
        ? rendered
        : writeRenderTextResult(bufferOrOptions, rendered);
    }
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    if (this.evaluated) {
      return this.renderPlainFunctionCall(this, context, prepared);
    }
    if (typeof this.name === 'string') {
      return this.renderPlainFunctionCall(this, context, prepared);
    }
    return this.renderDynamicFunctionOutput(context, prepared, bufferOrOptions, options);
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.evaluated) {
      return this;
    }
    if (
      typeof this.name === 'string'
      && !this.contentNode
    ) {
      return this.evalNode(context);
    }
    return this.evalPlainDynamicFunction(context).then((node) => {
      if (node) {
        return node;
      }
      return this.evalOptionalFallbackOutput(context).then((fallback) => {
        if (fallback) {
          return fallback;
        }
        return this.evalMetadataDynamicFunction(context).then(metadataOutput => (
          metadataOutput ?? this.evalState(context)
        ));
      });
    });
  }

  /** Recursively makes declarations important */
  makeImportant(rules: Rules): Rules {
    const important = createImportantFlag();
    for (let index = 0; index < rules.rules.length; index++) {
      const rule = rules.rules[index]!;
      if (isNode(rule, N.Declaration)) {
        const replacement = rule.deriveWithParts({ important });
        rules.adopt(replacement);
        rules.rules[index] = replacement;
      } else if (isNode(rule, N.Rules)) {
        this.makeImportant(rule);
      } else if (isNode(rule, N.AtRule)) {
        if (rule.rules) {
          this.makeImportant(rule.rules);
        }
      } else if (isNode(rule, N.Ruleset)) {
        if (rule.rules) {
          this.makeImportant(rule.rules);
        }
      }
    }
    return rules;
  }

  /** Come back and redo -- too hard to reason about as a MaybePromise */
  override async evalNode(context: Context): Promise<Node> {
    const state = this.createEvalState();
    return this.evalFromState(context, state);
  }

  private async evalFromState(context: Context, state: CallEvalState): Promise<Node> {
    return this.runInCallFrame(context, {}, () => this.evalFromStateInFrame(context, state));
  }

  private async evalFromStateInFrame(context: Context, state: CallEvalState): Promise<Node> {
    const { name, args } = state;
    const markImportant = this._options?.markImportant;

    let n: string | Node | MixinCollection | unknown;
    if (typeof name === 'string') {
      n = name;
    } else {
      n = await name.eval(context);
    }
    // Resolve mixin reference only at call time (same as variable refs: evaluate when used, not when stored).
    n = withMixinRulesetCallArgsHint(n, args);
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
        const sourceParent = 'sourceNode' in n && isNode(n.sourceNode)
          ? n.sourceNode.parent
          : undefined;
        if (sourceParent) {
          n.parent = sourceParent;
        }
      }
      // Detached rulesets/collections share the same callable-body path as
      // anonymous mixin bodies. They still reject explicit arguments.
      if (args && args.items.length > 0) {
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      return this.runAsCaller(context, async () => {
        const result = await evaluateCallableCollection({
          context,
          mixinEntries: [
            callableRulesEntry(
              { rules: n },
              n.parent,
              n.index
            )
          ],
          args: args?.value ?? []
        });
        return this.finalizeCallResult(context, result, {
          markImportant
        });
      });
    }

    if (n instanceof MixinCollection) {
      return this.runAsCaller(context, async () => {
        try {
          const result = await n.evalCall(context, args);
          return this.finalizeCallResult(context, result, {
            markImportant
          });
        } catch (e) {
          if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
            if (this.parent?.type === 'SelectorCapture') {
              return this.markCallOutput(new Any(stringifyValueOf(n), { role: 'ident' }));
            }
            if (isNode(name, N.Reference)) {
              throw new ReferenceError(`No matching mixins found for '${name.key.valueOf()}'`);
            }
            throw e;
          }
          if (!this._options?.silentFail) {
            throw e;
          }
          return this.evalOptionalFallbackCallSyntax(context, state, name, n);
        }
      });
    }

    let fn = isNode(n, N.JsFunction) ? n.fn : n;
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
                    : callWithContext(context, callable, ...callArgs.items)
                )
              : callWithContext(context, callable)
          );
          return this.finalizeCallResult(context, result, {
            markImportant
          });
        } catch (e) {
          const unitMode = context?.opts?.unitMode ?? 'loose';
          const shouldRethrowForMode = unitMode === 'strict';
          if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
            if (this.parent?.type === 'SelectorCapture') {
              return this.markCallOutput(new Any(stringifyValueOf(n), { role: 'ident' }));
            }
            if (isNode(name, N.Reference)) {
              throw new ReferenceError(`No matching mixins found for '${name.key.valueOf()}'`);
            }
            throw e;
          }
          if (!this._options?.silentFail || shouldRethrowForMode) {
            throw e;
          }
          return this.evalOptionalFallbackCallSyntax(context, state, name, n);
        }
      });
    } else {
      if (n === 'calc') {
        context.calcFrames++;
      }
      const evaluatedArgs = await this.evalArgNodes(context, args, {
        ownResults: !(this._options?.silentFail && typeof this.name !== 'string')
      })
        .finally(() => {
          if (n === 'calc') {
            context.calcFrames--;
          }
        });
      if (
        n === 'calc' && evaluatedArgs
      ) {
        if (isNode(evaluatedArgs.items[0], N.Dimension)) {
          return evaluatedArgs.items[0]!;
        } else if (context.calcFrames !== 0) {
          return new Paren(evaluatedArgs.items[0]!);
        }
      }
      const finalizedName = typeof n === 'string' || n instanceof Node ? n : stringifyValueOf(n);
      if (this._options?.silentFail && typeof this.name !== 'string') {
        const rendered = await state.source.renderFinalizedCallSyntax(finalizedName, state, context, prepareRenderPrintState(context), {
          args: evaluatedArgs,
          ...(state.contentNode && { contentNode: state.contentNode })
        });
        return this.markCallOutput(new Any(rendered, { role: 'any' }));
      }
      const node = new Call(
        {
          name: finalizedName,
          args: evaluatedArgs,
          contentNode: state.contentNode
        },
        this._options
          ? { ...this._options, silentFail: false }
          : { silentFail: false },
        this.location,
        this.sourceRoot?._treeContext
      );
      return this.markCallOutput(node);
    };
  }
}

type Params = ConstructorParameters<typeof Call>;

export const call = defineType(Call, 'Call') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2]
) => Call;
