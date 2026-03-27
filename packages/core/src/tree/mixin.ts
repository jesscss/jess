import { F_VISIBLE, Node, defineType, type OptionalLocation } from './node.js';
import type { Condition } from './condition.js';
import { type List } from './list.js';
import type { Any, AnyRole } from './any.js';
import type { Rules } from './rules.js';
import { Interpolated } from './interpolated.js';
import type { Context, TreeContext } from '../context.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getField, setField } from './util/field-helpers.js';

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
export interface Mixin {
  type: 'Mixin';
  shortType: 'mixin';
}

export class Mixin extends Node<MixinValue, MixinOptions> {
  static override childKeys = ['name', 'rules', 'params', 'guard'] as const;

  readonly name: Any<AnyRole> | Interpolated<AnyRole> | undefined;
  readonly rules!: Rules;
  readonly params: List<Node> | undefined;
  readonly guard: Condition | undefined;

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const name = this._getName(ctx);
    const rules = this._getRulesContainer(ctx);
    const params = this._getParams(ctx);
    const guard = this._getGuard(ctx);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const cloneData: MixinValue = {
      name: deep && name instanceof Node ? cloneChild(name) as Any<AnyRole> | Interpolated<AnyRole> : name,
      rules: deep ? cloneChild(rules) as Rules : rules,
      params: deep && params instanceof Node ? cloneChild(params) as List<Node> : params,
      guard: deep && guard instanceof Node ? cloneChild(guard) as Condition : guard
    };

    let priorChildParents: Array<[Node, Node | undefined]> | undefined;
    if (!deep && ctx?.session) {
      priorChildParents = [];
      if (cloneData.name instanceof Node) {
        priorChildParents.push([cloneData.name, cloneData.name.parent]);
      }
      if (cloneData.rules instanceof Node) {
        priorChildParents.push([cloneData.rules, cloneData.rules.parent]);
      }
      if (cloneData.params instanceof Node) {
        priorChildParents.push([cloneData.params, cloneData.params.parent]);
      }
      if (cloneData.guard instanceof Node) {
        priorChildParents.push([cloneData.guard, cloneData.guard.parent]);
      }
    }

    const options = (this as any)._meta?.options;
    const newNode = new (this.constructor as any)(
      cloneData,
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );

    if (priorChildParents) {
      const session = ctx!.session!;
      for (const [child, priorParent] of priorChildParents) {
        session.getRuntime(child).parent = newNode;
        (child as unknown as { parent?: Node }).parent = priorParent;
      }
    }

    newNode.inherit(this);
    return newNode;
  }

  constructor(value: MixinValue, options?: MixinOptions, location?: OptionalLocation, context?: TreeContext) {
    super(value, options, location, context);
    this.name = value.name;
    this.rules = value.rules;
    this.params = value.params;
    this.guard = value.guard;
    if (this.name instanceof Node) {
      this.adopt(this.name);
    }
    if (this.rules instanceof Node) {
      this.adopt(this.rules);
    }
    if (this.params instanceof Node) {
      this.adopt(this.params);
    }
    if (this.guard instanceof Node) {
      this.adopt(this.guard);
    }
    this.removeFlag(F_VISIBLE);
  }

  // Mixin has preEval method but doesn't need to set flags - preEvaluated is tracked as boolean

  /** Return a selector-like keySet */
  private _keySet: Set<string> | undefined;

  private _getName(context?: Context): Any<AnyRole> | Interpolated<AnyRole> | undefined {
    return context
      ? getField<Any<AnyRole> | Interpolated<AnyRole> | undefined>(this, 'name', context)
      : this.name;
  }

  private _getRulesContainer(context?: Context): Rules {
    return context
      ? getField<Rules>(this, 'rules', context)
      : this.rules;
  }

  private _getParams(context?: Context): List<Node> | undefined {
    return context
      ? getField<List<Node> | undefined>(this, 'params', context)
      : this.params;
  }

  private _getGuard(context?: Context): Condition | undefined {
    return context
      ? getField<Condition | undefined>(this, 'guard', context)
      : this.guard;
  }

  get keySet() {
    let keySet = this._keySet;
    if (!keySet) {
      const name = this.name;
      if (!name) {
        return (this._keySet = new Set());
      }
      keySet = this._keySet = new Set([name.valueOf()]);
    }
    return keySet;
  }

  getKeySet(context?: Context): Set<string> {
    if (!context) {
      return this.keySet;
    }
    const name = this._getName(context);
    if (!name) {
      return new Set();
    }
    return new Set([name.valueOf()]);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const context = options.context;
    const name = this._getName(context);
    const rules = this._getRulesContainer(context);
    const params = this._getParams(context);
    const guard = this._getGuard(context);
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
    if (this._isPreEvaluated(context)) {
      return this;
    }
    // Mixins should NOT pre-evaluate their rules during initial registration.
    // Rules inside mixins should only be pre-evaluated when the mixin is called.
    // So we only handle the name (if interpolated) and mark as preEvaluated,
    // but do NOT call super.preEval() which would pre-evaluate children.
    /** @removal-target — node-copy-reduction: maybeClone → return this.
     * Name interpolation result should go through position.setField. */
    let node = this.maybeClone(context);
    node._setPreEvaluated(true, context);
    node.sourceNode ??= this;

    const name = node._getName(context);
    let rules = node._getRulesContainer(context);
    if (context.session) {
      const isolatedRules = rules.cloneDetachedUnlockWrapper(context);
      isolatedRules.options = {
        ...isolatedRules.options,
        rulesVisibility: { ...(isolatedRules.options.rulesVisibility ?? {}) }
      };
      setField(node, 'rules', isolatedRules, context);
      rules = isolatedRules;
    }
    if (context.leakyRules) {
      rules.options.rulesVisibility.Mixin = 'public';
      // Keep Less mixin-definition vars as fallback by default. Call-time scope
      // controls for params/local vars are handled in mixin evaluation paths.
      rules.options.rulesVisibility.VarDeclaration = 'optional';
    } else {
      rules.options.rulesVisibility.Mixin = 'private';
      rules.options.rulesVisibility.VarDeclaration = 'private';
    }
    if (name && name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return (maybeKey as Promise<Any<'name'>>).then((key) => {
          setField(node, 'name', key, context);
          return node;
        });
      }
      setField(node, 'name', maybeKey as Any<'name'>, context);
    }
    return node;
  }

  /** Since this is a mixin definition, it's not evaluated until it's called. */
  override evalNode() {
    return this;
  }

  // override async evalNode(context: Context): Promise<Rules | Expression> {
  //   let { name, body, params, guard } = this.data
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
