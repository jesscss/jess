import { Node, F_MAY_ASYNC, F_VISIBLE, F_NON_STATIC, defineType } from './node.js';
import { Any, type AnyRole, type AnyOptions } from './any.js';
import type { Context } from '../context.js';
import { BasicSelector } from './selector-basic.js';
import { CompoundSelector } from './selector-compound.js';
import type { Selector } from './selector.js';
import type { Reference } from './reference.js';
import { PseudoSelector } from './selector-pseudo.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
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
    const arg = (replacement as unknown as { value: Node }).value;
    return isNode(arg, N.SelectorList) || isNode(arg, N.ComplexSelector);
  }
  const str = String(replacement.valueOf?.() ?? replacement);
  return str.includes(',');
}

function getIsWrapperArg(replacement: Node): Node {
  if (replacement.type === 'SelectorCapture') {
    return (replacement as unknown as { value: Node }).value;
  }
  return replacement;
}

function serializeGeneratedIsWrapper(replacement: Node): string {
  const arg = getIsWrapperArg(replacement);
  const pseudo = PseudoSelector.create({ name: ':is', arg });
  pseudo.generated = true;
  return pseudo.toTrimmedString().replace(/\n\s*/g, ' ');
}

export type InterpolatedValue = {
  /** String with INTERPOLATION_PLACEHOLDER placeholders */
  source: string;
  replacements: Node[];
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
> extends Node<InterpolatedValue, AnyOptions<Role>> {
  type: 'Interpolated';
  shortType: 'interpolated';
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
> extends Node<InterpolatedValue, AnyOptions<Role>> {
  static override childKeys = ['source', 'replacements'] as const;

  source!: string;
  replacements!: Node[];

  constructor(value: InterpolatedValue, options?: AnyOptions<Role>, location?: any, treeContext?: any) {
    super(value as any, options, location, treeContext);
    this.source = value.source;
    this.replacements = value.replacements;
    for (const r of this.replacements) {
      if (r instanceof Node) {
        this.adopt(r);
      }
    }
    // Interpolated nodes are always non-static and may be async
    this.addFlags(F_VISIBLE, F_MAY_ASYNC, F_NON_STATIC);
  }

  override valueOf(): string {
    return this.source;
  }

  replace(replacements: Node[], options?: PrintOptions): string {
    let { source } = this;
    let output = source;
    let i = 0;
    let printOpts = getPrintOptions(options);
    let w = printOpts!.writer;
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
        if (isNode(replacement, N.Reference)) {
          // Preserve exact interpolation reference syntax (including quoted property keys).
          result = w.capture(() => replacement.toTrimmedString(printOpts));
        } else if (isNode(replacement, N.Quoted)) {
          // Interpolated string slots merge raw string content.
          // Using valueOf() avoids re-emitting inner quote delimiters.
          result = String(replacement.valueOf());
        } else {
          result = w.capture(() => replacement!.toTrimmedString(printOpts));
        }
        if (!isNode(replacement, N.Reference)) {
          result = result.trim();
        }
      }
      return result;
    });

    return output;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const result = this.replace(this.replacements, options);
    w.add(result, this);
    return w.getSince(mark);
  }

  /**
   * Can turn simple #id, .class, element or SelectorCapture into a selector.
   * Legacy "list of mixin references" (e.g. @var: .a, .b, .c) is not supported; use *[.a, .b, .c].
   */
  createSelector() {
    let { source, replacements } = this;
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
        return replacement.clone(false).inherit(this) as Selector;
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
    any.role = this.options.role;
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

  /**
   * Just evaluate replacements and return. We don't stringify yet,
   * because depending on the context, it will turn into different
   * node types.
   */
  _evalToInterpolated(context: Context): MaybePromise<this> {
    let node = this;
    let { replacements } = node;
    const markEvaluated = (result: Node): Node => {
      result.evaluated = true;
      return result;
    };

    let maybe = serialForEach(replacements, (n, idx) => {
      const out = n.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((result) => {
          replacements[idx] = markEvaluated(result);
        });
      }
      replacements[idx] = markEvaluated(out as Node);
      return undefined;
    });
    if (isThenable(maybe)) {
      return maybe.then(() => node);
    }
    return node;
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated');
