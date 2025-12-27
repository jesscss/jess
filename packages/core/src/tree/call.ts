import { Node, defineType, type LocationInfo, type TreeContext, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC } from './node';
import { type List } from './list';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';
import { callWithContext } from '../define-function';
import { type PrintOptions, getPrintOptions } from './util/print';
import { Paren } from './paren';
import { isThenable } from '@jesscss/awaitable-pipe';
import { type Rules } from './rules';
import { Any } from './any';

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
    // if (context.callStack.includes(this.sourceNode)) {
    //   throw new ReferenceError('Recursive call detected');
    // }
    context.callStack.push(this.sourceNode);
    context.parenFrames.push(false);
    let { name, args } = this.value;
    let { markImportant } = this.options;
    let n = typeof name === 'string' ? name : await name.eval(context);

    let fn = isNode(n, 'JsFunction') ? n.value : n;

    if (typeof fn === 'function') {
      try {
        const result = await (
          args
            ? callWithContext(context, fn, ...args.value)
            : callWithContext(context, fn)
        );
        context.callStack.pop();
        if (isNode(result)) {
          let evald = result.eval(context);
          if (isThenable(evald)) {
            evald = await evald;
            if (markImportant) {
              this.makeImportant(evald as Rules);
            }
            return evald;
          }
          if (markImportant) {
            this.makeImportant(evald as Rules);
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
        newCall.value.name = isNode(name, 'Reference') && name.options.fallbackValue === true
          ? String(name.value.key)
          : String(n.valueOf());
        newCall.value.args = await args?.eval(context);
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