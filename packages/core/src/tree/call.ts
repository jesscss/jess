import { Node, defineType, type LocationInfo, type TreeContext, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC } from './node.js';
import { type List } from './list.js';
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
import { createRequire } from 'node:module';
import { syncLog } from './util/__tests__/debug-log.js';

const require = createRequire(import.meta.url);

// Lazy getter for Rules to break circular dependency:
// rules.ts → cast.ts → color.ts → call.ts → rules.ts
function getRules() {
  return require('./rules.js').Rules;
}

// #region agent log
function __agentDbgPost(location: string, message: string, data: Record<string, any>) {
  syncLog({
    sessionId: 'debug-session',
    runId: process.env.DEBUG_RUN_ID ?? 'run',
    hypothesisId: 'H1',
    location,
    message,
    data,
    timestamp: Date.now()
  });
}
// #endregion

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin or variable lookup
   *   e.g. $|#mixin|.class() is -> [Call name: [Ref (#mixin.class)], args: []]
   */
  name: string | Node;
  args?: List;
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
    const { name, args, contentNode } = this.value;
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
      args.toString(options);
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
    let { name, args } = this.value;
    let { markImportant } = this.options;

    context.callStack.push(this);
    context.parenFrames.push(false);

    // #region agent log
    try {
      if (isNode(name, 'Reference')) {
        const raw = (name as any).value?.key;
        const keyStr = Array.isArray(raw) ? raw.join('') : String(raw?.valueOf?.() ?? raw ?? '');
        if (keyStr.includes('my-mixins')) {
          __agentDbgPost('call.ts:evalNode', 'enter-my-mixins-call', { keyStr });
        }
      }
    } catch {}
    // #endregion

    let n = typeof name === 'string' ? name : await name.eval(context);
    // #region agent log
    try {
      let key = '';
      let rawStr = '';
      let rawValOfStr = '';
      if (isNode(name, 'Reference')) {
        const raw = (name as any).value?.key;
        rawStr = String(raw ?? '');
        rawValOfStr = raw && typeof raw === 'object' && typeof (raw as any).valueOf === 'function'
          ? String((raw as any).valueOf())
          : '';
        if (Array.isArray(raw)) {
          key = raw.join('');
        } else if (raw && typeof raw === 'object' && typeof (raw as any).valueOf === 'function') {
          key = String((raw as any).valueOf());
        } else {
          key = String(raw ?? '');
        }
      } else if (typeof name === 'string') {
        key = name;
      }
      const resolvedType = typeof n === 'string' ? 'string' : String((n as any)?.type ?? typeof n);
      if (
        key.includes('mix')
        || resolvedType === 'Mixin'
        || resolvedType === 'Collection'
        || resolvedType === 'Rules'
        || (isNode(name, 'Reference') && ((rawStr?.includes?.('mix') ?? false) || (rawValOfStr?.includes?.('mix') ?? false)))
      ) {
        __agentDbgPost('call.ts:evalNode', 'call-name-resolved', {
          key,
          rawStr: isNode(name, 'Reference') ? rawStr : undefined,
          rawValOfStr: isNode(name, 'Reference') ? rawValOfStr : undefined,
          resolvedType,
          leakyRules: !!context.leakyRules
        });
      }
    } catch {}
    // #endregion

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
        const evaluatedArgs = args ? await args.eval(context) : undefined;
        const argNodes = evaluatedArgs ? (evaluatedArgs as List).value as unknown as Node[] : [];
        const result = await (n as any).evalCall(context, argNodes);
        context.callStack.pop();
        context.parenFrames.pop();
        return result;
      } finally {}
    } else if (isNode(n, 'Collection')) {
      // If the evaluated name is Rules or Collection (detached rulesets),
      // return those rules directly, but only if args are empty
      // If args are provided, throw an error - you can't call Rules/Collection with arguments
      if (args && args.value.length > 0) {
        context.callStack.pop();
        context.parenFrames.pop();
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      const Rules = getRules();
      let rules = Rules.create(n.value, n.options);
      // #region agent log
      __agentDbgPost('call.ts:CollectionCall', 'collection-call-create-rules', {
        hasArgs: !!args && args.value.length > 0,
        collLen: Array.isArray(n.value) ? n.value.length : -1,
        rulesLen: Array.isArray(rules.value) ? rules.value.length : -1,
        collHasRulesVisibility: !!(n as any)?.options?.rulesVisibility,
        collChildTypes: Array.isArray(n.value)
          ? n.value.slice(0, 3).map((x: any) => String(x?.type ?? '')).join(',')
          : '',
        collChild0Key: (() => {
          try {
            const first: any = Array.isArray(n.value) ? n.value[0] : undefined;
            if (!first) return '';
            if (first.type === 'Ruleset') return String(first.value?.selector?.valueOf?.() ?? '');
            if (first.type === 'Mixin') return String(first.value?.name?.valueOf?.() ?? '');
            if (first.type === 'Declaration') {
              const name = first.value?.name;
              return typeof name === 'string' ? name : String(name?.valueOf?.() ?? '');
            }
            return '';
          } catch {
            return '';
          }
        })()
      });
      // #endregion
      // Inherit from Collection (n) to preserve definition-scope parent chain
      // This ensures variables like @a resolve from where the detached ruleset was defined
      // Also copies sourceParent from the Collection (which was set by Reference when it resolved)
      rules.inherit(n);
      rules = await rules.eval(context);
      // #region agent log
      __agentDbgPost('call.ts:CollectionCall', 'collection-call-eval-rules-done', {
        evaldRulesLen: Array.isArray(rules.value) ? rules.value.length : -1,
        evaldRulesSetLen: (rules as any).rulesSet ? (rules as any).rulesSet.length : -1,
        evaldIsMixinOutput: !!(rules as any).options?.isMixinOutput
      });
      // #endregion
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
      try {
        if (process.env.DEBUG && (typeof name === 'string' ? name : (isNode(name, 'Reference') ? name.value.key?.valueOf?.() : undefined)) === 'pi') {
          console.log('[Call.evalNode] pi() resolved to function', { silentFail: this.options?.silentFail });
        }
        /** Freeze args */
        if (args) {
          args = args.copy(true, freezeChildren);
          args.frozen = true;
        }
        let originalCaller = context.caller;
        context.caller = this;
        const result = await (
          args
            ? callWithContext(context, fn, args)
            : callWithContext(context, fn)
        );
        context.caller = originalCaller;
        context.callStack.pop();
        if (isNode(result)) {
          let evald = result.eval(context);
          if (isThenable(evald)) {
            evald = await evald;
            if (markImportant && isNode(evald, 'Rules')) {
              this.makeImportant(evald);
            }
            return evald;
          }
          if (markImportant && isNode(evald, 'Rules')) {
            this.makeImportant(evald);
          }
          return evald;
        }
        let castResult = cast(result);
        if (isNode(castResult, 'Rules') && castResult.value.length === 1) {
          return castResult.value[0]!;
        }
        return castResult;
      } catch (e) {
        // #region agent log
        try {
          const key = typeof name === 'string'
            ? name
            : (isNode(name, 'Reference')
              ? String((name as any).value?.key?.valueOf?.() ?? (name as any).value?.key ?? '')
              : (isNode(name) ? name.type : 'unknown'));
          if (key.includes('wrap') || key.includes('ruleset') || key.includes('mixin')) {
            __agentDbgPost('call.ts:evalNode', 'call-exception', {
              key,
              silentFail: !!this.options?.silentFail,
              markImportant: !!this.options?.markImportant,
              err: e ? String((e as any).message ?? e) : 'unknown'
            });
          }
        } catch {}
        // #endregion
        if (process.env.DEBUG && (typeof name === 'string' ? name : (isNode(name, 'Reference') ? name.value.key?.valueOf?.() : undefined)) === 'pi') {
          console.log('[Call.evalNode] pi() threw', { silentFail: this.options?.silentFail, message: (e as any)?.message });
        }
        if (e instanceof ReferenceError && e.message.includes('No matching mixins')) {
          if (isNode(name, 'Reference')) {
            throw new ReferenceError(`No matching mixins found for '${name.value.key.valueOf()}'`);
          }
          throw e;
        }
        if (!this.options?.silentFail) {
          throw e;
        }
        let newCall = this.clone().inherit(this);
        /** Remove this flag for serialization */
        newCall.options.silentFail = false;
        newCall.value.name = isNode(name, 'Reference') && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n.valueOf());
        newCall.value.args = await args?.eval(context);
        // #region agent log
        try {
          const key = typeof name === 'string'
            ? name
            : (isNode(name, 'Reference')
              ? String((name as any).value?.key?.valueOf?.() ?? (name as any).value?.key ?? '')
              : (isNode(name) ? name.type : 'unknown'));
          __agentDbgPost('call.ts:evalNode', 'call-silentFail-return-callnode', {
            key,
            newName: String(newCall.value.name),
            hasArgs: !!newCall.value.args && (newCall.value.args as any).value?.length != null
          });
        } catch {}
        // #endregion
        context.callStack.pop();
        context.parenFrames.pop();
        return newCall;
      }
    } else {
      if (n === 'calc') {
        context.calcFrames++;
      }
      args = await args?.eval(context);

      if (n === 'calc') {
        context.calcFrames--;
      }
      context.parenFrames.pop();
      context.callStack.pop();
      const node = this.clone();
      node.options.silentFail = false;
      if (
        n === 'calc' && args
      ) {
        if (isNode((args as List).value[0], 'Dimension')) {
          return args.value[0]!;
        } else if (context.calcFrames !== 0) {
          return new Paren(args.value[0]);
        }
      }
      node.value.name = n;
      node.value.args = args;
      return node;
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