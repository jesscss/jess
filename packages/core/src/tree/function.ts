import { type Context } from '../context.js';
import { defineType, F_VISIBLE, Node, type LocationInfo, type TreeContext } from './node.js';
import type { Any, AnyRole } from './any.js';
import { Interpolated } from './interpolated.js';
import { Rules } from './rules.js';
import { type List, list } from './list.js';
import type { Declaration } from './declaration.js';
import { Mixin } from './mixin.js';
import { getFunctionFromMixins } from './rules.js';
import { cast } from './util/cast.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

/**
 * Stylesheet-defined function with a return value.
 * Called `Func` to avoid conflict with the built-in `Function` class.
 *
 * Parsed by Sass/Jess-like languages (e.g. SCSS `@function`).
 *
 * Evaluation model:
 * - Evaluate the function body in an isolated scope (like mixins) with bound params.
 * - Then look up a declaration by name (default: `return`) and return its value.
 */
export type FuncValue<Name extends AnyRole = 'name'> = {
  name?: Any<Name> | Interpolated<Name>;
  params?: List<Node>;
  body: Node;
};

export type FuncOptions = {
  /**
   * Declaration name to look up after evaluating the body.
   * Defaults to `'return'` (a `return: <expr>;` declaration).
   */
  returnName?: string;
};

export interface Func {
  type: 'Func';
  shortType: 'fn';
}

export class Func extends Node<FuncValue, FuncOptions> {
  constructor(value: FuncValue, options?: FuncOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    // Like mixins/functions in source languages: not emitted directly.
    this.removeFlag(F_VISIBLE);
  }

  get nameKey(): string | undefined {
    const { name } = this.value;
    if (!name) {
      return undefined;
    }
    return String(name.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { name, params, body } = this.value;

    w.add('$function', this);
    w.add(' ');
    w.add(name ? `${name}` : '@', this);
    w.add('(');
    if (params) {
      params.toString(options);
    }
    w.add(') ');

    // Body is always emitted as braced rules. If it's not a Rules node already, wrap it.
    const bodyRules = body instanceof Rules ? body : Rules.create([body]);
    bodyRules.toBraced(options);

    return w.getSince(mark);
  }

  /**
   * Execute the function and return its looked-up value.
   *
   * We intentionally reuse the mixin-call machinery for argument binding & scoped evaluation
   * to avoid duplicating complex param matching logic.
   */
  async evalCall(context: Context, args: List<Node> = list([])): Promise<Node> {
    const returnName = this.options?.returnName ?? 'return';

    // Normalize body to a Rules node so it can be evaluated/scoped consistently.
    const bodyNode = this.value.body;
    const bodyRules = bodyNode instanceof Rules
      ? bodyNode
      : Rules.create([bodyNode]);

    // Build a temporary anonymous mixin wrapper to observe the same param binding rules.
    const mixinLike = new Mixin(
      { rules: bodyRules, params: this.value.params },
      undefined,
      Array.isArray(this.location) && this.location.length === 6 ? (this.location as LocationInfo) : undefined,
      this.treeContext
    );
    // Ensure it participates in the same parent chain as this function definition.
    if (this.parent) {
      this.parent.adopt(mixinLike);
    }

    const fn = getFunctionFromMixins(mixinLike);
    const evaluated = await fn.call(context, ...args.value.map(a => cast(a)));

    if (!(evaluated instanceof Rules)) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} must evaluate to rules`);
    }

    const decl = evaluated.find('declaration', returnName, 'Declaration', { searchParents: false }) as Declaration | undefined;
    if (!decl) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} must return a value (missing "${returnName}: ...")`);
    }
    // Return the declaration's value (already in the correct scope).
    return await decl.value.value.eval(context);
  }
}

export const fn = defineType(Func, 'Func', 'fn') as (
  value: FuncValue | { name?: string; params?: List<Node>; body: Node },
  options?: FuncOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => Func;