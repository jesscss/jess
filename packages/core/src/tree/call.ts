import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type NodeLocation, type TreeContext } from './node.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { cast } from './util/cast.js';
import { callWithContext } from '../define-function.js';
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

  private deriveResolveSurface(): Call {
    const name = typeof this.value.name === 'string'
      ? this.value.name
      : copyWithReusableLeaves(this.value.name);
    const args = this.value.args
      ? copyWithReusableLeaves(this.value.args)
      : undefined;
    const contentNode = this.value.contentNode
      ? copyWithReusableLeaves(this.value.contentNode)
      : undefined;
    if (args !== undefined && !isNode(args, N.List)) {
      throw new TypeError('Copied call arguments must remain a List');
    }
    return this.deriveCall(
      { name, args, contentNode },
      this._options ? { ...this._options } : undefined
    );
  }

  private derivePreserveRulesLikeReference(name: Node): Node {
    if (!isNode(name, N.Reference)) {
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

  private renderResolvedOutput(
    node: Node,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): MaybePromise<string> {
    return isRenderBuffer(bufferOrOptions)
      ? writeRenderTextResult(bufferOrOptions, node.render(context, options))
      : node.render(context, bufferOrOptions);
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
        return pipe(
          () => this.deriveResolveSurface().eval(context),
          node => this.renderResolvedOutput(node, context, bufferOrOptions, options)
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
      () => this.deriveResolveSurface().eval(context),
      node => this.renderResolvedOutput(node, context, bufferOrOptions, options)
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (
      typeof this.value.name === 'string'
      && !this.value.contentNode
    ) {
      return this.evalNode(context);
    }
    return this.deriveResolveSurface().eval(context) as MaybePromise<Node>;
  }

  /** Recursively makes declarations important */
  makeImportant(rules: Rules): Rules {
    let important = new Any<'flag'>('!important', { role: 'flag' });
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
    let { name } = this.value;
    let args = this.value.args;
    let markImportant = this._options?.markImportant;
    const preservesRulesLikeVariableTarget = isNode(name, N.Reference) && name.options?.type === 'variable';
    const markCallDeclarationOutput = !(
      isNode(this.value.name, N.Reference)
      && (this.value.name.options?.type === 'mixin'
        || this.value.name.options?.type === 'mixin-ruleset')
    );
    const adoptCallWhitespace = <T extends Node>(node: T): T => {
      node.inherit(this);
      if (
        isNode(node, N.Rules)
        && node.value.length > 0
        && node.value.every(child => isNode(child, N.Declaration | N.Comment))
        && markCallDeclarationOutput
      ) {
        node.options.callDeclarationOutput = true;
      }
      return node;
    };
    const evalArgNodes = async (
      nodes?: List<Node>,
      options?: { preserveSourceParents?: boolean }
    ) => {
      if (!nodes) {
        return undefined;
      }
      const out: Node[] = [];
      for (const node of nodes.value) {
        const evalTarget = options?.preserveSourceParents && isNode(node, N.List | N.Sequence)
          ? copyWithReusableLeaves(node)
          : node;
        const evald = await evalTarget.eval(context) as Node;
        if (evald === node && options?.preserveSourceParents) {
          evald.frozen = true;
        }
        out.push(evald);
      }
      return list(out, nodes.options);
    };

    context.callStack.push(this);
    context.parenFrames.push(false);

    let n: string | Node | MixinCollection | unknown;
    if (typeof name === 'string') {
      n = name;
    } else if (preservesRulesLikeVariableTarget) {
      const callableName = this.derivePreserveRulesLikeReference(name);
      n = await callableName.eval(context);
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
      // Always pop the outer call's stack entries
      context.callStack.pop();
      context.parenFrames.pop();
      return result;
    } else if (isNode(n, N.Mixin) || isNode(n, N.Ruleset) || Array.isArray(n)) {
      n = new MixinCollection(Array.isArray(n) ? n : [n]);
    } else if (n instanceof MixinCollection) {
      // already a MixinCollection from Reference, use as-is
    } else if (isNode(n, N.Func)) {
      // Execute stylesheet-defined functions via their evalCall behavior.
      const argNodes = await evalArgNodes(args) ?? list([]);
      const result = await n.evalCall(context, argNodes);
      context.callStack.pop();
      context.parenFrames.pop();
      return result;
    } else if (isNode(n, N.Rules) || isNode(n, N.Collection)) {
      // PreserveRulesLike variable calls intentionally evaluate from the
      // detached ruleset's lexical parent. Removing this lets non-leaky calls
      // see caller variables; see call.test.ts "does not let detached ruleset
      // calls read caller scope in non-leaky mode".
      if (preservesRulesLikeVariableTarget) {
        const sourceParent = n.sourceNode?.parent;
        if (sourceParent) {
          Reflect.set(n, 'parent', sourceParent);
        }
      }
      // Detached rulesets/collections share the same callable-body path as
      // anonymous mixin bodies. They still reject explicit arguments.
      if (args && args.value.length > 0) {
        context.callStack.pop();
        context.parenFrames.pop();
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
      const originalCaller = context.caller;
      context.caller = this;
      try {
        const result = await n.evalCall(context, args);
        context.caller = originalCaller;
        context.callStack.pop();
        context.parenFrames.pop();
        if (isNode(result)) {
          let evald = result.eval(context);
          if (isThenable(evald)) {
            evald = await evald;
          }
          if (markImportant && isNode(evald, N.Rules)) {
            this.makeImportant(evald);
          }
          return adoptCallWhitespace(evald);
        }
        return adoptCallWhitespace(cast(result));
      } catch (e) {
        context.caller = originalCaller;
        context.callStack.pop();
        context.parenFrames.pop();
        if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
          if (this.parent?.type === 'SelectorCapture') {
            return adoptCallWhitespace(new Any(stringifyValueOf(n), { role: 'ident' }).inherit(this));
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
        return adoptCallWhitespace(this.deriveCall(
          {
            ...this.value,
            name: fallbackName,
            args: await evalArgNodes(args, { preserveSourceParents: true })
          },
          {
            ...this.options,
            silentFail: false
          }
        ));
      }
    }

    let fn = isNode(n, N.JsFunction) ? n.value : n;
    if (isExtendedFn(fn)) {
      const callable = fn;
      const originalCaller = context.caller;
      context.caller = this;
      let didPopCallStack = false;
      try {
        const shouldPassListArgs = Boolean(callable._internal || callable.options?.params);
        let callArgs = args;
        const result = await (
          callArgs
            ? (
                shouldPassListArgs
                  ? callWithContext(context, callable, callArgs)
                  : callWithContext(context, callable, ...callArgs.value)
              )
            : callWithContext(context, callable)
        );
        context.caller = originalCaller;
        context.callStack.pop();
        didPopCallStack = true;
        if (isNode(result)) {
          let evald = result.eval(context);
          if (isThenable(evald)) {
            evald = await evald;
            if (markImportant && isNode(evald, N.Rules)) {
              this.makeImportant(evald);
            }
            return adoptCallWhitespace(evald);
          }
          if (markImportant && isNode(evald, N.Rules)) {
            this.makeImportant(evald);
          }
          return adoptCallWhitespace(evald);
        }
        let castResult = cast(result);
        if (isNode(castResult, N.Rules) && castResult.value.length === 1) {
          return adoptCallWhitespace(castResult.value[0]!);
        }
        return adoptCallWhitespace(castResult);
      } catch (e) {
        const unitMode = context?.opts?.unitMode ?? 'loose';
        const shouldRethrowForMode = unitMode === 'strict';
        if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
          if (this.parent?.type === 'SelectorCapture') {
            return adoptCallWhitespace(new Any(stringifyValueOf(n), { role: 'ident' }).inherit(this));
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
        return adoptCallWhitespace(this.deriveCall(
          {
            ...this.value,
            name: fallbackName,
            args: await evalArgNodes(args, { preserveSourceParents: true })
          },
          {
            ...this.options,
            silentFail: false
          }
        ));
      } finally {
        context.caller = originalCaller;
        context.parenFrames.pop();
        if (!didPopCallStack) {
          context.callStack.pop();
        }
      }
    } else {
      if (n === 'calc') {
        context.calcFrames++;
      }
      const evaluatedArgs = await evalArgNodes(args, { preserveSourceParents: true });

      if (n === 'calc') {
        context.calcFrames--;
      }
      context.parenFrames.pop();
      context.callStack.pop();
      const callOptions = this._options
        ? { ...this._options, silentFail: false }
        : { silentFail: false };
      if (
        n === 'calc' && evaluatedArgs
      ) {
        if (isNode(evaluatedArgs.value[0], N.Dimension)) {
          return evaluatedArgs.value[0]!;
        } else if (context.calcFrames !== 0) {
          return new Paren(evaluatedArgs.value[0]!);
        }
      }
      const node = new Call({
        ...this.value,
        name: typeof n === 'string' || n instanceof Node ? n : stringifyValueOf(n),
        args: evaluatedArgs
      }, callOptions, this.location, this.treeContext);
      return adoptCallWhitespace(node);
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
