import { Node, defineType } from './node';
import { type List } from './list';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';
import { callWithContext } from '../define-function';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';

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
    if (this.options?.markImportant) w.add(' !important');
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    context.parenFrames.push(false);
    let { name, args } = this.value;
    const finalize = (evaluatedName: any, evaluatedArgs: any) => {
      context.parenFrames.pop();
      const node = this.maybeClone(context);
      node.value.name = evaluatedName;
      node.value.args = evaluatedArgs;
      return node;
    };
    if (name instanceof Node) {
      return pipe(
        () => typeof name === 'string' ? name : name.eval(context),
        (n) => {
          name = n;
          if (isNode(name, 'JsFunction')) {
            const fn = name.value;
            const out = args ? callWithContext(context, fn, ...args.value) : callWithContext(context, fn);
            if (out && typeof (out as any).then === 'function') {
              return (out as Promise<any>).then(result => cast(result).inherit(this));
            }
            return cast(out).inherit(this);
          } else {
            if (name === 'calc') {
              context.calcFrames.push(true);
            }
            const maybeArgs = args?.eval(context);
            if (maybeArgs && typeof (maybeArgs as any).then === 'function') {
              return (maybeArgs as Promise<List | undefined>).then((a) => {
                if (name === 'calc') {
                  context.calcFrames.pop();
                }
                return finalize(name, a);
              });
            }
            if (name === 'calc') {
              context.calcFrames.pop();
            }
            return finalize(name, maybeArgs);
          }
        }
      );
    } else {
      if (name === 'calc') {
        context.calcFrames.push(true);
      }
      const maybeArgs = args?.eval(context);
      if (maybeArgs && typeof (maybeArgs as any).then === 'function') {
        return (maybeArgs as Promise<List | undefined>).then((a) => {
          if (name === 'calc') {
            context.calcFrames.pop();
          }
          return finalize(name, a);
        });
      }
      if (name === 'calc') {
        context.calcFrames.pop();
      }
      return finalize(name, maybeArgs);
    }
  }
}

type Params = ConstructorParameters<typeof Call>;

export const call = defineType(Call, 'Call') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Call;