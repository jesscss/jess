import {
  Node,
  CANONICAL,
  F_STATIC,
  defineType,
  type LocationInfo
} from './node.js';
import { isNode } from './util/is-node.js';
import { Nil } from './nil.js';
import type { Context, TreeContext } from '../context.js';
import { Interpolated } from './interpolated.js';
import { Any, any, type AnyRole } from './any.js';
import { Reference } from './reference.js';
import { List } from './list.js';
import { spaced } from './sequence.js';
import { Operation } from './operation.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions, savePrintState, applyPrintState, restorePrintState } from './util/print.js';
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
export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue, Opts> {
  override allowRuleRoot = true;

  private withValue(value: Node): this {
    const node = this.clone(false) as this;
    node.value.value = value;
    return node;
  }

  private withImportant(important: Any<'flag'>): this {
    const node = this.clone(false) as this;
    node.value.important = important;
    return node;
  }

  private formatNonCustomValue(valOut: string, _options: PrintOptions) {
    const trimmedEnd = valOut.replace(/\s+$/g, '');
    if (!trimmedEnd.includes('\n')) {
      return ` ${trimmedEnd.replace(/^[ \t]+/g, '')}`;
    }

    const continuationIndent = '  ';
    const lines = trimmedEnd.split('\n');
    let out = '';
    const [firstLine = '', ...restLines] = lines;
    const firstContent = firstLine.replace(/^[ \t]+/g, '').trimEnd();

    if (firstContent) {
      out = ` ${firstContent}`;
    }

    for (const line of restLines) {
      if (!line.trim()) {
        out += '\n';
        continue;
      }

      const lineIndent = line.match(/^[ \t]*/)?.[0].length ?? 0;
      const content = line.replace(/^[ \t]+/g, '').trimEnd();
      const isClosingLine = /^[}\])]([,;])?$/.test(content);
      const normalizedIndent = ' '.repeat(
        isClosingLine ? lineIndent : Math.max(continuationIndent.length, lineIndent)
      );
      out += `\n${normalizedIndent}${content}`;
    }

    return out || `\n${continuationIndent}`;
  }

  /** If the value has curly braces, a semi-colon is not required */
  override get requiredSemi() {
    return !isNode(this.value.value, N.Collection) && !isNode(this.value.value, N.Mixin);
  }

  protected declTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const { name, value, important } = this.value;
    const { assign = ':', normalizedFromAssign, setDefined } = this.options;
    const mark = w.mark();
    // setDefined uses `:=` (with default spacing rules) instead of the historical `$^` prefix.
    const printedAssign = normalizedFromAssign ? AssignmentType.Default : assign;
    const effAssign = (setDefined && printedAssign === ':') ? ':=' : printedAssign;
    let a = effAssign === ':' ? ':' : ` ${effAssign}`;
    // Normalize property name by trimming trailing whitespace
    const normalizedName = String(name).replace(/\s+$/, '');
    w.add(`${normalizedName}${a}`, name);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = name.valueOf().startsWith('--');
    if (isCustomProperty) {
      const saved = savePrintState(options, ['inCustom']);
      applyPrintState(options, { inCustom: true });
      // Preserve custom value text, but normalize boundary artifacts:
      // - if capture ended with a line break before declaration termination,
      //   drop that trailing line break so semicolon insertion stays inline.
      // - if a block comment is directly adjacent to a token (e.g. `a/*...*/`),
      //   insert a single separator space for stable CSS output.
      let customOut = w.capture(() => value.toString(options));
      customOut = customOut.replace(/[ \t\r\f]*\n[ \t\r\f]*$/g, '');
      customOut = customOut.replace(/([^\s])\/\*/g, '$1 /*');
      w.add(customOut, value);
      restorePrintState(options, saved);
    } else {
      // Capture value output to normalize spacing after ':'
      let valOut = '';
      try {
        valOut = w.capture(() => value.toString(options));
      } catch (error: unknown) {
        throw error;
      }
      w.add(this.formatNonCustomValue(valOut, options), value);
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
    const { renderKey } = context;
    const needsCanonicalReset = renderKey !== undefined
      && this._renderKey !== undefined
      && this._renderKey !== renderKey;

    if (needsCanonicalReset) {
      this.getValue(CANONICAL);
    }

    const needsReeval = renderKey !== undefined
      && this.preEvaluated
      && (
        !this._renderKey
        || this._renderKey !== renderKey
      );

    if (needsReeval) {
      this.getValue(CANONICAL);
      this.preEvaluated = false;
      this.evaluated = false;
    }

    /** We need a derived declaration, because pre-eval normalization mutates name/value/options. */
    let node = this.clone(false) as this;
    node.preEvaluated = true;
    // Index should already be assigned by parent Rules
    return this._applyAssignmentNormalization(node, context);
  }

  private _applyAssignmentNormalization(node: this, context: Context): MaybePromise<this> {
    let { name, value } = node.value;
    const setName = (newName: Any<'property'>) => {
      node.set('name', newName);
      name = newName;
    };
    const setValue = (newValue: Node) => {
      node.set('value', newValue);
      value = newValue;
    };

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
        let type: 'declaration' | 'variable' =
          node.type === 'Declaration' ? 'declaration' : 'variable';
        switch (assign) {
          case AssignmentType.MergeList:
          case AssignmentType.MergeSequence: {
            const isLessMergeAssign = (assignValue: string): boolean => (
              assignValue === AssignmentType.MergeList
              || assignValue === AssignmentType.MergeSequence
              || assignValue === '+,:'
              || assignValue === '+_:'
            );
            const ref = new Reference({ key }, {
              type,
              fallbackValue: new Nil(),
              // Assignment normalization clears `assign` to Default, so matching by
              // assignment flag prevents later merge iterations from seeing prior values.
              // For Less-style property merges, any prior merge node participates in the chain,
              // but plain declarations do not.
              // Exclude only the current node to avoid self-reference.
              filter: n => (
                n !== node
                && isLessMergeAssign(String(n.options?.normalizedFromAssign ?? ''))
              )
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
            setValue(value);
            break;
          }
          case AssignmentType.Add: {
            if (node.type === 'Declaration') {
              // Less property `+:` appends comma-separated items.
              // Use list composition (not generic `Operation +`) so scalar previous values
              // remain distinct list members rather than string-concatenating.
              setValue(new List([
                new Reference({ key }, {
                  type,
                  fallbackValue: new Nil(),
                  // Prevent self-referential reads while normalizing this node.
                  filter: n => n !== node
                }),
                value
              ]));
            } else {
              setValue(
                new Operation([
                  new Reference({ key }, { type }),
                  '+',
                  value
                ])
              );
            }
            break;
          }
          case AssignmentType.CondAssign: {
            setValue(
              new Reference({ key }, {
                type,
                fallbackValue: value
              })
            );
            break;
          }
        }
        node.options.normalizedFromAssign = normalizedAssign;
      }
      const out = node.value.value.preEval(context);
      if (isThenable(out)) {
        return out.then((value) => {
          setValue(value);
          return node;
        });
      }
      setValue(out);
      return node;
    };

    if (name instanceof Interpolated) {
      const { renderKey } = context;
      if (renderKey !== undefined && name._renderKey !== undefined && name._renderKey !== renderKey) {
        name.getValue(CANONICAL);
      }
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          setName(key);
          return applyAssignmentNormalization(key);
        });
      }
      setName(maybeKey);
      return applyAssignmentNormalization(maybeKey);
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
        const setVal = (newValue: Node) => {
          if (node.value.value !== newValue) {
            node = node.withValue(newValue);
          }
        };
        const setImportant = (important: Any<'flag'>) => {
          if (node.value.important !== important) {
            node = node.withImportant(important);
          }
        };
        const normalizeMergedLeadingPlaceholder = () => {
          const normalizedAssign = node.options.normalizedFromAssign;
          const isListMergedAssign =
            normalizedAssign === AssignmentType.Add
            || normalizedAssign === AssignmentType.MergeList;
          if (!isListMergedAssign || !isNode(node.value.value, N.List)) {
            return;
          }
          const mergedItems: Node[] = [];
          const collect = (child: Node): void => {
            if (isNode(child, N.List)) {
              for (const item of child.value) {
                collect(item);
              }
              return;
            }
            const isEmptyPlaceholder = (
              isNode(child, N.Nil)
              || String(child.valueOf?.() ?? '') === ''
            );
            if (!isEmptyPlaceholder) {
              mergedItems.push(child);
            }
          };
          collect(node.value.value);
          if (mergedItems.length === 0) {
            setVal(new Nil());
            return;
          }
          if (mergedItems.length === 1) {
            setVal(mergedItems[0]!.copy(true));
            return;
          }
          setVal(new List(mergedItems.map(item => item.copy(true))));
        };
        /** Pre-eval already evaluated the name, just need to do value (if not a var declaration) */
        if (node.type === 'VarDeclaration') {
          return node;
        }
        const { name, value } = node.value;
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
              setVal(newValue);
              normalizeMergedLeadingPlaceholder();
              if (context.hasImportantSource && !node.value.important) {
                setImportant(any('!important', { role: 'flag' }));
              }
              if (context.hasImportantSource) {
                context.popImportantSource();
              }
              return node;
            });
          }
          context.inCustom = false;
          if (maybeNewValue instanceof Nil) {
            return maybeNewValue.inherit(node);
          }
          setVal(maybeNewValue as Node);
          normalizeMergedLeadingPlaceholder();
          if (context.hasImportantSource && !node.value.important) {
            setImportant(any('!important', { role: 'flag' }));
          }
          if (context.hasImportantSource) {
            context.popImportantSource();
          }
        }
        return node;
      }
    ) as MaybePromise<this | Nil>;
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

function isDeclarationValue(
  value: DeclarationValue | { name: string; value: Node; important?: Any<'flag'> }
): value is DeclarationValue {
  return typeof value.name !== 'string';
}

export const decl = (
  value: DeclarationValue | { name: string; value: Node; important?: Any<'flag'> },
  options?: DeclarationOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => {
  if (!isDeclarationValue(value)) {
    return new Declaration({
      name: any(value.name, { role: 'property' }),
      value: value.value,
      important: value.important
    }, options, location, treeContext);
  }
  return new Declaration(value, options, location, treeContext);
};
