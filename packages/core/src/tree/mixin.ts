import { F_VISIBLE, Node, defineType, type LocationInfo } from './node.js';
import { Condition } from './condition.js';
import { List } from './list.js';
import { Any, type AnyRole } from './any.js';
import { Rules } from './rules.js';
import { Interpolated } from './interpolated.js';
import type { Context } from '../context.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';
import { callableGuardContainsDefault } from './util/callable-entry.js';

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
  constructor(value: MixinValue, options?: MixinOptions, location?: LocationInfo) {
    if (options?.hasDefault === undefined && value.guard && callableGuardContainsDefault(value.guard)) {
      options = { ...options, hasDefault: true };
    }
    super(value, options, location);
    this.removeFlag(F_VISIBLE);
  }

  // Mixin owns registration prep and marks `registrationPrepared` directly.

  private ownName(value: NonNullable<MixinValue['name']>): NonNullable<MixinValue['name']> {
    const owned = canReuseLeaf(value) ? reuseLeaf(value) : copyWithReusableLeaves(value);
    if (owned instanceof Interpolated || owned instanceof Any) {
      return owned;
    }
    throw new TypeError('Expected mixin name copy');
  }

  private ownRules(value: Rules): Rules {
    const owned = canReuseLeaf(value) ? reuseLeaf(value) : copyWithReusableLeaves(value);
    if (owned instanceof Rules) {
      return owned;
    }
    throw new TypeError('Expected mixin rules copy');
  }

  private ownParams(value: List<Node> | undefined): List<Node> | undefined {
    if (!value) {
      return undefined;
    }
    const owned = canReuseLeaf(value) ? reuseLeaf(value) : copyWithReusableLeaves(value);
    if (owned instanceof List) {
      return owned;
    }
    throw new TypeError('Expected mixin params copy');
  }

  private ownGuard(value: Condition | undefined): Condition | undefined {
    if (!value) {
      return undefined;
    }
    const owned = canReuseLeaf(value) ? reuseLeaf(value) : copyWithReusableLeaves(value);
    if (owned instanceof Condition) {
      return owned;
    }
    throw new TypeError('Expected mixin guard copy');
  }

  private deriveMixin(value: MixinValue): Mixin {
    return new Mixin(
      {
        ...(value.name !== undefined && { name: this.ownName(value.name) }),
        rules: this.ownRules(value.rules),
        ...(value.params !== undefined && { params: this.ownParams(value.params) }),
        ...(value.guard !== undefined && { guard: this.ownGuard(value.guard) })
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

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
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    let { name, rules, params, guard } = this.value;
    if (name) {
      name.writeSyntax(options);
    } else {
      w.add('@');
    }
    if (name || params || guard) {
      w.add('(');
      if (params) {
        params.writeSyntax(options);
      }
      w.add(')');
    }
    if (guard) {
      w.add(' when ');
      guard.writeSyntax(options);
    }
    if (name || params || guard) {
      w.add(' ');
    }
    // Emit rules directly into shared writer; do not re-add return value
    rules.toBraced(options);
  }

  override prepareRegistration(context: Context): MaybePromise<Mixin> {
    if (this.registrationPrepared) {
      return this;
    }
    return this._prepareMixinRegistration(context);
  }

  private _prepareMixinRegistration(context: Context): MaybePromise<Mixin> {
    // Mixins should NOT prepare their body rules during initial registration.
    // Body rules are prepared/evaluated when the mixin is called.
    let node: Mixin = this;
    let { name, rules } = node.value;
    if (name && name instanceof Interpolated) {
      node = this.deriveMixin(this.value);
      name = node.value.name;
      rules = node.value.rules;
    }
    node.registrationPrepared = true;
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
    node: Mixin,
    name: MixinValue['name'],
    context: Context
  ): MaybePromise<Mixin> {
    if (name && name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          if (!(key instanceof Any)) {
            throw new TypeError('Expected evaluated mixin name');
          }
          node.adopt(key);
          node.value.name = key;
          return node;
        });
      }
      if (!(maybeKey instanceof Any)) {
        throw new TypeError('Expected evaluated mixin name');
      }
      node.adopt(maybeKey);
      node.value.name = maybeKey;
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
  location?: MixinConstructorParams[2]
) => Mixin;
