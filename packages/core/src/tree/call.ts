import { Node, defineType, type LocationInfo, type TreeContext, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC } from './node';
import { type List } from './list';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';
import { callWithContext } from '../define-function';
import { type PrintOptions, getPrintOptions } from './util/print';
import { Paren } from './paren';

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
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { name, args } = this.value;
    if (typeof name === 'string') {
      w.add(name, this);
    } else {
      name.toString(options);
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

  /** Come back and redo -- too hard to reason about as a MaybePromise */
  override async evalNode(context: Context): Promise<Node> {
    // if (context.callStack.includes(this.sourceNode)) {
    //   throw new ReferenceError('Recursive call detected');
    // }
    context.callStack.push(this.sourceNode);
    context.parenFrames.push(false);
    let { name, args } = this.value;
    let n = typeof name === 'string' ? name : await name.eval(context);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
      method: 'POST',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'call.ts:89',
        message: 'Call.evalNode: name evaluated',
        data: {
          nameType: typeof name === 'string' ? 'string' : name.type,
          evaluatedType: typeof n === 'string' ? 'string' : (n?.type ?? typeof n),
          isJsFunction: typeof n !== 'string' && isNode(n, 'JsFunction'),
          isFunction: typeof n === 'function'
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'A'
      })
    }).catch(() => {});
    // #endregion

    if (isNode(n, 'JsFunction')) {
      const fn = n.value;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: 'call.ts:113',
          message: 'Call.evalNode: calling JsFunction',
          data: {
            hasArgs: !!args,
            argsLength: args ? args.value?.length : 0,
            fnType: typeof fn
          },
          timestamp: Date.now(),
          sessionId: 'debug-session',
          runId: 'run1',
          hypothesisId: 'D'
        })
      }).catch(() => {});
      // #endregion
      try {
        const result = await (
          args
            ? callWithContext(context, fn, ...args.value)
            : callWithContext(context, fn)
        );
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'call.ts:113',
            message: 'Call.evalNode: JsFunction call result',
            data: {
              resultType: result?.type ?? typeof result,
              isRules: result?.type === 'Rules',
              isNode: result instanceof Node,
              rulesLength: result?.type === 'Rules' ? (result as any).value?.length : 0,
              rulesTypes: result?.type === 'Rules' ? (result as any).value?.map((n: any) => n?.type) : []
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'D'
          })
        }).catch(() => {});
        // #endregion
        context.callStack.pop();
        return cast(result);
      } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'call.ts:113',
            message: 'Call.evalNode: JsFunction call error',
            data: {
              error: String(e),
              errorStack: e instanceof Error ? e.stack : undefined
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'D'
          })
        }).catch(() => {});
        // #endregion
        let newCall = this.clone().inherit(this);
        newCall.value.name = isNode(name, 'Reference') && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n.valueOf());
        newCall.value.args = await args?.eval(context);
        context.callStack.pop();
        return newCall;
      }
    } else if (typeof n === 'function') {
      // Check if n is a function (from getFunctionFromMixins) - handle BEFORE popping stacks
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: 'call.ts:113',
          message: 'Call.evalNode: calling function from mixin',
          data: {
            hasArgs: !!args,
            argsLength: args ? (args as any).value?.length : 0
          },
          timestamp: Date.now(),
          sessionId: 'debug-session',
          runId: 'run1',
          hypothesisId: 'B'
        })
      }).catch(() => {});
      // #endregion
      if (n === 'calc') {
        context.calcFrames.push(true);
      }
      args = await args?.eval(context);
      if (n === 'calc') {
        context.calcFrames.pop();
      }
      try {
        const result = await (
          args
            ? callWithContext(context, n, ...(args as any).value)
            : callWithContext(context, n)
        );
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'call.ts:113',
            message: 'Call.evalNode: function call result',
            data: {
              resultType: result?.type ?? typeof result,
              isRules: result?.type === 'Rules'
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'B'
          })
        }).catch(() => {});
        // #endregion
        context.parenFrames.pop();
        context.callStack.pop();
        return cast(result);
      } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/1edfe575-2050-4a93-8751-72368827c42e', {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'call.ts:113',
            message: 'Call.evalNode: function call error',
            data: {
              error: String(e)
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'B'
          })
        }).catch(() => {});
        // #endregion
        let newCall = this.clone().inherit(this);
        newCall.value.name = isNode(name, 'Reference') && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n);
        newCall.value.args = args;
        context.parenFrames.pop();
        context.callStack.pop();
        return newCall;
      }
    } else {
      if (n === 'calc') {
        context.calcFrames.push(true);
      }
      args = await args?.eval(context);

      if (n === 'calc') {
        context.calcFrames.pop();
      }
      context.parenFrames.pop();
      context.callStack.pop();
      const node = this;
      if (
        n === 'calc' && args
      ) {
        if (isNode((args as List).value[0], 'Dimension')) {
          return args.value[0]!;
        } else if (context.calcFrames.at(-1)) {
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