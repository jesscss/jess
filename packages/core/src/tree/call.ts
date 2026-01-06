import { Node, defineType, type LocationInfo, type TreeContext, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC } from './node';
import { type List } from './list';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';
import { callWithContext } from '../define-function';
import { type PrintOptions, getPrintOptions } from './util/print';
import { Paren } from './paren';
import { isThenable } from '@jesscss/awaitable-pipe';
import { getFunctionFromMixins, Rules } from './rules';
import { Any } from './any';
import { freezeChildren } from './util/cloning';

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin or variable lookup
   *   e.g. $|#mixin|.class() is -> [Call name: [Ref (#mixin.class)], args: []]
   */
  name: string | Node;
  args?: List;
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
    const { name, args } = this.value;
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

    let n = typeof name === 'string' ? name : await name.eval(context);
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
    } else if (isNode(n, 'Collection')) {
      // If the evaluated name is Rules or Collection (detached rulesets),
      // return those rules directly, but only if args are empty
      // If args are provided, throw an error - you can't call Rules/Collection with arguments
      if (args && args.value.length > 0) {
        context.callStack.pop();
        context.parenFrames.pop();
        throw new ReferenceError(`Cannot call ${n.type} with arguments`);
      }
      let rules = Rules.create(n.value, n.options);
      rules.inherit(n);
      rules = await rules.eval(context);
      // #region agent log
      const callName = typeof name === 'string' ? name : (isNode(name, 'Reference') ? String(name.value.key?.valueOf() ?? '') : 'unknown');
      const isRules = isNode(n, 'Rules');
      const hasMixin = isRules && n.value.some(node => isNode(node, ['Mixin', 'Ruleset']));
      if (hasMixin || callName.includes('mixins')) {
        const mixinCount = isRules ? n.value.filter(node => isNode(node, ['Mixin', 'Ruleset'])).length : 0;
        const mixinNames = isRules && hasMixin
          ? n.value.filter(node => isNode(node, ['Mixin', 'Ruleset'])).map((node) => {
              if (isNode(node, 'Mixin')) {
                return String(node.value.name?.valueOf() ?? '');
              }
              if (isNode(node, 'Ruleset')) {
                return String(node.value.selector?.toString() ?? '');
              }
              return '';
            })
          : [];
        const hasMixinName = mixinNames.some(name => name.includes('.mixin') || name === '.mixin');
        const parentRules = this.rulesParent;
        fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', { method: 'POST', headers: { contentType: 'application/json' }, body: JSON.stringify({ location: 'call.ts:183', message: 'Call.evalNode: returning Rules/Collection from variable', data: { callName, nodeType: n.type, mixinCount, mixinNames, hasMixinName, rulesVisibility: n.options.rulesVisibility, rulesIndex: n.index, parentRulesIndex: parentRules?.index, parentRulesType: parentRules?.type, callIndex: this.index }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run25', hypothesisId: 'S' }) }).catch(() => {});
      }
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
      // #region agent log
      const callNameForLog = typeof name === 'string' ? name : (isNode(name, 'Reference') ? String(name.value.key?.valueOf() ?? '') : 'unknown');
      const hasCollectionArg = args && args.value.some((arg: any) => isNode(arg, 'Collection'));
      if (hasCollectionArg || callNameForLog.includes('mixins') || callNameForLog === 'my-mixins' || callNameForLog.includes('desktop-and-old-ie')) {
        const nType = isNode(n) ? n.type : typeof n;
        const fnType = typeof fn;
        const hasOptions = !!(fn as any)?.options;
        const hasParams = !!(fn as any)?.options?.params;
        const paramsValue = (fn as any)?.options?.params;
        fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', { method: 'POST', headers: { contentType: 'application/json' }, body: JSON.stringify({ location: 'call.ts:206', message: 'Call.evalNode: calling function', data: { callName: callNameForLog, nType, fnType, hasOptions, hasParams, paramsValue: Array.isArray(paramsValue) ? paramsValue.length : paramsValue, argsLength: args?.value.length ?? 0, hasCollectionArg }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run27', hypothesisId: 'U' }) }).catch(() => {});
      }
      // #endregion
      try {
        /** Freeze args */
        if (args) {
          args = args.copy(true, freezeChildren);
          args.frozen = true;
        }
        const result = await (
          args
            ? callWithContext(context, fn, args)
            : callWithContext(context, fn)
        );
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