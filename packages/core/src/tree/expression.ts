import type { Class } from 'type-fest';
import type { Context } from '../context.js';
import { Node, F_NON_STATIC, defineType, type NodeOptions, type OptionalLocation, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { getDependency, setDependency, setParent } from './util/field-helpers.js';

export type ExpressionChildData = { value: Node };

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * When parsing Less/Sass, everything containing an operation is
 * considered an expression.
 */
export interface Expression extends Node<Node, NodeOptions, ExpressionChildData> {
  type: 'Expression';
  shortType: 'expr';
  eval(context: Context): MaybePromise<Node>;
}

export class Expression extends Node<Node, NodeOptions, ExpressionChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ readonly value!: Node;

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const value = this.get('value', ctx);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const clonedValue = deep ? cloneChild(value) : value;
    const options = this._meta?.options;
    const priorParent = !deep && ctx ? clonedValue.parent : undefined;
    const newNode = new (this.constructor as Class<this>)(
      clonedValue,
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    if (!deep && ctx) {
      setParent(clonedValue, newNode, ctx);
      (clonedValue as unknown as { parent?: Node }).parent = priorParent;
    }
    newNode.inherit(this);
    return newNode;
  }

  constructor(value: Node, options?: NodeOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.value = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
    this.addFlag(F_NON_STATIC);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const value = this.get('value', context);
    const out = value.eval(context);
    const applyDependency = (result: Node): Node => {
      const dependency = getDependency(result, context);
      if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
        setDependency(result, {
          dependsOn: new Set(dependency.dependsOn),
          sourceExpr: this
        }, context);
      }
      return result;
    };
    /** @todo - Cast as selector if the context is within a selector */
    if (isThenable(out)) {
      return (out as Promise<Node>).then(applyDependency);
    }
    return applyDependency(out as Node);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const value = this.get('value', options.context);
    w.add('$', this);
    w.add('(');
    value.toString(options);
    w.add(')');
    return w.getSince(mark);
  }
}

type Params = ConstructorParameters<typeof Expression>;

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression;
