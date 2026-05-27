import {
  Node,
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
import type { Call } from './call.js';
import {
  OutputWriter,
  type PrintOptions,
  getPrintOptions,
  prepareRenderPrintState,
  savePrintState,
  restorePrintState
} from './util/print.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import { emitCommentTriviaAfterNode } from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';

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

type DeclarationEvalState = {
  source: Declaration;
  output: Node;
  name?: DeclarationValue['name'];
  value?: Node;
  important?: Any<'flag'>;
  nil: boolean;
};

type DeclarationValueState = {
  value: Node;
  important?: Any<'flag'>;
  changed: boolean;
};

const shouldResolveCustomPropertyValue = (node: Node): boolean => {
  if (isNode(node, N.Reference)) {
    return node.options?.type !== 'function';
  }
  if (node.type === 'Interpolated') {
    return true;
  }
  for (const child of node.children(true)) {
    if (isNode(child) && shouldResolveCustomPropertyValue(child)) {
      return true;
    }
  }
  return false;
};

const unwrapAtomicCustomValue = (node: Node): Node => {
  if ((isNode(node, N.Sequence) || isNode(node, N.List)) && node.value.length === 1) {
    return unwrapAtomicCustomValue(node.value[0]!);
  }
  return node;
};

type LessFunctionFallbackCall = Call & {
  value: Call['value'] & {
    name: Reference;
  };
};

const isLessFunctionFallbackCall = (node: Node): node is LessFunctionFallbackCall => (
  isNode(node, N.Call)
  && isNode(node.value.name, N.Reference)
  && node.value.name.options?.type === 'function'
  && node.value.name.options?.fallbackValue === true
);

const stringifyDetached = (node: Node, options: PrintOptions): string => {
  const printOptions = getPrintOptions(options);
  return node.toString({
    ...printOptions,
    writer: new OutputWriter()
  });
};

const stringifyCustomFallbackFunctionCall = (node: Node, options: PrintOptions): string | undefined => {
  const atomicValue = unwrapAtomicCustomValue(node);
  if (!isLessFunctionFallbackCall(atomicValue)) {
    return undefined;
  }

  const { name, args } = atomicValue.value;
  const printableKey = name.value.rawKey ?? name.value.key;
  const nameText = typeof printableKey === 'string' || typeof printableKey === 'number'
    ? String(printableKey)
    : Array.isArray(printableKey)
      ? printableKey.map(part => String(part)).join('')
      : stringifyDetached(printableKey, options).trim();
  const argTexts = (args?.value ?? [])
    .filter(Boolean)
    .map(arg => stringifyDetached(arg, options).trim());

  return `${nameText}(${argTexts.join(', ')})`;
};

/**
 * A continuous collection of nodes.
 *
 * Initially, the name can be a Node or string.
 * Once evaluated, name must be a string
 */
export class Declaration<Opts extends DeclarationOptions = DeclarationOptions> extends Node<DeclarationValue, Opts> {
  override allowRuleRoot = true;

  private copyNameForDerived(node: DeclarationValue['name']): DeclarationValue['name'] {
    if (canReuseLeaf(node)) {
      return reuseLeaf(node);
    }
    const copy = copyWithReusableLeaves(node);
    if (!(copy instanceof Any) && !(copy instanceof Interpolated)) {
      throw new TypeError('Copied declaration name must remain a declaration name');
    }
    copy.frozen = true;
    return copy;
  }

  private copyValueForDerived(node: Node): Node {
    return canReuseLeaf(node) ? reuseLeaf(node) : copyWithReusableLeaves(node);
  }

  private copyImportantForDerived(node: Any<'flag'> | undefined): Any<'flag'> | undefined {
    if (!node) {
      return undefined;
    }
    if (canReuseLeaf(node)) {
      return reuseLeaf(node);
    }
    const copy = copyWithReusableLeaves(node);
    if (!(copy instanceof Any)) {
      throw new TypeError('Copied important flag must remain an Any node');
    }
    copy.frozen = true;
    return copy;
  }

  private withParts(value: DeclarationValue): this {
    const node: this = Reflect.construct(
      this.constructor,
      [
        value,
        this._options ? { ...this._options } : undefined,
        this.location,
        this.treeContext
      ]
    );
    return node.inherit(this);
  }

  private derive(): this {
    return this.withParts({
      name: this.copyNameForDerived(this.value.name),
      value: this.copyValueForDerived(this.value.value),
      important: this.copyImportantForDerived(this.value.important)
    });
  }

  deriveWithOptions(options: Opts & DeclarationOptions): this {
    const node = this.derive();
    node.options = options;
    return node;
  }

  private formatNonCustomValue(valOut: string, _options: PrintOptions) {
    const trimmedEnd = valOut.replace(/\s+$/g, '');
    if (!trimmedEnd.includes('\n')) {
      return ` ${trimmedEnd.replace(/^[ \t]+/g, '')}`;
    }

    // Authored multiline declaration values keep their line breaks. We normalize
    // only the minimum continuation indent rather than emulating historical
    // Less fixture cases that collapsed some unindented continuations.
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
    const { assign = ':', normalizedFromAssign, setDefined } = this._options ?? {};
    const mark = w.mark();
    // setDefined uses `:=` (with default spacing rules) instead of the historical `$^` prefix.
    const printedAssign = normalizedFromAssign ? AssignmentType.Default : assign;
    const effAssign = (setDefined && printedAssign === ':') ? ':=' : printedAssign;
    let a = effAssign === ':' ? ':' : ` ${effAssign}`;
    // Normalize property name by trimming trailing whitespace
    const nameMark = w.mark();
    name.toTrimmedString(options);
    w.trimEndSince(nameMark);
    emitCommentTriviaAfterNode(name, options);
    w.add(a);
    // Custom properties must preserve value text exactly as provided.
    const isCustomProperty = name.valueOf().startsWith('--');
    if (isCustomProperty) {
      const saved = savePrintState(options, ['inCustom']);
      options.inCustom = true;
      // Preserve custom value text, but normalize boundary artifacts:
      // - if capture ended with a line break before declaration termination,
      //   drop that trailing line break so semicolon insertion stays inline.
      const valueMark = w.mark();
      value.toString(options);
      w.replaceSince(valueMark, (valueOut) => {
        const fallbackOut = stringifyCustomFallbackFunctionCall(value, options);
        const customOut = fallbackOut === undefined
          ? valueOut
          : `${valueOut.match(/^[ \t\r\f]*/)?.[0] ?? ''}${fallbackOut}`;
        return customOut.replace(/[ \t\r\f]*\n[ \t\r\f]*$/g, '');
      }, value);
      restorePrintState(options, saved);
    } else {
      const valueMark = w.mark();
      value.toTrimmedString(options);
      w.replaceSince(valueMark, valOut => this.formatNonCustomValue(valOut, options), value);
      if (!isNode(value, N.Collection)) {
        if (important) {
          w.add(' ');
          const importantMark = w.mark();
          important.toString(options);
          w.trimStartSince(importantMark);
          w.trimEndSince(importantMark);
        }
      }
    }
    if (this.requiredSemi) {
      emitCommentTriviaAfterNode(important ?? value, options);
    }
    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions) {
    return this.declTrimmedString(options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return pipe(
      () => this.evalPreparedState(context),
      state => this.renderEvaluatedDeclaration(context, state, bufferOrOptions, options)
    );
  }

  private renderEvaluatedDeclaration(
    context: Context,
    state: DeclarationEvalState,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string | MaybePromise<string> {
    const node = state.output;
    if (isNode(node, N.VarDeclaration)) {
      return isRenderBuffer(bufferOrOptions)
        ? Node.prototype.render.call(node, context, bufferOrOptions, options)
        : Node.prototype.render.call(node, context, bufferOrOptions);
    }
    if (!(node instanceof Declaration)) {
      return isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
    }
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const prepared = buffer
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const out = node.declTrimmedString(prepared);
    return buffer
      ? writeRenderText(buffer, out)
      : out;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.evalPreparedState(context),
      state => state.output
    );
  }

  private evalPreparedState(context: Context): MaybePromise<DeclarationEvalState> {
    return pipe(
      () => this.evalPrepared(context),
      output => ({
        source: this,
        output,
        name: output instanceof Declaration ? output.value.name : undefined,
        value: output instanceof Declaration ? output.value.value : undefined,
        important: output instanceof Declaration ? output.value.important : undefined,
        nil: output instanceof Nil
      })
    );
  }

  private evalPrepared(context: Context): MaybePromise<Node> {
    return pipe(
      () => this.prepareRegistration(context),
      node => node.evalNode(context)
    );
  }

  override prepareRegistration(context: Context): MaybePromise<this> {
    /** We need a derived declaration, because registration prep mutates name/value/options. */
    let node = this.derive();
    node.registrationPrepared = true;
    // Index should already be assigned by parent Rules
    return this._prepareDeclarationRegistration(node, context);
  }

  private _prepareDeclarationRegistration(node: this, context: Context): MaybePromise<this> {
    const preparedName = this._prepareDeclarationNameIdentity(node, context);
    if (isThenable(preparedName)) {
      return preparedName.then(key => this._finishDeclarationRegistrationPrep(node, key, context));
    }
    return this._finishDeclarationRegistrationPrep(node, preparedName, context);
  }

  private _prepareDeclarationNameIdentity(node: this, context: Context): MaybePromise<Any<'property'>> {
    const { name } = node.value;
    if (name instanceof Interpolated) {
      const maybeKey = name.eval(context);
      if (isThenable(maybeKey)) {
        return maybeKey.then((key) => {
          node.adopt(key);
          node.value.name = key;
          return key;
        });
      }
      node.adopt(maybeKey);
      node.value.name = maybeKey;
      return maybeKey;
    }
    return name;
  }

  private _finishDeclarationRegistrationPrep(node: this, name: Any<'property'>, _context: Context): MaybePromise<this> {
    this._normalizeAssignmentValue(node, name);
    return node;
  }

  private _normalizeAssignmentValue(node: this, key: Any<'property'>): void {
    let { value } = node.value;
    const setValue = (newValue: Node) => {
      node.adopt(newValue);
      node.value.value = newValue;
      value = newValue;
    };
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
  }

  override evalNode(context: Context): MaybePromise<this | Nil> {
    if (this.hasFlag(F_STATIC)) {
      this.evaluated = true;
      return this;
    }
    return pipe(
      () => {
        let node = this;
        const state: DeclarationValueState = {
          value: node.value.value,
          important: node.value.important,
          changed: false
        };
        const setVal = (newValue: Node) => {
          if (state.value !== newValue) {
            state.value = newValue;
            state.changed = true;
          }
        };
        const setImportant = (important: Any<'flag'>) => {
          if (state.important !== important) {
            state.important = important;
            state.changed = true;
          }
        };
        const outputDeclaration = (): this => {
          if (!state.changed) {
            return node;
          }
          const output = node.withParts({
            name: this.copyNameForDerived(node.value.name),
            value: state.value === node.value.value
              ? this.copyValueForDerived(state.value)
              : state.value,
            important: state.important === node.value.important
              ? this.copyImportantForDerived(state.important)
              : state.important
          });
          output.registrationPrepared = node.registrationPrepared;
          return output;
        };
        const normalizeMergedLeadingPlaceholder = () => {
          const normalizedAssign = node.options.normalizedFromAssign;
          const isListMergedAssign =
            normalizedAssign === AssignmentType.Add
            || normalizedAssign === AssignmentType.MergeList;
          if (!isListMergedAssign || !isNode(state.value, N.List)) {
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
          collect(state.value);
          if (mergedItems.length === 0) {
            setVal(new Nil());
            return;
          }
          if (mergedItems.length === 1) {
            const item = mergedItems[0]!;
            setVal(canReuseLeaf(item) ? reuseLeaf(item) : copyWithReusableLeaves(item));
            return;
          }
          setVal(new List(mergedItems.map(item => (
            canReuseLeaf(item) ? reuseLeaf(item) : copyWithReusableLeaves(item)
          ))));
        };
        /** Registration prep already stabilized the name; eval handles the value. */
        if (node.type === 'VarDeclaration') {
          return node;
        }
        const { name, value } = node.value;
        if (value instanceof Node) {
          const isCustomProperty = name.valueOf().startsWith('--');
          if (isCustomProperty) {
            if (!shouldResolveCustomPropertyValue(value)) {
              return outputDeclaration();
            }
            context.inCustom = true;
          }
          const maybeNewValue = value.eval(context);
          if (isThenable(maybeNewValue)) {
            return maybeNewValue.then((newValue: Node | Nil) => {
              context.inCustom = false;
              if (newValue instanceof Nil) {
                return newValue.inherit(node);
              }
              setVal(newValue);
              normalizeMergedLeadingPlaceholder();
              if (context.hasImportantSource && !state.important) {
                setImportant(any('!important', { role: 'flag' }));
              }
              if (context.hasImportantSource) {
                context.popImportantSource();
              }
              return outputDeclaration();
            });
          }
          context.inCustom = false;
          if (maybeNewValue instanceof Nil) {
            return maybeNewValue.inherit(node);
          }
          if (!(maybeNewValue instanceof Node)) {
            return node;
          }
          setVal(maybeNewValue);
          normalizeMergedLeadingPlaceholder();
          if (context.hasImportantSource && !state.important) {
            setImportant(any('!important', { role: 'flag' }));
          }
          if (context.hasImportantSource) {
            context.popImportantSource();
          }
        }
        return outputDeclaration();
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
  //   const loc = this.location
  //   out.add('$J.decl({\n', loc)
  //   context.indent++
  //   out.add(`  name: `)
  //   this.name.toModule(context, out)
  //   out.add(`,\n  value: `)
  //   this.value.toModule(context, out)
  //   if (this.important) {
  //     out.add(`,\n  important: `)
  //     this.important.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n})`)
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
