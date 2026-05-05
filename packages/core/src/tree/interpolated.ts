import { Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, defineType } from './node.js';
import { Any, type AnyRole, type AnyOptions } from './any.js';
import type { Context } from '../context.js';
import { BasicSelector } from './selector-basic.js';
import { CompoundSelector } from './selector-compound.js';
import type { Selector } from './selector.js';
import { PseudoSelector } from './selector-pseudo.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { OutputWriter, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, serialForEach, isThenable } from '@jesscss/awaitable-pipe';

// Placeholder that's very unlikely to appear in user strings
// but is also easily typeable for tests
export const INTERPOLATION_PLACEHOLDER = '%%';
const INTERPOLATION_PLACEHOLDER_REGEXP = /%%/g;

function shouldWrapSelectorInIs(replacement: Node): boolean {
  if (isNode(replacement, N.SelectorList)) {
    return true;
  }
  if (isNode(replacement, N.ComplexSelector)) {
    return true;
  }
  if (replacement.type === 'SelectorCapture') {
    const arg = replacement.value;
    return isNode(arg, N.SelectorList) || isNode(arg, N.ComplexSelector);
  }
  const str = String(replacement.valueOf?.() ?? replacement);
  return str.includes(',');
}

function getIsWrapperArg(replacement: Node): Node {
  if (replacement.type === 'SelectorCapture') {
    const value = replacement.value;
    if (value instanceof Node) {
      return value;
    }
  }
  return replacement;
}

function serializeGeneratedIsWrapper(replacement: Node): string {
  const arg = getIsWrapperArg(replacement);
  const pseudo = PseudoSelector.create({ name: ':is', arg });
  pseudo.generated = true;
  return pseudo.toTrimmedString().replace(/\n\s*/g, ' ');
}

function stringifyReplacement(replacement: Node, options: PrintOptions, preserveQuotedSyntax?: boolean): string {
  if (isNode(replacement, N.Quoted) && !preserveQuotedSyntax) {
    return String(replacement.valueOf());
  }
  const printOpts = getPrintOptions(options);
  const result = replacement.toTrimmedString({
    ...printOpts,
    writer: new OutputWriter()
  });
  return isNode(replacement, N.Reference) ? result : result.trim();
}

export type InterpolatedValue = {
  /** String with INTERPOLATION_PLACEHOLDER placeholders */
  source: string;
  replacements: Node[];
};

export type InterpolatedOptions<Role extends AnyRole = AnyRole> = AnyOptions<Role> & {
  preserveQuotedSyntax?: boolean;
};

/**
 * Merge an interface to declare the specific types
 *
 * @todo - Instead of extending simple selector, create a selector "wrapper"
 * that goes around expressions and interpolated values, so that it
 * casts as a selector after evaluation.
 *
 * This would eliminate the need for the `evalToSelector` and `evalToGeneric`
 * methods, because the wrapper would handle the returned node type.
 */
export interface Interpolated<
  Role extends AnyRole = AnyRole
> extends Node<InterpolatedValue, InterpolatedOptions<Role>> {
  eval(context: Context): MaybePromise<Any<Role>>;
}
/**
 * An interpolated value is one that contains
 * reference variables, or expressions, but
 * which MUST resolve to a node with a string value
 * (like Anonymous) when evaluated.
 *
 * @example
 *   in Less:
 *     - `@@foo` is an interpolated variable
 *     - `--prop-@{foo}` is an interpolated property
 */
export class Interpolated<
  Role extends AnyRole = AnyRole
