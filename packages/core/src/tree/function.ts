import { type Context } from '../context.js';
import { defineType, F_VISIBLE, Node, type LocationInfo } from './node.js';
import type { Any, AnyRole } from './any.js';
import { Interpolated } from './interpolated.js';
import { Rules } from './rules.js';
import { type List, list } from './list.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { callableRulesEntry } from './util/callable-entry.js';
import { MixinCollection } from './util/callable-collection.js';
import { findPropertyDeclarationOccurrence } from './util/direct-rules-lookup.js';

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
  body: Rules;
};

export type FuncOptions = {
  /**
   * Declaration name to look up after evaluating the body.
   * Defaults to `'return'` (a `return: <expr>;` declaration).
   */
  returnName?: string;
};

export class Func extends Node<FuncValue, FuncOptions> {
  constructor(value: FuncValue, options?: FuncOptions, location?: LocationInfo) {
    super(value, options, location);
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

    body.toBraced(options);

    return w.getSince(mark);
  }

  override resolve(_context: Context): this {
    return this;
  }

  /**
   * Execute the function and return its looked-up value.
   *
   * We intentionally reuse the mixin-call machinery for argument binding & scoped evaluation
   * to avoid duplicating complex param matching logic.
   */
  async evalCall(context: Context, args: List<Node> = list([])): Promise<Node> {
    const returnName = this._options?.returnName ?? 'return';

    const bodyRules = this.value.body;

    const coll = new MixinCollection([
      callableRulesEntry(
        { rules: bodyRules, params: this.value.params },
        this.parent,
        this.index
      )
    ]);
    const evaluated = await coll.evalCall(context, args);

    if (!(evaluated instanceof Rules)) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} must evaluate to rules`);
    }

    const decl = findPropertyDeclarationOccurrence(evaluated, returnName, { searchParents: false })?.node;
    if (!decl) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} must return a value (missing "${returnName}: ...")`);
    }
    // Return the declaration's value (already in the correct scope).
    return await decl.value.value.eval(context);
  }
}

export const fn = defineType(Func, 'Func', 'fn') as (
  value: FuncValue | { name?: string; params?: List<Node>; body: Rules },
  options?: FuncOptions,
  location?: LocationInfo
) => Func;
