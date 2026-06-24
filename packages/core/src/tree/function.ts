import { type Context } from '../context.js';
import { defineType, F_VISIBLE, Node, type LocationInfo } from './node.js';
import type { Any, AnyRole } from './any.js';
import { Interpolated } from './interpolated.js';
import { Rules } from './rules.js';
import { type List, list } from './list.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { callableRulesEntry } from './util/callable-entry.js';
import { evaluateCallableCollection } from './util/callable-eval.js';
import { findPropertyDeclarationOccurrence } from './util/direct-rules-lookup.js';

function getWriterTextSincePosition(writer: OutputWriter, position: number): string {
  const chunks = Reflect.get(writer as object, 'chunks');
  if (!Array.isArray(chunks) || position >= chunks.length) {
    return '';
  }
  let out = '';
  for (let i = position; i < chunks.length; i++) {
    out += chunks[i] ?? '';
  }
  return out;
}

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
  static override childKeys = ['name', 'params', 'body'] as const;

  readonly name: FuncValue['name'];
  readonly params: FuncValue['params'];
  readonly body: Rules;

  constructor(
    value: FuncValue,
    options?: FuncOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this.name = value.name;
    this.params = value.params;
    this.body = value.body;
    this._treeContext = treeContext;
    // Like mixins/functions in source languages: not emitted directly.
    this.removeFlag(F_VISIBLE);
  }

  get nameKey(): string | undefined {
    const { name } = this;
    if (!name) {
      return undefined;
    }
    return String(name.valueOf());
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer!;
    const { name, params, body } = this;

    w.add('$function', this);
    w.add(' ');
    if (name) {
      name.writeSyntax(options);
    } else {
      w.add('@', this);
    }
    w.add('(');
    params?.writeSyntax(options);
    w.add(') ');
    body.writeBraced(options);
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return getWriterTextSincePosition(w, position);
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

    const evaluated = await evaluateCallableCollection({
      context,
      mixinEntries: [
        callableRulesEntry(
          { rules: this.body, params: this.params },
          this.parent,
          this.index
        )
      ],
      args: args.value
    });

    if (!(evaluated instanceof Rules)) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} must evaluate to rules`);
    }

    const decl = findPropertyDeclarationOccurrence(evaluated, returnName, { searchParents: false })?.node;
    if (!decl) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} must return a value (missing "${returnName}: ...")`);
    }
    // Return the declaration's value (already in the correct scope).
    const declVal = decl.value;
    if (!(declVal instanceof Node)) {
      throw new Error(`Function ${this.nameKey ?? '<anonymous>'} return value is not a Node`);
    }
    return await declVal.eval(context);
  }
}

export const fn = defineType(Func, 'Func', 'fn') as (
  value: FuncValue | { name?: string; params?: List<Node>; body: Rules },
  options?: FuncOptions,
  location?: LocationInfo
) => Func;
