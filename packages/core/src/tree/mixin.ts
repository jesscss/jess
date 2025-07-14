import { Node, defineType } from './node';
import type { Condition } from './condition';
import { type List } from './list';
import type { Rest } from './rest';
import type { Name } from './general';
import { type VarDeclaration } from './var-declaration';
import type { Rules } from './rules';
import { Interpolated } from './interpolated';
import type { Context } from '../context';
import type { Selector } from './selector';
import type { Declaration } from '..';

export interface MixinValue {
  /**
   * A mixin name can be compound, like `type.foo#id` because
   * of interpolation. It will actually be re-parsed as a Sequence
   * Node in those cases, in order to register it along-side
   * "namespaced" mixins.
   *
   * @note - For Sass, a mixin name is always a single identifier,
   * but Less uses mixins / rulesets interchangeably, so we use
   * `selector` as a property and `Selector` as the type to allow
   * more flexibility.
   */
  selector?: Selector;
  /**
   * Functions can be assigned an expression when parsing,
   * but it will be evaluated as a set of Rules with a scope
   * and an implicit `return`
   */
  rules: Rules;
  /**
   * - A plain node is a kind of value guard.
   * - A name is just a named variable.
   * - A var declaration is a named variable with a default value.
   * - A rest is a rest parameter.
   */
  params?: List<Node | Name | VarDeclaration | Rest>;
  guard?: Condition;
}

export type MixinOptions = {
  /** This is a flag that will set during parsing */
  hasDefault?: boolean;

  /** If this is a function, specify what is returned  */
  isFunctionWith?: 'rules' | 'expression';

  /**
   * Cannot be overloaded. Written as !my-mixin() in Jess.
   * If multiple mixin matches are found with the same
   * name in a scope, it will throw an error.
   */
  unique?: boolean;
};

/**
 * someMixin (arg1; arg2: 10px) {
 *   color: black;
 *   background-color: white;
 *   border-radius: $arg2;
 * }
 *
 *
 * Note that mixin calls are called as JavaScript functions,
 * with either only positional arguments, or a plain object
 * as the first argument, representing named arguments,
 * followed by positional arguments.
 *
 * e.g. `foo($a; $b) { ... }`
 *   can be called from JS like:
 *     foo(1, 2) or
 *     foo({ a: 1, b: 2 }) or
 *     foo({ b: 2 }, 1)
 */

export class Mixin extends Node<MixinValue, MixinOptions> {
  type = 'Mixin';
  shortType = 'mixin';

  override toTrimmedString(depth: number = 0): string {
    let { selector, rules, params, guard } = this.value;
    let { isFunctionWith } = this.options;
    let space = ''.padStart(depth * 2);
    let output = `${selector}`;
    if (params) {
      output += '(';
      output += params.toString(depth);
      output += ')';
    }
    if (guard) {
      output += ` when ${guard}`;
    }
    if (isFunctionWith) {
      output += ' >';
    }
    if (isFunctionWith === 'expression') {
      output += ` ${(rules.at(0) as Declaration).value.value.toString(depth)}`;
    } else {
      output += ' {\n';
      output += rules.toString(depth + 1);
      output += `${space}}`;
    }
    return output;
  }

  override async preEval(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      let node = this.maybeClone(context);
      node.preEvaluated = true;
      let { selector } = node.value;
      if (selector && selector instanceof Interpolated) {
        node.value.selector = (await selector.eval(context)).createSelector();
      }
      return node;
    }
    return this;
  }

  // override async evalNode(context: Context): Promise<Rules | Expression> {
  //   let { name, body, params, guard } = this.value
  //   if (name instanceof Interpolated) {
  //     name
  // }

  /**
   * @todo -
   * Return either a ruleset if `this` is the eval context,
   * or return ruleset.obj() if not (for React/Vue)
   *
   * @todo - move to visitors
   */
  // toModule(context: Context, out: OutputCollector) {
  //   const { name, args, value } = this
  //   const nm = name.value
  //   if (context.depth === 0) {
  //     out.add(`export let ${nm}`, this.location)
  //     context.exports.add(nm)
  //   } else {
  //     if (context.depth !== 1) {
  //       out.add('let ')
  //     }
  //     out.add(`${nm} = function(`)
  //     if (args) {
  //       const length = args.value.length - 1
  //       args.value.forEach((node, i) => {
  //         if (node instanceof JsIdent) {
  //           out.add(node.value)
  //         } else {
  //           out.add(node.name.value)
  //           out.add(' = ')
  //           node.value.toModule(context, out)
  //         }
  //         if (i < length) {
  //           out.add(', ')
  //         }
  //       })
  //     }
  //     out.add(') { return ')
  //     value.toModule(context, out)
  //     out.add('}')
  //   }
  // }
}

type MixinConstructorParams = ConstructorParameters<typeof Mixin>;

export const mixin = defineType(Mixin, 'Mixin') as (
  value: MixinValue | MixinConstructorParams[0],
  options?: MixinConstructorParams[1],
  location?: MixinConstructorParams[2],
  treeContext?: MixinConstructorParams[3]
) => Mixin;