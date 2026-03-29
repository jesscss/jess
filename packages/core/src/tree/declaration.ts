import {
  Node,
  F_STATIC,
  defineType,
  type OptionalLocation,
  type NodeOptions,
  type TreeContext
} from './node.js';
import { isNode } from './util/is-node.js';
import { Nil } from './nil.js';
import type { Context } from '../context.js';
import { Interpolated } from './interpolated.js';
import { Any, type AnyRole } from './any.js';
import { Reference } from './reference.js';
import { List } from './list.js';
import { Sequence, spaced } from './sequence.js';
import { Operation } from './operation.js';
import { N } from './node-type.js';
import { Collection } from './collection.js';
import { Rules } from './rules.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import {
  getDependency,
  getField,
  mergeDependencies,
  setField,
  setDependency
} from './util/field-helpers.js';

export const enum AssignmentType {
  Default = ':',
  Add = '+:',              // similar to += in JS, but merges lists / sequences / collections
  // Subtract = '-:',      // math subtraction, like -= in JS
  // Multiply = '*:',      // math multiplication, like *= in JS
  // Divide = '/:',        // math division, like /= in JS
  CondAssign = '?:',       // similar to ??= in JS or !default in Sass
  // CondAdd = '?+:',      // add if defined, otherwise assign
  // CondSubtract = '?-:', // subtract if defined, otherwise assign
  // CondMultiply = '?*:', // multiply if defined, otherwise assign
  // CondDivide = '?/:',   // divide if defined, otherwise assign

  /** Legacy Less flags */
  MergeList = '&,:',    // merge into a list if another prop exists with this flag
  MergeSequence = '&_:' // merge into a sequence if another prop exists with this flag
}

export type DeclarationOptions = {
  assign?: AssignmentType;
  /** Tracks that this declaration was created via assignment normalization (e.g. +:, +_:). */
  normalizedFromAssign?: AssignmentType;
  semi?: boolean;
  /**
   * This doesn't prevent shadowing; it prevents declarations like:
   *   ^$overwrite: foo;
   *
   * Written as `!$foo:` in Jess or imported from a readonly context
   */
  readonly?: boolean;
  /**
   * Instead of implicitly declaring or overriding,
   * requires a variable to previously be explicitly
   * declared within scope.
   *
   * Used by SCSS (!global) and Jess's (^$foo:)
   */
  setDefined?: boolean;

  /** Used by SCSS (!default) and Jess (?:) */
  // setIfUndefined?: boolean
  /**
   * Throw if already defined in the immediate scope
   * Will not throw if defined in a parent scope.
   *
   * Used by SCSS in the case of mixins... not Jess?
   */
  throwIfDefined?: boolean;
};
/** Should be Any<'property'> | Interpolated<'property'> */
type NameValue<T extends AnyRole = 'property'> = Any<T> | Interpolated<T>;

export type DeclarationValue<T extends AnyRole = 'property'> = {
  name: NameValue<T>;
  value: Node;
  /** The actual string representation of important, if it exists */
  important?: Any<'flag'>;
};

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export type DeclarationChildData = { name: NameValue; value: Node; important: Any<'flag'> | undefined };

export interface Declaration {
  type: 'Declaration' | 'VarDeclaration';
  shortType: 'decl' | 'vardecl';
}

