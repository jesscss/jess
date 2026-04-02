import { type Context } from '../context.js';
import { defineType, F_VISIBLE, Node, type LocationInfo, type OptionalLocation, type TreeContext } from './node.js';
import type { Any, AnyRole } from './any.js';
import { Any as AnyCtor } from './any.js';
import { Interpolated } from './interpolated.js';
import { Rules } from './rules.js';
import { type List, list } from './list.js';
import type { Declaration } from './declaration.js';
import type { VarDeclaration } from './declaration-var.js';
import { VarDeclaration as VarDeclarationCtor } from './declaration-var.js';
import { Nil } from './nil.js';
import { N } from './node-type.js';
import { isNode } from './util/is-node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { getParent, getSourceParent, setChildren } from './util/field-helpers.js';

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

export type FuncChildData = {
  name: FuncValue['name'];
  params: FuncValue['params'];
  body: Node;
};

export interface Func extends Node<FuncValue, FuncOptions, FuncChildData> {
  type: 'Func';
  shortType: 'fn';
}

export class Func extends Node<FuncValue, FuncOptions, FuncChildData> {
  static override childKeys = ['name', 'params', 'body'] as const;

  name: FuncValue['name'];
  params: FuncValue['params'];
  body!: Node;

  constructor(value: FuncValue, options?: FuncOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.name = value.name;
    this.params = value.params;
    this.body = value.body;
    if (this.name instanceof Node) {
      this.adopt(this.name);
    }
    if (this.params instanceof Node) {
      this.adopt(this.params);
    }
    if (this.body instanceof Node) {
      this.adopt(this.body);
    }
    this.removeFlag(F_VISIBLE);
  }

  get nameKey(): string | undefined {
    return this.getNameKey();
  }

  getNameKey(context?: Context): string | undefined {
    const name = this.get('name', context);
    if (!name) {
      return undefined;
    }
    return String(name.valueOf());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    const name = this.get('name', context);
    const params = this.get('params', context);
    const body = this.get('body', context);

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
   * Functions follow the same scoped-body model as simple mixins:
   * bind args into an ephemeral param scope, evaluate one render-keyed body
   * wrapper, then read the return declaration from that evaluated scope.
   */
  async evalCall(context: Context, args: List<Node> = list([]), _contentNode?: Node): Promise<Node> {
    const returnName = this.options?.returnName ?? 'return';
    const name = this.get('name', context);
    const params = this.get('params', context);
    const bodyNode = this.get('body', context);
    const renderKey = context.nextRenderKey();
    const invocationParent = context.caller
      ? getParent(context.caller, context) ?? context.rulesContext
      : context.rulesContext ?? getParent(this, context);
    const callerSourceNode = context.caller && isNode(context.caller, N.Call) && context.caller.get('name') instanceof Node
      ? context.caller.get('name')
      : context.caller;
    const sourceParent = callerSourceNode
      ? getSourceParent(callerSourceNode as Node, context)
      : getSourceParent(this, context);
    const scope = this._createInvocationScope(params, args, renderKey, invocationParent, context);
    const bodyRules = this._createInvocationBodyRules(bodyNode, renderKey, scope ?? invocationParent, sourceParent, context);

    const previousRulesContext = context.rulesContext;
    const previousLookupScope = context.lookupScope;
    const previousRenderKey = context.renderKey;
    context.rulesContext = scope ?? bodyRules;
    context.lookupScope = scope ?? bodyRules;
    context.renderKey = renderKey;
    let evaluated: Rules;
    try {
      evaluated = await bodyRules.eval(context);
    } finally {
      context.rulesContext = previousRulesContext;
      context.lookupScope = previousLookupScope;
      context.renderKey = previousRenderKey;
    }

    if (!(evaluated instanceof Rules)) {
      throw new Error(`Function ${String(name?.valueOf() ?? '<anonymous>')} must evaluate to rules`);
    }

    const decl = evaluated.find('declaration', returnName, 'Declaration', { searchParents: false }) as Declaration | undefined
      ?? evaluated.find('declaration', returnName, 'VarDeclaration', { searchParents: false }) as VarDeclaration | undefined;
    if (!decl) {
      throw new Error(`Function ${String(name?.valueOf() ?? '<anonymous>')} must return a value (missing "${returnName}: ...")`);
    }
    context.rulesContext = scope ?? evaluated;
    context.lookupScope = scope ?? evaluated;
    context.renderKey = evaluated.renderKey;
    try {
      const returnValue = (decl as Declaration).get('value', context);
      return await returnValue.eval(context);
    } finally {
      context.rulesContext = previousRulesContext;
      context.lookupScope = previousLookupScope;
      context.renderKey = previousRenderKey;
    }
  }

  private _createInvocationScope(
    params: List<Node> | undefined,
    args: List<Node>,
    renderKey: symbol,
    parent: Node | undefined,
    context: Context
  ): Rules | undefined {
    if (!params) {
      return undefined;
    }
    const scope = Rules.create([], {
      rulesVisibility: {
        Ruleset: 'public',
        Declaration: 'public',
        VarDeclaration: 'public',
        Mixin: 'public'
      }
    });
    scope.parent = parent;

    const invocationContext = {
      ...context,
      renderKey,
      rulesContext: scope,
      lookupScope: scope
    };
    const argItems = args.get('value', context);
    const paramItems = params.get('value', context);

    for (let i = 0; i < paramItems.length; i++) {
      const param = paramItems[i]!;
      if (!isNode(param, N.VarDeclaration)) {
        continue;
      }
      const boundParam = new VarDeclarationCtor({
        name: new AnyCtor(String(param.get('name', context).valueOf()), { role: 'property' }),
        value: new Nil()
      }, { ...(param.options ?? {}), paramVar: true }, param.location, this.treeContext);
      boundParam.index = param.index ?? -(i + 1);
      scope.push(boundParam);

      const boundValue = argItems[i] ?? param.get('value', context);
      if (boundValue) {
        boundParam.setCurrentValue(boundValue, invocationContext);
      }
    }

    return scope;
  }

  private _createInvocationBodyRules(
    bodyNode: Node,
    renderKey: symbol,
    parent: Node | undefined,
    sourceParent: Node | undefined,
    context: Context
  ): Rules {
    let bodyRules: Rules;
    if (bodyNode instanceof Rules) {
      bodyRules = bodyNode.createShallowBodyWrapper(undefined, renderKey);
    } else {
      bodyRules = Rules.create([], undefined, Array.isArray(this.location) && this.location.length === 6 ? (this.location as LocationInfo) : undefined, this.treeContext);
      bodyRules.renderKey = renderKey;
      setChildren(bodyRules, [bodyNode], { ...context, renderKey }, { markDirty: false });
    }
    bodyRules.parent = parent;
    bodyRules.sourceParent = sourceParent;
    bodyRules.index = this.index;
    return bodyRules;
  }
}

export const fn = defineType(Func, 'Func', 'fn') as (
  value: FuncValue | { name?: string; params?: List<Node>; body: Node },
  options?: FuncOptions,
  location?: OptionalLocation,
  treeContext?: TreeContext
) => Func;
