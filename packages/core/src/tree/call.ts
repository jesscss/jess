import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC } from './node.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { cast } from './util/cast.js';
import { callWithContext } from '../define-function.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { Paren } from './paren.js';
import { isThenable } from '@jesscss/awaitable-pipe';
import { callableRulesEntry, MixinCollection, Rules } from './rules.js';
import { Any } from './any.js';
import { freezeChildren } from './util/cloning.js';
import { List, list } from './list.js';
import type { AtRule } from './at-rule.js';

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
export class Call extends Node<CallValue, CallOptions> {
  override _requiredSemi = true;

  constructor(value: CallValue, options?: CallOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Function calls are always non-static and may be async
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  override toTrimmedString(options?: PrintOptions) {
    const { silentFail } = this.options;
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
    if (this.options?.markImportant) {
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
        rule.value.important = important;
      } else if (isNode(rule, N.Rules)) {
        this.makeImportant(rule);
      } else if (isNode(rule, N.AtRule | N.Ruleset)) {
        if ((rule as AtRule).value.rules) {
          this.makeImportant((rule as AtRule).value.rules!);
        }
      }
    }
    return rules;
  }

  /** Come back and redo -- too hard to reason about as a MaybePromise */
  override async evalNode(context: Context): Promise<Node> {
    let { name } = this.value;
    let args = this.value.args;
    let { markImportant } = this.options;
    const adoptCallWhitespace = <T extends Node>(node: T): T => {
      node.pre = this.pre;
      node.post = this.post;
      node.sourceParent = this;
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
      const result = await (n as any).evalCall(context, argNodes);
      context.callStack.pop();
      context.parenFrames.pop();
      return result;
    } else if (isNode(n, N.Rules | N.Collection)) {
      // Detached rulesets/collections share the same callable-body path as
      // anonymous mixin bodies. They still reject explicit arguments.
      if (args && args.value.length > 0) {
        context.callStack.pop();
        context.parenFrames.pop();
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      n = new MixinCollection([
        callableRulesEntry(
          { rules: n as Rules },
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
            return adoptCallWhitespace(new Any(String(n.valueOf()), { role: 'ident' }).inherit(this));
          }
          if (isNode(name, N.Reference)) {
            throw new ReferenceError(`No matching mixins found for '${name.value.key.valueOf()}'`);
          }
          throw e;
        }
        if (!this.options?.silentFail) {
          throw e;
        }
        let newCall = this.clone().inherit(this);
        newCall.options.silentFail = false;
        newCall.value.name = isNode(name, N.Reference) && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n.valueOf());
        newCall.value.args = await evalArgNodes(args);
        return adoptCallWhitespace(newCall);
      }
    }

    let fn = isNode(n, N.JsFunction) ? n.value : n;
    if (typeof fn === 'function') {
      const originalCaller = context.caller;
      context.caller = this;
      let didPopCallStack = false;
      try {
        /** Freeze args */
        if (args) {
          const copiedArgs = args.copy(true, freezeChildren);
          for (const copied of copiedArgs.value) {
            // Anchor copied references to this Call so nested property refs
            // (e.g. $list-1) can walk back to call-site Rules.
            // Also anchor copied Mixin callback args to call-site source scope
            // so callback bodies can resolve surrounding variables.
            if (isNode(copied, N.Reference) && copied.options?.type === 'declaration') {
              copied.sourceParent = this;
            } else if (isNode(copied, N.Mixin)) {
              copied.sourceParent = this;
            }
            copied.frozen = true;
          }
          args = copiedArgs;
        }
        const shouldPassListArgs = Boolean((fn as any)?._internal || (fn as any)?.options?.params);
        const result = await (
          args
            ? (
                shouldPassListArgs
                  ? callWithContext(context, fn, args)
                  : callWithContext(context, fn, ...args.value)
              )
            : callWithContext(context, fn)
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
            throw new ReferenceError(`No matching mixins found for '${name.value.key.valueOf()}'`);
          }
          throw e;
        }
        if (!this.options?.silentFail || shouldRethrowForMode) {
          throw e;
        }
        let newCall = this.clone().inherit(this);
        /** Remove this flag for serialization */
        newCall.options.silentFail = false;
        newCall.value.name = isNode(name, N.Reference) && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n.valueOf());
        newCall.value.args = await evalArgNodes(args);
        newCall.value.args?.value.forEach((arg, argIndex) => {
          // Normalize fallback-call arg spacing to Less-style call serialization.
          arg.pre = argIndex === 0 ? 0 : 1;
          if (isNode(arg, N.Sequence)) {
            arg.value.forEach((child, childIndex) => {
              child.pre = childIndex === 0 ? 0 : 1;
            });
          } else if (isNode(arg, N.List)) {
            arg.value.forEach((child) => {
              if (isNode(child, N.Sequence)) {
                child.value.forEach((nested, nestedIndex) => {
                  nested.pre = nestedIndex === 0 ? 0 : 1;
                });
              }
            });
          }
        });
        return adoptCallWhitespace(newCall);
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
      const node = this.clone();
      node.options.silentFail = false;
      if (
        n === 'calc' && evaluatedArgs
      ) {
        if (isNode(evaluatedArgs.value[0], N.Dimension)) {
          return evaluatedArgs.value[0]!;
        } else if (context.calcFrames !== 0) {
          return new Paren(evaluatedArgs.value[0]!);
        }
      }
      node.value.name = n;
      node.value.args = evaluatedArgs;
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
