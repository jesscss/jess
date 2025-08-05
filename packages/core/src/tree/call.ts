import { Node, defineType } from './node';
import { type List } from './list';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import { cast } from './util/cast';

export type CallValue = {
  /**
   * Can be an identifier or something like a mixin or variable lookup
   *   e.g. #mixin > .class() is [Call (#mixin ())] -> [Call (.class ())]
   */
  name: string | Node;
  args?: List;
  /**
   * Legacy Less feature -- if a ruleset is returned,
   * all the properties can be marked as important.
   */
  important?: boolean;
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
export class Call extends Node<CallValue> {
  type = 'Call' as const;
  shortType = 'call' as const;
  override _requiredSemi = true;

  override toTrimmedString() {
    let { name, args, important } = this.value;
    return `${name}(${args ?? ''})${important ? ' !important' : ''}`;
  }

  override async evalNode(context: Context): Promise<Node> {
    let canOperate = context.canOperate;
    /** Reset parentheses "state" */
    context.canOperate = false;
    let { name, args } = this.value;
    if (name instanceof Node) {
      name = await name.eval(context);
    }

    if (isNode(name, 'JsFunction')) {
      // try {
      const func = name.value;
      let result: any;
      if (func.fn.evalArgs !== false) {
        if (args) {
          args = await args?.eval(context);
        }
      }
      if (args) {
        result = await func.fn.call(context, ...args.value);
      } else {
        result = await func.fn.call(context);
      }

      /** @todo - mark results as important */
      return cast(result).inherit(this);
      // } catch (e) {
      /** Do something with JS errors */
      // console.log(e)
      // }
    } else {
      args = await args?.eval(context);
    }
    context.canOperate = canOperate;
    let node = this.maybeClone(context);
    node.value.name = name;
    node.value.args = args;
    return node;
  }
}

type Params = ConstructorParameters<typeof Call>;

export const call = defineType(Call, 'Call') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Call;