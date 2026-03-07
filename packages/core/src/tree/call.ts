import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC } from './node.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { cast } from './util/cast.js';
import { callWithContext } from '../define-function.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { Paren } from './paren.js';
import { isThenable } from '@jesscss/awaitable-pipe';
import { getFunctionFromMixins, type Rules } from './rules.js';
import { Any } from './any.js';
import { freezeChildren } from './util/cloning.js';
import { List, list } from './list.js';
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
export class Call extends Node<CallValue, CallOptions> {
  type = 'Call' as const;
  shortType = 'call' as const;
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
      if (isNode(rule, 'Declaration')) {
        rule.value.important = important;
      } else if (isNode(rule, 'Rules')) {
        this.makeImportant(rule);
      } else if (isNode(rule, ['AtRule', 'Ruleset'])) {
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
    const callName = typeof name === 'string'
      ? name
      : String((name as any)?.value?.key?.valueOf?.() ?? (name as any)?.valueOf?.() ?? '');
    const resolvedName = typeof n === 'string'
      ? n
      : String((n as any)?.value?.key?.valueOf?.() ?? (n as any)?.valueOf?.() ?? '');
    if (callName.includes('each') || resolvedName.includes('each')) {
    }
    if (
      callName.includes('mixin')
      || callName.includes('lock')
      || callName.includes('guard')
      || callName === 'default'
      || callName === '??'
    ) {
    }
    if (typeof n !== 'string') {
    }
    // Note: Stylesheet-defined functions should be represented as a Reference(type='function')
    // by parsers that support them. We intentionally avoid implicit string→function lookup here
    // to prevent surprising behavior for plain CSS function-like calls.
    // If the evaluated name is a Call node, execute it directly
    // This handles cases like @alias: .something(foo); @alias();
    if (isNode(n, 'Call')) {
      try {
        // Execute the inner Call node (it will handle its own callStack push/pop)
        const result = await n.eval(context);
        // Apply markImportant if needed
        if (markImportant && isNode(result, 'Rules')) {
          this.makeImportant(result);
        }
        // Always pop the outer call's stack entries
        context.callStack.pop();
        context.parenFrames.pop();
        return result;
      } finally {}
    } else if (isNode(n, 'Mixin')) {
      n = cast(getFunctionFromMixins(n));
    } else if (isNode(n, 'Func')) {
      // Execute stylesheet-defined functions via their evalCall behavior.
      try {
        const argNodes = await evalArgNodes(args) ?? list([]);
        const result = await (n as any).evalCall(context, argNodes);
        context.callStack.pop();
        context.parenFrames.pop();
        return result;
      } finally {}
    } else if (isNode(n, 'Collection')) {
      if (callName === 'ruleset') {
      }
      // If the evaluated name is Rules or Collection (detached rulesets),
      // return those rules directly, but only if args are empty
      // If args are provided, throw an error - you can't call Rules/Collection with arguments
      if (args && args.value.length > 0) {
        context.callStack.pop();
        context.parenFrames.pop();
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      const Rules = await getRules();
      let rules = Rules.create(n.value, n.options);
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
        this.makeImportant(n);
      }
      return rules;
    }

    let fn = isNode(n, 'JsFunction') ? n.value : n;
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
            if (isNode(copied, 'Reference') && copied.options?.type === 'property') {
              copied.sourceParent = this;
            } else if (isNode(copied, 'Mixin')) {
              copied.sourceParent = this;
            }
            copied.frozen = true;
          }
          args = copiedArgs;
        }
        const shouldPassListArgs = Boolean((fn as any)?._internal || (fn as any)?.options?.params);
        if (callName.includes('wrap-mixin')) {
        }
        if (callName === 'each') {
        }
        const result = await (
          args
            ? (
                shouldPassListArgs
                  ? callWithContext(context, fn, args)
                  : callWithContext(context, fn, ...args.value)
              )
            : callWithContext(context, fn)
        );
        if (callName === 'each') {
        }
        context.caller = originalCaller;
        context.callStack.pop();
        didPopCallStack = true;
        if (isNode(result)) {
          let evald = result.eval(context);
          if (isThenable(evald)) {
            evald = await evald;
            if (markImportant && isNode(evald, 'Rules')) {
              this.makeImportant(evald);
            }
            return adoptCallWhitespace(evald);
          }
          if (markImportant && isNode(evald, 'Rules')) {
            this.makeImportant(evald);
          }
          return adoptCallWhitespace(evald);
        }
        let castResult = cast(result);
        if (isNode(castResult, 'Rules') && castResult.value.length === 1) {
          return adoptCallWhitespace(castResult.value[0]!);
        }
        return adoptCallWhitespace(castResult);
      } catch (e) {
        if (callName === 'each') {
        }
        const unitMode = context?.opts?.unitMode ?? 'loose';
        const shouldRethrowForMode = unitMode === 'strict';
        if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
          if (this.parent?.type === 'SelectorCapture') {
            return adoptCallWhitespace(new Any(String(n.valueOf()), { role: 'ident' }).inherit(this));
          }
          if (isNode(name, 'Reference')) {
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
        newCall.value.name = isNode(name, 'Reference') && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n.valueOf());
        newCall.value.args = await evalArgNodes(args);
        newCall.value.args?.value.forEach((arg, argIndex) => {
          // Normalize fallback-call arg spacing to Less-style call serialization.
          arg.pre = argIndex === 0 ? 0 : 1;
          if (isNode(arg, 'Sequence')) {
            arg.value.forEach((child, childIndex) => {
              child.pre = childIndex === 0 ? 0 : 1;
            });
          } else if (isNode(arg, 'List')) {
            arg.value.forEach((child) => {
              if (isNode(child, 'Sequence')) {
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
        if (isNode(evaluatedArgs.value[0], 'Dimension')) {
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