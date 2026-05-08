import { F_VISIBLE, Node, defineType, type LocationInfo } from './node.js';
import type { Condition } from './condition.js';
import { type List } from './list.js';
import type { Any, AnyRole } from './any.js';
import type { Rules } from './rules.js';
import { Interpolated } from './interpolated.js';
import type { Context, TreeContext } from '../context.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export interface MixinValue<Name extends AnyRole = 'name'> {
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
  name?: Any<Name> | Interpolated<Name>;
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
  params?: List<Node>;
  guard?: Condition;
}

export type MixinOptions = {
  /** This is a flag that will set during parsing */
  hasDefault?: boolean;

  /**
   * Cannot be overloaded. Written as !my-mixin() in Jess.
   * If multiple mixin matches are found with the same
   * name in a scope, it will throw an error.
   */
  unique?: boolean;
};

// const COMPOUND_REGEX = /[#.]?[-_a-zA-Z\xA0-\uFFFF][-_a-zA-Z0-9\xA0-\uFFFF]*/ug;
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
  constructor(value: MixinValue, options?: MixinOptions, location?: LocationInfo, context?: TreeContext) {
    super(value, options, location, context);
    this.removeFlag(F_VISIBLE);
  }

  // Mixin has preEval method but doesn't need to set flags - preEvaluated is tracked as boolean

  /** Return a selector-like keySet */
  private _keySet: Set<string> | undefined;
  get keySet() {
    let keySet = this._keySet;
    if (!keySet) {
      let { name } = this.value;
      if (!name) {
        return (this._keySet = new Set());
      }
      keySet = this._keySet = new Set([name.valueOf()]);
    }
    return keySet;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { name, rules, params, guard } = this.value;
    const mark = w.mark();
    w.add(name ? `${name}` : '@');
    if (name || params || guard) {
      w.add('(');
      if (params) {
        params.toString(options);
      }
      w.add(')');
    }
    if (guard) {
      w.add(' when ');
      w.add(`${guard}`);
    }
    if (name || params || guard) {
      w.add(' ');
    }
    // Emit rules directly into shared writer; do not re-add return value
    rules.toBraced(options);
    return w.getSince(mark);
  }

  override preEval(context: Context): MaybePromise<this> {
    return this.prepareRegistration(context);
  }

  override prepareRegistration(context: Context): MaybePromise<this> {
    if (this.preEvaluated) {
      return this;
    }
    return this._prepareMixinRegistration(context);
  }

  private _prepareMixinRegistration(context: Context): MaybePromise<this> {
    // Mixins should NOT pre-evaluate their rules during initial registration.
    // Rules inside mixins should only be pre-evaluated when the mixin is called.
    let node = this;
    let { name, rules } = node.value;
    if (name && name instanceof Interpolated) {
      node = this.clone(false) as this;
      name = node.value.name;
      rules = node.value.rules;
    }
    node.preEvaluated = true;
    this._prepareMixinBodyVisibility(rules, context);
    return this._prepareMixinNameIdentity(node, name, context);
  }

  private _prepareMixinBodyVisibility(rules: Rules, context: Context): void {
    if (context.leakyRules) {
      rules.options.rulesVisibility.Mixin = 'public';
      // Keep Less mixin-definition vars as fallback by default. Call-time scope
      // controls for params/local vars are handled in mixin evaluation paths.
      rules.options.rulesVisibility.VarDeclaration = 'optional';
    } else {
      rules.options.rulesVisibility.Mixin = 'private';
      rules.options.rulesVisibility.VarDeclaration = 'private';
    }
  }

  private _prepareMixinNameIdentity(
    node: this,
    name: MixinValue['name'],
    context: Context
  ): MaybePromise<this> {
    if (name && name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return (maybeKey as Promise<Any<'name'>>).then((key) => {
          node.value.name = key;
          return node;
        });
      }
      node.value.name = maybeKey as Any<'name'>;
    }
    return node;
  }

  /** Since this is a mixin definition, it's not evaluated until it's called. */
  override evalNode() {
    return this;
  }

  override resolve(_context: Context): this {
    return this.evalNode();
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
  value: MixinValue<AnyRole> | MixinConstructorParams[0],
  options?: MixinConstructorParams[1],
  location?: MixinConstructorParams[2],
  treeContext?: MixinConstructorParams[3]
) => Mixin;