export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue, Opts, DeclarationChildData> {
  static override childKeys = ['name', 'value', 'important'] as const;

  /** @internal */ _name!: NameValue;
  /** @internal */ _value!: Node;
  /** @internal */ _important: Any<'flag'> | undefined;

  constructor(value: DeclarationValue, options?: Opts, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this._name = value.name;
    this._value = value.value;
    this._important = value.important;
    if (this._name instanceof Node) {
      this.adopt(this._name);
    }
    if (this._value instanceof Node) {
      this.adopt(this._value);
    }
    if (this._important instanceof Node) {
      this.adopt(this._important);
    }
    this.allowRuleRoot = true;
  }

  /** If the value has curly braces, a semi-colon is not required */
  override get requiredSemi() {
    return this.requiresSemi();
  }

  requiresSemi(context?: Context): boolean {
    const value = this.get('value', context);
    return !isNode(value, N.Collection) && !isNode(value, N.Mixin);
  }

  isCustomProperty(context?: Context): boolean {
    return this.get('name', context).valueOf().startsWith('--');
  }

  private _getOptions(context?: Context): Opts | undefined {
    return context
      ? getField<Opts | undefined>(this, 'options', context)
      : this.options;
  }

  protected declTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const context = options.context;
    const name = this.get('name', context);
    const value = this.get('value', context);
    const important = this.get('important', context);
    const declarationOptions = this._getOptions(context);
    const { assign = ':', setDefined } = declarationOptions ?? {};
    const mark = w.mark();
    // setDefined uses `:=` (with default spacing rules) instead of the historical `$^` prefix.
    const effAssign = (setDefined && assign === ':') ? ':=' : assign;
    let a = effAssign === ':' ? ':' : ` ${effAssign}`;
    // Serialize the property name so attached comments survive, then trim only
    // trailing whitespace before the assignment token.
    const normalizedName = w.capture(() => name.toString(options)).replace(/\s+$/, '');
    w.add(`${normalizedName}${a}`, name);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = this.isCustomProperty(context);
    if (isCustomProperty) {
      options.inCustom = true;
      // Preserve custom value text, but normalize boundary artifacts:
      // - if capture ended with a line break before declaration termination,
      //   drop that trailing line break so semicolon insertion stays inline.
      // - if a block comment is directly adjacent to a token (e.g. `a/*...*/`),
      //   insert a single separator space for stable CSS output.
      let customOut = w.capture(() => value.toString(options));
      customOut = customOut.replace(/[ \t\r\f]*\n[ \t\r\f]*$/g, '');
      customOut = customOut.replace(/([^\s])\/\*/g, '$1 /*');
      w.add(customOut, value);
      options.inCustom = false;
    } else {
      // Capture value output to normalize spacing after ':'
      let valOut = '';
      try {
        valOut = w.capture(() => value.toString(options));
      } catch (error: unknown) {
        throw error;
      }
      // Remove leading / trailing whitespace
      const normalizedValue = valOut.replace(/^[ \t]+|\s+$/g, '');
      // Ensure exactly one space after ':' by adding one space
      w.add(' ');
      w.add(normalizedValue, value);
      if (!isNode(value, N.Collection)) {
        if (important) {
          let imp = w.capture(() => important.toString(options));
          imp = imp.replace(/^\s+|\s+$/g, '');

          w.add(` ${imp}`, important);
        }
      }
    }
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.declTrimmedString(options);
  }

  override preEval(context: Context): MaybePromise<this> {
    /** @removal-target — node-copy-reduction: maybeClone → return this.
     * Options changes should go through position.setField(this, 'options', ...) */
    let node = this.maybeClone(context);
    node._setPreEvaluated(true, context);
    // Index should already be assigned by parent Rules
    return this._applyAssignmentNormalization(node, context);
  }

  private _applyAssignmentNormalization(node: this, context: Context): MaybePromise<this> {
    let name = node.get('name', context);
    let value = node.get('value', context);

    const applyAssignmentNormalization = (key: Any<'property'>) => {
      /** Normalize assignment types */
      const nextOptions = {
        ...(node._getOptions(context) ?? {})
      } as Opts;
      let assign = nextOptions.assign;
      const rawAssign = assign as string | undefined;
      if (rawAssign === '+,:') {
        assign = AssignmentType.MergeList;
      } else if (rawAssign === '+_:') {
        assign = AssignmentType.MergeSequence;
      }
      if (assign) {
        const normalizedAssign = assign;
        value = value.maybeClone(context);
        /** Reference type */
        let type: 'property' | 'variable' =
          node.type === 'Declaration' ? 'property' : 'variable';
        switch (assign) {
          case AssignmentType.MergeList:
          case AssignmentType.MergeSequence: {
            const ref = new Reference({ key }, {
              type,
              fallbackValue: new Nil(),
              resolution: 'linear',
              // Assignment normalization clears `assign` to Default, so matching by
              // assignment flag prevents later merge iterations from seeing prior values.
              // Exclude only the current node to avoid self-reference.
              filter: n => n !== node
            });
            /**
             * @note - It's up to Sequence and List to handle
             *         the merging of the values, if Nil()
             *         or a nested list.
             */
            const isMergeListAssign = assign === AssignmentType.MergeList;
            value = isMergeListAssign
              ? new List([ref, value])
              : spaced([ref, value]);
            setField(node, 'value', value, context);
            break;
          }
          case AssignmentType.Add: {
            if (node.type === 'Declaration') {
              // Less property `+:` appends comma-separated items.
              // Use list composition (not generic `Operation +`) so scalar previous values
              // remain distinct list members rather than string-concatenating.
              setField(node, 'value', new List([
                new Reference({ key }, {
                  type,
                  fallbackValue: new Nil(),
                  resolution: 'linear',
                  // Prevent self-referential reads while normalizing this node.
                  filter: n => n !== node
                }),
                value
              ]), context);
            } else {
              setField(node, 'value', new Operation([
                new Reference({ key }, { type }),
                '+',
                value
              ]), context);
            }
            break;
          }
          case AssignmentType.CondAssign: {
            setField(node, 'value', new Reference({ key }, {
              type,
              fallbackValue: value
            }), context);
            break;
          }
        }
        nextOptions.normalizedFromAssign = normalizedAssign;
        nextOptions.assign = AssignmentType.Default;
        setField(node, 'options', nextOptions, context);
      }
      const out = node.get('value', context).preEval(context);
      if (isThenable(out)) {
        return out.then((value) => {
          setField(node, 'value', value, context);
          return node;
        });
      }
      setField(node, 'value', out, context);
      return node;
    };

    if (name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          setField(node, 'name', key, context);
          return applyAssignmentNormalization(key);
        });
      }
      const key = maybeKey as Any<'property'>;
      setField(node, 'name', key, context);
      return applyAssignmentNormalization(key);
    }
    return applyAssignmentNormalization(name);
  }

  override evalNode(context: Context): MaybePromise<this | Nil> {
    const currentValue = this.get('value', context);
    const staticNestedCollection =
      isNode(currentValue, N.Collection)
      || (
        isNode(currentValue, N.Sequence)
        && (currentValue as Sequence).get('value').length > 0
        && isNode((currentValue as Sequence).get('value')[(currentValue as Sequence).get('value').length - 1]!, N.Collection)
      );
    if (this.hasFlag(F_STATIC) && !staticNestedCollection) {
      this._setEvaluated(true, context);
      return this;
    }
    return pipe(
      () => {
        let node = this;
        const copyDependency = (source: Node, target: Node) => {
          const dependency = getDependency(source, context);
          if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
            setDependency(target, {
              dependsOn: new Set(dependency.dependsOn),
              sourceExpr: dependency.sourceExpr
            }, context);
          }
        };
        const cloneWithDependency = (source: Node): Node => {
          const cloned = source.clone(false);
          copyDependency(source, cloned);
          return cloned;
        };
        const splitNestedPropertyValue = (valueNode: Node): { baseValue?: Node; collection: Collection } | undefined => {
          if (isNode(valueNode, N.Collection)) {
            return { collection: valueNode as Collection };
          }
          if (!isNode(valueNode, N.Sequence)) {
            return undefined;
          }
          const items = [...(valueNode as Sequence).get('value')];
          if (items.length === 0) {
            return undefined;
          }
          const last = items[items.length - 1]!;
          if (!isNode(last, N.Collection)) {
            return undefined;
          }
          if (items.length === 1) {
            return { collection: last as Collection };
          }
          const baseItems = items.slice(0, -1).map(item => item.copy(true));
          const baseValue = baseItems.length === 1
            ? baseItems[0]!
            : new Sequence(baseItems, undefined, valueNode.location, this.treeContext);
          return { baseValue, collection: last as Collection };
        };
        const cloneImportant = () => node._important?.copy(true) as Any<'flag'> | undefined;
        const makePropertyName = (prefix: string, childName: NameValue): Any<'property'> =>
          new Any(
            `${prefix}-${String(childName.valueOf())}`,
            { role: 'property' },
            childName.location ?? node.location,
            this.treeContext
          );
        const expandNestedPropertyDeclaration = (declNode: Declaration): MaybePromise<Declaration | Rules | Nil> => {
          const nested = splitNestedPropertyValue(declNode._value);
          if (!nested) {
            return declNode;
          }

          const expanded: Node[] = [];
          const declCtor = declNode.constructor as any;
          const prefix = String(declNode._name.valueOf());

          if (nested.baseValue) {
            expanded.push(new declCtor(
              {
                name: declNode._name.copy(true) as NameValue,
                value: nested.baseValue.copy(true),
                important: cloneImportant()
              },
              { ...declNode.options } as any,
              declNode.location,
              this.treeContext
            ));
          }

          const entries = nested.collection._value.filter(
            child => isNode(child, N.Declaration) && !isNode(child, N.VarDeclaration)
          ) as Declaration[];

          const processEntry = (index: number): MaybePromise<void> => {
            if (index >= entries.length) {
              return;
            }

            const current = entries[index]!;
            const preEvaluated = current.preEval(context) as Declaration | Nil | Promise<Declaration | Nil>;
            const afterPreEval = (resolvedCurrent: Declaration | Nil): MaybePromise<void> => {
              if (resolvedCurrent instanceof Nil || !isNode(resolvedCurrent, N.Declaration) || isNode(resolvedCurrent, N.VarDeclaration)) {
                return processEntry(index + 1);
              }

              const prefixedDecl = new declCtor(
                {
                  name: makePropertyName(prefix, resolvedCurrent._name as NameValue),
                  value: resolvedCurrent._value.copy(true),
                  important: (resolvedCurrent._important?.copy(true) as Any<'flag'> | undefined)
                },
                { ...resolvedCurrent.options } as any,
                resolvedCurrent.location,
                this.treeContext
              );

              const evaluated = prefixedDecl.eval(context) as Declaration | Rules | Nil | Promise<Declaration | Rules | Nil>;
              const afterEval = (resolvedPrefixed: Declaration | Rules | Nil): MaybePromise<void> => {
                if (!(resolvedPrefixed instanceof Nil)) {
                  if (isNode(resolvedPrefixed, N.Rules)) {
                    expanded.push(...(resolvedPrefixed as Rules)._value);
                  } else {
                    expanded.push(resolvedPrefixed as Declaration);
                  }
                }
                return processEntry(index + 1);
              };

              return isThenable(evaluated)
                ? (evaluated as Promise<Declaration | Rules | Nil>).then(afterEval)
                : afterEval(evaluated as Declaration | Rules | Nil);
            };

            return isThenable(preEvaluated)
              ? (preEvaluated as Promise<Declaration | Nil>).then(afterPreEval)
              : afterPreEval(preEvaluated as Declaration | Nil);
          };

          const finish = () => new Rules(expanded, undefined, declNode.location, this.treeContext);
          const processed = processEntry(0);
          return isThenable(processed)
            ? (processed as Promise<void>).then(finish)
            : finish();
        };
        const normalizeMergedLeadingPlaceholder = () => {
          const normalizedAssign = node._getOptions(context)?.normalizedFromAssign;
          const isListMergedAssign =
            normalizedAssign === AssignmentType.Add
            || normalizedAssign === AssignmentType.MergeList;
          const nodeValue = node.get('value', context);
          if (!isListMergedAssign || !isNode(nodeValue, N.List)) {
            return;
          }
          const listValue = nodeValue.get('value', context);
          if (listValue.length === 0) {
            return;
          }
          const first = listValue[0]!;
          const isEmptyPlaceholder = (
            isNode(first, N.Nil)
            || (isNode(first, N.List) && first.get('value').length === 0)
            || String(first.valueOf?.() ?? '') === ''
          );
          if (!isEmptyPlaceholder) {
            return;
          }
          const rest = listValue.slice(1);
          if (rest.length === 0) {
            setField(node, 'value', new Nil(), context);
            return;
          }
          if (rest.length === 1) {
            setField(node, 'value', cloneWithDependency(rest[0]!), context);
            return;
          }
          const clonedRest = rest.map(item => cloneWithDependency(item));
          setField(node, 'value', new List(clonedRest), context);
          const dependency = mergeDependencies(clonedRest, context);
          if (dependency?.dependsOn && dependency.dependsOn.size > 0) {
            setDependency(node.get('value', context), {
              dependsOn: new Set(dependency.dependsOn),
              sourceExpr: dependency.sourceExpr
            }, context);
          }
        };
        /** Pre-eval already evaluated the name, just need to do value (if not a var declaration) */
        if (node.type === 'VarDeclaration') {
          return node;
        }
        const name = node.get('name', context);
        const value = node.get('value', context);
        if (value instanceof Node) {
          const isCustomProperty = node.isCustomProperty(context);
          if (isCustomProperty) {
            const hasInterpolation =
              value.type === 'Interpolated'
              || [...value.children(true)].some(child => child.type === 'Interpolated');
            if (!hasInterpolation) {
              return node;
            }
            context.inCustom = true;
          }
          const maybeNewValue = value.eval(context);
          if (isThenable(maybeNewValue)) {
            return (maybeNewValue as Promise<Node>).then((newValue) => {
              context.inCustom = false;
              if (newValue instanceof Nil) {
                return newValue.inherit(node);
              }
              setField(node, 'value', newValue, context);
              normalizeMergedLeadingPlaceholder();
              copyDependency(newValue, node.get('value', context));
              // Merge !important from referenced declarations
              if (context.hasImportantSource && !node.get('important', context)) {
                setField(node, 'important', Any.create('!important', { role: 'flag' }) as Any<'flag'>, context);
              }
              // Pop important source after merging (if it was set)
              if (context.hasImportantSource) {
                context.popImportantSource();
              }
              return node;
            });
          }
          context.inCustom = false;
          if (maybeNewValue instanceof Nil) {
            return (value as Nil).inherit(node);
          }
          setField(node, 'value', maybeNewValue as Node, context);
          normalizeMergedLeadingPlaceholder();
          copyDependency(maybeNewValue as Node, node.get('value', context));
          const expanded = expandNestedPropertyDeclaration(node);
          if (isThenable(expanded)) {
            return (expanded as Promise<Declaration | Rules | Nil>).then((resolvedExpanded) => {
              if (context.hasImportantSource && !node.get('important', context) && isNode(resolvedExpanded, N.Declaration)) {
                setField(resolvedExpanded as Declaration, 'important', Any.create('!important', { role: 'flag' }) as Any<'flag'>, context);
              }
              if (context.hasImportantSource) {
                context.popImportantSource();
              }
              return resolvedExpanded;
            });
          }
          if (expanded !== node) {
            if (context.hasImportantSource) {
              context.popImportantSource();
            }
            return expanded;
          }
          // Merge !important from referenced declarations
          if (context.hasImportantSource && !node.get('important', context)) {
            setField(node, 'important', Any.create('!important', { role: 'flag' }) as Any<'flag'>, context);
          }
          // Pop important source after merging (if it was set)
          if (context.hasImportantSource) {
            context.popImportantSource();
          }
        }
        return node;
      }
    ) as MaybePromise<this | Nil>;
  }
}

export type DeclarationParams = ConstructorParameters<typeof Declaration>;

defineType<DeclarationValue>(Declaration, 'Declaration', 'decl');

export const decl = (
  value: DeclarationValue<AnyRole> | { name: string; value: Node; important?: Any<'flag'> },
  options?: DeclarationOptions,
  location?: OptionalLocation,
  treeContext?: TreeContext
) => {
  let { name } = value;
  value.name = typeof name === 'string' ? new Any(name, { role: 'property' }) : name;
  return new Declaration(value as DeclarationValue, options, location, treeContext);
};
