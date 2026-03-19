import {
  Node,
  F_STATIC,
  defineType,
  type LocationInfo,
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
import { spaced } from './sequence.js';
import { Operation } from './operation.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';

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
export interface Declaration {
  type: 'Declaration' | 'VarDeclaration';
  shortType: 'decl' | 'vardecl';
}

export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue, Opts> {
  static override childKeys = ['name', 'value', 'important'] as const;

  name!: NameValue;
  value!: Node;
  important: Any<'flag'> | undefined;

  constructor(value: DeclarationValue, options?: Opts, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.name = value.name;
    this.value = value.value;
    this.important = value.important;
    if (this.name instanceof Node) {
      this.adopt(this.name);
    }
    if (this.value instanceof Node) {
      this.adopt(this.value);
    }
    if (this.important instanceof Node) {
      this.adopt(this.important);
    }
    this.allowRuleRoot = true;
  }

  /** If the value has curly braces, a semi-colon is not required */
  override get requiredSemi() {
    return !isNode(this.value, N.Collection) && !isNode(this.value, N.Mixin);
  }

  protected declTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name, value, important } = this;
    const { assign = ':', setDefined } = this.options;
    const mark = w.mark();
    // setDefined uses `:=` (with default spacing rules) instead of the historical `$^` prefix.
    const effAssign = (setDefined && assign === ':') ? ':=' : assign;
    let a = effAssign === ':' ? ':' : ` ${effAssign}`;
    // Serialize the property name so attached comments survive, then trim only
    // trailing whitespace before the assignment token.
    const normalizedName = w.capture(() => name.toString(options)).replace(/\s+$/, '');
    w.add(`${normalizedName}${a}`, name);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = name.valueOf().startsWith('--');
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
    /** We need to clone declarations, because we alter their options */
    let node = this.maybeClone(context);
    node._setPreEvaluated(true, context);
    // Index should already be assigned by parent Rules
    return this._applyAssignmentNormalization(node, context);
  }

  private _applyAssignmentNormalization(node: this, context: Context): MaybePromise<this> {
    let { name, value } = node;

    const applyAssignmentNormalization = (key: Any<'property'>) => {
      /** Normalize assignment types */
      let assign = node.options?.assign;
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
            node.value = value;
            break;
          }
          case AssignmentType.Add: {
            if (node.type === 'Declaration') {
              // Less property `+:` appends comma-separated items.
              // Use list composition (not generic `Operation +`) so scalar previous values
              // remain distinct list members rather than string-concatenating.
              node.value = new List([
                new Reference({ key }, {
                  type,
                  fallbackValue: new Nil(),
                  resolution: 'linear',
                  // Prevent self-referential reads while normalizing this node.
                  filter: n => n !== node
                }),
                value
              ]);
            } else {
              node.value = new Operation([
                new Reference({ key }, { type }),
                '+',
                value
              ]);
            }
            break;
          }
          case AssignmentType.CondAssign: {
            node.value = new Reference({ key }, {
              type,
              fallbackValue: value
            });
            break;
          }
        }
        node.options.normalizedFromAssign = normalizedAssign;
        node.options.assign = AssignmentType.Default;
      }
      const out = node.value.preEval(context);
      if (isThenable(out)) {
        return out.then((value) => {
          node.value = value;
          return node;
        });
      }
      node.value = out;
      return node;
    };

    if (name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          node.name = key;
          return applyAssignmentNormalization(key);
        });
      }
      const key = maybeKey as Any<'property'>;
      node.name = key;
      return applyAssignmentNormalization(key);
    }
    return applyAssignmentNormalization(name);
  }

  override evalNode(context: Context): MaybePromise<this | Nil> {
    if (this.hasFlag(F_STATIC)) {
      this.evaluated = true;
      return this;
    }
    return pipe(
      () => {
        let node = this;
        const normalizeMergedLeadingPlaceholder = () => {
          const normalizedAssign = node.options.normalizedFromAssign;
          const isListMergedAssign =
            normalizedAssign === AssignmentType.Add
            || normalizedAssign === AssignmentType.MergeList;
          if (!isListMergedAssign || !isNode(node.value, N.List)) {
            return;
          }
          const listValue = node.value.value;
          if (listValue.length === 0) {
            return;
          }
          const first = listValue[0]!;
          const isEmptyPlaceholder = (
            isNode(first, N.Nil)
            || (isNode(first, N.List) && first.value.length === 0)
            || String(first.valueOf?.() ?? '') === ''
          );
          if (!isEmptyPlaceholder) {
            return;
          }
          const rest = listValue.slice(1);
          if (rest.length === 0) {
            node.value = new Nil();
            return;
          }
          if (rest.length === 1) {
            node.value = rest[0]!.copy(true);
            return;
          }
          node.value = new List(rest.map(item => item.copy(true)));
        };
        /** Pre-eval already evaluated the name, just need to do value (if not a var declaration) */
        if (node.type === 'VarDeclaration') {
          return node;
        }
        const { name, value } = node;
        if (value instanceof Node) {
          const isCustomProperty = name.valueOf().startsWith('--');
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
              node.value = newValue;
              normalizeMergedLeadingPlaceholder();
              // Merge !important from referenced declarations
              if (context.hasImportantSource && !node.important) {
                node.important = Any.create('!important', { role: 'flag' }) as Any<'flag'>;
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
          node.value = maybeNewValue as Node;
          normalizeMergedLeadingPlaceholder();
          // Merge !important from referenced declarations
          if (context.hasImportantSource && !node.important) {
            node.important = Any.create('!important', { role: 'flag' }) as Any<'flag'>;
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
  location?: LocationInfo,
  treeContext?: TreeContext
) => {
  let { name } = value;
  value.name = typeof name === 'string' ? new Any(name, { role: 'property' }) : name;
  return new Declaration(value as DeclarationValue, options, location, treeContext);
};
