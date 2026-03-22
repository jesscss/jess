import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type LocationInfo, type TreeContext } from './node.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { cast } from './util/cast.js';
import { callWithContext } from '../define-function.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { Paren } from './paren.js';
import { isThenable } from '@jesscss/awaitable-pipe';
import { getFunctionFromMixins, type MixinEntry, type Rules } from './rules.js';
import { Any } from './any.js';
import { List, list } from './list.js';
import type { AtRule } from './at-rule.js';
import { sessionGetField, sessionMergeDependencies, sessionPatchField, sessionSetDependency } from './util/session-helpers.js';
let rulesCtorPromise: Promise<(typeof import('./rules.js'))['Rules']> | undefined;

// Lazy getter for Rules to break circular dependency:
// rules.ts → cast.ts → color.ts → call.ts → rules.ts
async function getRules() {
  if (!rulesCtorPromise) {
    rulesCtorPromise = import('./rules.js').then(({ Rules }) => Rules);
  }
  return rulesCtorPromise;
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
export type ExtendedFn<T extends any[] = any[], R = any> = ((this: Context, ...args: T) => R) & {
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
};

/**
 * @note In Less, the ref for something like `rgb`
 * is not a string, but is an (optional) variable reference.
 */
export interface Call {
  type: 'Call';
  shortType: 'call';
}

export class Call extends Node<CallValue, CallOptions> {
  static override childKeys = ['name', 'args', 'contentNode'] as const;

  name!: string | Node;
  args: List<Node> | undefined;
  contentNode: Node | undefined;

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const name = this._getName(ctx);
    const args = this._getArgs(ctx);
    const contentNode = this._getContentNode(ctx);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const cloneData: CallValue = {
      name: deep && name instanceof Node ? cloneChild(name) : name,
      args: deep && args instanceof Node ? cloneChild(args) as List<Node> : args,
      contentNode: deep && contentNode instanceof Node ? cloneChild(contentNode) : contentNode
    };

    let priorChildParents: Array<[Node, Node | undefined]> | undefined;
    if (!deep && ctx?.session) {
      priorChildParents = [];
      if (cloneData.name instanceof Node) {
        priorChildParents.push([cloneData.name, cloneData.name.parent]);
      }
      if (cloneData.args instanceof Node) {
        priorChildParents.push([cloneData.args, cloneData.args.parent]);
      }
      if (cloneData.contentNode instanceof Node) {
        priorChildParents.push([cloneData.contentNode, cloneData.contentNode.parent]);
      }
    }

    const options = (this as any)._meta?.options;
    const newNode = new (this.constructor as any)(
      cloneData,
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );

    if (priorChildParents) {
      const session = ctx!.session!;
      for (const [child, priorParent] of priorChildParents) {
        session.getRuntime(child).parent = newNode;
        (child as unknown as { parent?: Node }).parent = priorParent;
      }
    }

    newNode.inherit(this);
    return newNode;
  }

  constructor(value: CallValue, options?: CallOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.name = value.name;
    this.args = value.args;
    this.contentNode = value.contentNode;
    if (this.name instanceof Node) {
      this.adopt(this.name);
    }
    if (this.args instanceof Node) {
      this.adopt(this.args);
    }
    if (this.contentNode instanceof Node) {
      this.adopt(this.contentNode);
    }
    this.requiredSemi = true;
    // Function calls are always non-static and may be async
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  private _getName(context?: Context): string | Node {
    return context
      ? sessionGetField<string | Node>(this, 'name', context)
      : this.name;
  }

  private _getArgs(context?: Context): List<Node> | undefined {
    return context
      ? sessionGetField<List<Node> | undefined>(this, 'args', context)
      : this.args;
  }

  private _getContentNode(context?: Context): Node | undefined {
    return context
      ? sessionGetField<Node | undefined>(this, 'contentNode', context)
      : this.contentNode;
  }

  private _getOptions(context?: Context): CallOptions | undefined {
    return context
      ? sessionGetField<CallOptions | undefined>(this, 'options', context)
      : this.options;
  }

  private _setName(name: string | Node, context: Context): void {
    if (name instanceof Node) {
      this.adopt(name);
    }
    if (context.session && this === this.sourceNode) {
      sessionPatchField(this, 'name', name, context);
    } else {
      this.name = name;
    }
  }

  private _setArgs(args: List<Node> | undefined, context: Context): void {
    if (args instanceof Node) {
      this.adopt(args);
    }
    if (context.session && this === this.sourceNode) {
      sessionPatchField(this, 'args', args, context);
    } else {
      this.args = args;
    }
  }

  private _normalizeFallbackArgSpacing(node: Node): void {
    if (isNode(node, N.Sequence)) {
      node.value.forEach((child, childIndex) => {
        child.pre = childIndex === 0 ? 0 : 1;
      });
      return;
    }
    if (isNode(node, N.List)) {
      node.value.forEach((child) => {
        if (isNode(child, N.Sequence)) {
          child.value.forEach((nested, nestedIndex) => {
            nested.pre = nestedIndex === 0 ? 0 : 1;
          });
        }
      });
    }
  }

  private _materializeFallbackArgs(args: List<Node> | undefined): List<Node> | undefined {
    if (!args) {
      return undefined;
    }
    const clonedArgs = list(
      args.value.map(arg => arg.clone(true)),
      args.options ? { ...args.options } : undefined
    );
    clonedArgs.value.forEach((arg, argIndex) => {
      // Normalize fallback-call arg spacing to Less-style call serialization.
      arg.pre = argIndex === 0 ? 0 : 1;
      this._normalizeFallbackArgSpacing(arg);
    });
    return clonedArgs;
  }

  private _materializeFunctionArgs(args: List<Node>, context: Context): List<Node> {
    return list(
      args.value.map(arg => {
        const cloned = arg.clone(true, undefined, context);
        cloned.frozen = true;
        return cloned;
      }),
      args.options ? { ...args.options } : undefined
    );
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    const { silentFail, markImportant } = this._getOptions(context) ?? {};
    const name = this._getName(context);
    const args = this._getArgs(context);
    const contentNode = this._getContentNode(context);
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
      const normalizedArgs = args.value.filter(Boolean);
      const last = normalizedArgs.length - 1;
      for (let i = 0; i <= last; i++) {
        const arg = normalizedArgs[i]!;
        const argOut = w.capture(() => arg.toString(options));
        // Normalize boundary whitespace so calls serialize with stable comma spacing.
        w.add(argOut.replace(/^[ \t\r\f]+|[ \t\r\f]+$/g, ''), arg);
        if (i < last) {
          w.add(', ');
        }
      }
    }
    w.add(')');
    if (markImportant) {
      w.add(' !important');
    }
    if (contentNode) {
      w.add(': ');
      contentNode.toString(options);
    }
    return w.getSince(mark);
  }

  /** Recursively makes declarations important */
  makeImportant(rules: Rules): Rules {
    let important = Any.create('!important', { role: 'flag' }) as Any<'flag'>;
    for (const rule of rules.value) {
      if (isNode(rule, N.Declaration)) {
        rule.setData('important', important);
      } else if (isNode(rule, N.Rules)) {
        this.makeImportant(rule);
      } else if (isNode(rule, N.AtRule | N.Ruleset)) {
        if ((rule as AtRule).rules) {
          this.makeImportant((rule as AtRule).rules!);
        }
      }
    }
    return rules;
  }

  /** Come back and redo -- too hard to reason about as a MaybePromise */
  override async evalNode(context: Context): Promise<Node> {
    let name = this._getName(context);
    let args = this._getArgs(context);
    const callOptions = this._getOptions(context) ?? {};
    let { markImportant } = callOptions;
    const applyDependencyToResult = <T extends Node>(
      result: T,
      nodes?: readonly (Node | undefined)[]
    ): T => {
      const dependency = sessionMergeDependencies(
        nodes ? [result, ...nodes] : [result],
        context
      );
      if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
        sessionSetDependency(result, {
          dependsOn: new Set(dependency.dependsOn),
          sourceExpr: this
        }, context);
      }
      return result;
    };
    const adoptCallWhitespace = <T extends Node>(node: T): T => {
      node.pre = this.pre;
      node.post = this.post;
      node.sourceParent = this;
      return node;
    };
    const materializeDownstreamResult = <T extends Node>(node: T): T => {
      if (context.session && node === node.sourceNode) {
        const clone = node.clone(false, undefined, context) as T;
        clone.inherit(node);
        return clone;
      }
      return node;
    };
    const evalArgNodes = async (nodes?: List<Node>) => {
      if (!nodes) {
        return undefined;
      }
      const out: Node[] = [];
      for (const node of nodes.value) {
        out.push(await node.eval(context) as Node);
      }
      return list(out, nodes.options);
    };

    context.callStack.push(this);
    context.parenFrames.push(false);

    let n = typeof name === 'string' ? name : await name.eval(context);
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
      const result = materializeDownstreamResult(await n.eval(context));
      // Apply markImportant if needed
      if (markImportant && isNode(result, N.Rules)) {
        this.makeImportant(result);
      }
      // Always pop the outer call's stack entries
      context.callStack.pop();
      context.parenFrames.pop();
      return adoptCallWhitespace(result);
    } else if (isNode(n, N.Mixin) || isNode(n, N.Ruleset) || Array.isArray(n)) {
      n = cast(getFunctionFromMixins(n as MixinEntry | MixinEntry[]));
    } else if (isNode(n, N.Func)) {
      // Execute stylesheet-defined functions via their evalCall behavior.
      const argNodes = await evalArgNodes(args) ?? list([]);
      const result = await (n as any).evalCall(context, argNodes);
      context.callStack.pop();
      context.parenFrames.pop();
      return applyDependencyToResult(
        adoptCallWhitespace(materializeDownstreamResult(result)),
        argNodes.value
      );
    } else if (isNode(n, N.Collection)) {
      // If the evaluated name is Rules or Collection (detached rulesets),
      // return those rules directly, but only if args are empty
      // If args are provided, throw an error - you can't call Rules/Collection with arguments
      if (args && args.value.length > 0) {
        context.callStack.pop();
        context.parenFrames.pop();
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      const Rules = await getRules();
      let rules = Rules.create(
        n.value.map(child => child.clone(true, undefined, context)),
        n.options ? { ...n.options } : undefined
      );
      // Inherit from Collection (n) to preserve definition-scope parent chain
      // This ensures variables like @a resolve from where the detached ruleset was defined
      // Also copies sourceParent from the Collection (which was set by Reference when it resolved)
      rules.inherit(n);
      // Keep definition-site `parent` for primary lookup, but anchor `sourceParent`
      // to this call so leaky fallback can resolve call-site variables (e.g. @d).
      rules.sourceParent = this;
      rules = await rules.eval(context);
      context.callStack.pop();
      context.parenFrames.pop();
      // Apply markImportant if needed
      if (markImportant) {
        this.makeImportant(rules);
      }
      return rules;
    }

    let fn = isNode(n, N.JsFunction) ? n.value : n;
    if (typeof fn === 'function') {
      const originalCaller = context.caller;
      context.caller = this;
      let didPopCallStack = false;
      try {
        /** Freeze args */
        if (args) {
          const copiedArgs = this._materializeFunctionArgs(args, context);
          for (const copied of copiedArgs.value) {
            // Anchor copied references to this Call so nested property refs
            // (e.g. $list-1) can walk back to call-site Rules.
            // Also anchor copied Mixin callback args to call-site source scope
            // so callback bodies can resolve surrounding variables.
            if (isNode(copied, N.Reference) && copied.options?.type === 'property') {
              copied.sourceParent = this;
            } else if (isNode(copied, N.Mixin)) {
              copied.sourceParent = this;
            }
            copied.frozen = true;
          }
          args = copiedArgs;
        }
        const shouldPassListArgs = Boolean((fn as any)?._internal || (fn as any)?.options?.params);
        const fnCallable = fn as (...args: any[]) => any;
        const result = await (
          args
            ? (
                shouldPassListArgs
                  ? callWithContext(context, fnCallable, args)
                  : callWithContext(context, fnCallable, ...[...args.value])
              )
            : callWithContext(context, fnCallable)
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
            return adoptCallWhitespace(new Any(String(n.valueOf()), { role: 'ident' }).inherit(this));
          }
          if (isNode(name, N.Reference)) {
            throw new ReferenceError(`No matching mixins found for '${name.key.valueOf()}'`);
          }
          throw e;
        }
        if (!callOptions.silentFail || shouldRethrowForMode) {
          throw e;
        }
        let newCall = (context.session
          ? this.clone(false, undefined, context)
          : this.clone()).inherit(this);
        /** Remove this flag for serialization */
        newCall.options.silentFail = false;
        newCall._setName(isNode(name, N.Reference) && name.options.fallbackValue === true
          ? String(name.key)
          : String(n.valueOf()), context);
        newCall._setArgs(this._materializeFallbackArgs(await evalArgNodes(args)), context);
        return applyDependencyToResult(adoptCallWhitespace(newCall), newCall.args?.value);
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
      const evaluatedArgs = await evalArgNodes(args);

      if (n === 'calc') {
        context.calcFrames--;
      }
      context.parenFrames.pop();
      context.callStack.pop();
      const needsMaterializedClone = Boolean(context.session && callOptions.silentFail);
      const node = needsMaterializedClone
        ? this.clone(false, undefined, context)
        : context.session
          ? this.maybeClone(context)
          : this.clone();
      node.options.silentFail = false;
      if (
        n === 'calc' && evaluatedArgs
      ) {
        if (isNode(evaluatedArgs.value[0], N.Dimension)) {
          return applyDependencyToResult(evaluatedArgs.value[0]!, evaluatedArgs.value);
        } else if (context.calcFrames !== 0) {
          return applyDependencyToResult(new Paren(evaluatedArgs.value[0]!), evaluatedArgs.value);
        }
      }
      node._setName(n, context);
      node._setArgs(evaluatedArgs, context);
      return applyDependencyToResult(adoptCallWhitespace(node), evaluatedArgs?.value);
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