> extends Node<InterpolatedValue, InterpolatedOptions<Role>> {
  constructor(value: InterpolatedValue, options?: InterpolatedOptions<Role>, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Interpolated nodes are always non-static and may be async
    this.addFlags(F_VISIBLE, F_MAY_ASYNC, F_NON_STATIC);
  }

  override valueOf(): string {
    return this.value.source;
  }

  replace(replacements: Node[], options?: PrintOptions): string {
    let { source } = this.value;
    let output = source;
    let i = 0;
    let printOpts = getPrintOptions(options);
    INTERPOLATION_PLACEHOLDER_REGEXP.lastIndex = 0;
    output = output.replace(INTERPOLATION_PLACEHOLDER_REGEXP, () => {
      let replacement: Node | undefined;
      try {
        replacement = replacements[i++];
      } catch (error: unknown) {
        throw error;
      }
      let result = '';
      if (replacement) {
        result = stringifyReplacement(replacement, printOpts, this.options.preserveQuotedSyntax);
      }
      return result;
    });

    return output;
  }

  private writeReplacement(replacement: Node, options: PrintOptions): void {
    const w = getPrintOptions(options).writer!;
    if (isNode(replacement, N.Quoted) && !this.options.preserveQuotedSyntax) {
      // Interpolated string slots merge raw string content.
      // Using valueOf() avoids re-emitting inner quote delimiters.
      w.add(String(replacement.valueOf()), replacement);
      return;
    }
    const mark = w.mark();
    replacement.toTrimmedString(options);
    if (!isNode(replacement, N.Reference)) {
      w.trimStartSince(mark);
      w.trimEndSince(mark);
    }
  }

  private writeInterpolated(replacements: Node[], options: PrintOptions): void {
    const w = getPrintOptions(options).writer!;
    const segments = this.value.source.split(INTERPOLATION_PLACEHOLDER);
    for (let i = 0; i < replacements.length; i++) {
      w.add(segments[i] ?? '', this);
      this.writeReplacement(replacements[i]!, options);
    }
    if (segments.length > replacements.length) {
      w.add(segments.slice(replacements.length).join(INTERPOLATION_PLACEHOLDER), this);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeInterpolated(this.value.replacements, options);
    return w.getSince(mark);
  }

  /**
   * Can turn simple #id, .class, element or SelectorCapture into a selector.
   * Legacy "list of mixin references" (e.g. @var: .a, .b, .c) is not supported; use *[.a, .b, .c].
   */
  createSelector() {
    let { source, replacements } = this.value;
    const segments = source.split(INTERPOLATION_PLACEHOLDER);
    const isWholeSelectorInterpolation = (
      replacements.length === 1
      && segments.length === 2
      && segments[0]!.trim() === ''
      && segments[1]!.trim() === ''
    );
    // For full-selector interpolation, collapse directly to the resolved selector/text.
    // Generated :is wrappers are only needed for embedded interpolation fragments.
    if (isWholeSelectorInterpolation) {
      const replacement = replacements[0]!;
      if (!replacement.evaluated) {
        throw new Error('Cannot create selector from un-evaluated interpolated node');
      }
      if (isNode(replacement, N.Selector)) {
        return replacement.copy(true).inherit(this) as Selector;
      }
      return new BasicSelector(replacement.toTrimmedString().trim()).inherit(this);
    }
    let output = '';
    for (let [i, replacement] of replacements.entries()) {
      if (!replacement.evaluated) {
        throw new Error('Cannot create selector from un-evaluated interpolated node');
      }
      let part = replacement.toTrimmedString();
      if (shouldWrapSelectorInIs(replacement)) {
        part = serializeGeneratedIsWrapper(replacement);
      }
      output += (segments[i] ?? '') + part;
    }
    // Preserve any trailing literal segment after the last interpolation placeholder.
    if (segments.length > replacements.length) {
      output += segments.slice(replacements.length).join(INTERPOLATION_PLACEHOLDER);
    }
    // Interpolated selector output can produce compound selectors (e.g. ".a#b").
    // Preserve token boundaries so keySet/registry lookup can match correctly.
    const simpleTokens = output.match(/[#.][^#.\s]+|[^#.\s]+/g) ?? [output];
    if (
      simpleTokens.length > 1
      && !output.includes(':')
      && !output.includes('[')
      && !output.includes('&')
    ) {
      return new CompoundSelector(simpleTokens.map(token => new BasicSelector(token))).inherit(this);
    }
    return new BasicSelector(output).inherit(this);
  }

  createGeneric() {
    const trimmedString = this.toTrimmedString();
    let any = new Any<Role>(trimmedString).inherit(this);
    any.options.role = this.options.role;
    return any;
  }

  /** Convenience: evaluate replacements then convert to Selector (BasicSelector or SelectorList) */
  evalToSelector(context: Context): MaybePromise<Selector> {
    const out = this._evalToInterpolated(context);
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then(node => node.createSelector());
    }
    return (out as Interpolated<Role>).createSelector();
  }

  override evalNode(context: Context): MaybePromise<Any> {
    const out = this._evalToInterpolated(context);
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then((node) => {
        return node.createGeneric();
      });
    }
    const result = (out as Interpolated<Role>).createGeneric();
    return result;
  }

  override resolve(context: Context): MaybePromise<Any> {
    const out = this._evalToInterpolated(context, 'resolve');
    if (isThenable(out)) {
      return (out as Promise<Interpolated<Role>>).then((node) => {
        return node.createGeneric();
      });
    }
    const result = (out as Interpolated<Role>).createGeneric();
    return result;
  }

  /**
   * Just evaluate replacements and return. We don't stringify yet,
   * because depending on the context, it will turn into different
   * node types.
   */
  _evalToInterpolated(context: Context, mode: 'eval' | 'resolve' = 'eval'): MaybePromise<this> {
    const node = this;
    const currentReplacements = node.value.replacements;
    const evaluatedReplacements = [...currentReplacements];
    const finalize = () => {
      const changed = evaluatedReplacements.some((replacement, idx) => replacement !== currentReplacements[idx]);
      if (!changed) {
        return node;
      }
      const next = node.clone();
      next.value.replacements = evaluatedReplacements;
      return next;
    };

    let maybe = serialForEach(evaluatedReplacements, (n, idx) => {
      const out = mode === 'eval' ? n.eval(context) : n.resolve(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          evaluatedReplacements[idx] = result;
        });
      }
      evaluatedReplacements[idx] = out as Node;
      return undefined;
    });
    if (isThenable(maybe)) {
      return maybe.then(() => finalize());
    }
    return finalize();
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated');
