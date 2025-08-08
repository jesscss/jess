import { Node, defineType } from './node';
import type { Condition } from './condition';
import { type List } from './list';
import type { Rest } from './rest';
import type { Name } from './general';
import { type VarDeclaration } from './declaration-var';
import type { Rules } from './rules';
import { Interpolated } from './interpolated';
import type { Context } from '../context';
import type { Selector } from './selector';
import type { Declaration } from './declaration';
import { type PrintOptions, getPrintOptions } from './util/print';

export interface MixinValue {
  /**
   * Mixin names can include . or # - in Sass they have to be escaped.
   *
   * Valid mixin names:
   *   foo
   *   foo.bar
   *   foo#bar
   *   foo.bar#baz
   *   foo#bar.baz
   *   -foo
   *   _foo (private, from Sass both -foo and _foo are parsed as _foo)
   *
   * @todo - Should anonymous mixins have a different class type?
   */
  name?: Name;
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

const COMPOUND_REGEX = /[#.]?[-_a-zA-Z\xA0-\uFFFF][-_a-zA-Z0-9\xA0-\uFFFF]*/ug;
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
 *
 * @todo - Even though we allow a selector as a name.
 */
export class Mixin extends Node<MixinValue, MixinOptions> {
  type = 'Mixin';
  shortType = 'mixin';

  /** Return a selector-like keySet */
  private _keySet: Set<string> | undefined;
  get keySet() {
    let keySet = this._keySet;
    if (!keySet) {
      let { name } = this.value;
      if (!name) {
        return (this._keySet = new Set());
      }
      let matches = name.toString().match(COMPOUND_REGEX) ?? [];
      keySet = this._keySet = new Set(matches);
    }
    return keySet;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const depth = options.depth ?? 0;
    let { name, rules, params, guard } = this.value;
    let { isFunctionWith } = this.options;
    const mark = w.mark();
    w.add(`${name}`);
    w.add('(');
    if (params) params.toString(options);
    w.add(')');
    if (guard) {
      w.add(' when ');
      w.add(`${guard}`);
    }
    if (isFunctionWith) {
      w.add(' >');
    }
    if (isFunctionWith === 'expression') {
      w.add(' ');
      (rules.at(0) as Declaration).value.value.toString(options);
    } else {
      w.add(' ');
      w.add(rules.toBraced(depth, options));
    }
    return w.getSince(mark);
  }

  override async preEval(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      let node = this.maybeClone(context);
      node.preEvaluated = true;
      let { name } = node.value;
      if (name && name instanceof Interpolated) {
        node.value.name = await name.eval(context);
      }
      return node;
    }
    return this;
  }

  /** Since this is a mixin definition, it's not evaluated until it's called. */

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