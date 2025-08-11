import {
  Node,
  defineType,
  type LocationInfo
} from './node';
import { isNode } from './util/is-node';
import { Nil } from './nil';
import type { Context, TreeContext } from '../context';
import { Interpolated } from './interpolated';
import { Any, type AnyRole } from './any';
import { Reference } from './reference';
import { List } from './list';
import { spaced } from './sequence';
import { Operation } from './operation';
import { type PrintOptions, getPrintOptions } from './util/print';

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
export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue, Opts> {
  override type = 'Declaration';
  override shortType = 'decl';
  override allowRuleRoot = true;

  /** If the value has curly braces, a semi-colon is not required */
  override get requiredSemi() {
    return !isNode(this.value.value, 'Collection') && !isNode(this.value.value, 'Mixin');
  }

  protected declTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name, value, important } = this.value;
    const { assign = ':' } = this.options;
    const mark = w.mark();
    let a = assign === ':' ? ':' : ` ${assign}`;
    w.add(`${name}${a}`, this);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = `${name}`.startsWith('--');
    if (isCustomProperty) {
      // Emit value exactly as captured (no trimming, no added spaces)
      value.toString(options);
    } else {
      value.processPrePost('pre', ' ', options);
      const beforeVal = w.mark();
      const valStr = value.toTrimmedString(options);
      const emittedVal = w.getSince(beforeVal);
      if (!emittedVal && valStr) {
        w.add(valStr);
      }
      value.processPrePost('post', '', options);
      if (!isNode(value, 'Collection')) {
        if (important) w.add(`${important}`);
      }
    }
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.declTrimmedString(options);
  }

  override async preEval(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      /** We need to clone declarations, because we alter their options */
      let node = this.clone();
      node.preEvaluated = true;
      let { name, value } = node.value;
      let key: Any<'property'>;
      if (name instanceof Interpolated) {
        key = (await name.eval(context)).createGeneric() as Any<'property'>;
        node.value.name = key;
      } else {
        key = name;
      }
      /** Normalize assignment types */
      let assign = node.options?.assign;
      if (assign) {
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
              filter: (n) => {
                const assign = n.options?.assign;
                return assign === AssignmentType.MergeList
                  || assign === AssignmentType.MergeSequence;
              }
            });
            /**
             * @note - It's up to Sequence and List to handle
             *         the merging of the values, if Nil()
             *         or a nested list.
             */
            value = assign === AssignmentType.MergeList
              ? new List([ref, value])
              : spaced([ref, value]);

            node.value.value = value;
            break;
          }
          case AssignmentType.Add: {
            node.value.value =
              new Operation([
                new Reference({ key }, { type }),
                '+',
                value
              ]);
            break;
          }
          case AssignmentType.CondAssign: {
            node.value.value =
              new Reference({ key }, {
                type,
                fallbackValue: value
              });
            break;
          }
        }
        node.options.assign = AssignmentType.Default;
      }
      return node;
    }
    return this;
  }

  override async evalNode(context: Context) {
    let node = await this.preEval(context);
    let { name, value } = node.value;
    /**
     * Name may be a variable or a sequence containing a variable
     *
     * @todo - is this valid if rulesets pre-emptively evaluate names?
     */
    if (name instanceof Interpolated) {
      node.value.name = (await name.eval(context)).createGeneric() as Any<'property'>;
    }
    /** Evaluate the value */
    if (value instanceof Node) {
      let newValue = await value.eval(context);
      if (newValue instanceof Nil) {
        return newValue.inherit(node);
      } else {
        node.value.value = newValue;
      }
    }
    return node;
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   this.name.toCSS(context, out)
  //   out.add(': ')
  //   context.cast(this.value).toCSS(context, out)
  //   if (this.important) {
  //     out.add(' ')
  //     this.important.toCSS(context, out)
  //   }
  //   out.add(';')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   const loc = this.location
  //   out.add('$J.decl({\n', loc)
  //   context.indent++
  //   out.add(`  ${pre}name: `)
  //   this.name.toModule(context, out)
  //   out.add(`,\n  ${pre}value: `)
  //   this.value.toModule(context, out)
  //   if (this.important) {
  //     out.add(`,\n  ${pre}important: `)
  //     this.important.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n${pre}})`)
  // }
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
