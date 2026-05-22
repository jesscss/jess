import { Node, F_STATIC, defineType } from './node.js';
import { Nil } from './nil.js';
import { List } from './list.js';
import type { Context } from '../context.js';
import { compareNodeArray } from './util/compare.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import {
  renderEvalOutput,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  // spaced: boolean
  /** Used with custom properties */
  preserveWhitespace?: boolean;
};

function isIdentifierChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z_-]/u.test(value));
}

function hasNonWhitespaceTrivia(tokens: ReturnType<NonNullable<PrintOptions['trivia']>['lookup']>): boolean {
  return Boolean(tokens?.some(token => token.tokenType.name !== 'WS'));
}

/**
 * A continuous collection of nodes. Historically in Less,
 * these were termed "expressions", but in computer science,
 * an expression will yield a value, and a CSS value can
 * actually be a sequence of values (like for shorthand)
 */
export class Sequence extends Node<Node[], SequenceOptions> {
  private withValue(value: Node[]): Sequence {
    return new Sequence(
      value,
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.treeContext
    ).inherit(this);
  }

  private deriveAdditionSequence(): Sequence {
    return new Sequence(
      this.value.map(value => copyWithReusableLeaves(value)),
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.treeContext
    ).inherit(this);
  }

  private evaluateValues(context: Context, mode: 'eval' | 'resolve'): MaybePromise<Node[]> {
    const values = new Array<Node>(this.value.length);
    const maybe = serialForEach(this.value.map((n, i) => [n, i] as const), ([n, i]) => {
      const out = mode === 'eval' ? n.eval(context) : n.resolve(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((res) => {
          values[i] = res;
        });
      }
      values[i] = out as Node;
    });
    if (isThenable(maybe)) {
      return (maybe as Promise<void>).then(() => values);
    }
    return values;
  }

  private finalizeValues(values: Node[]): Node {
    const filtered = values.filter(n => n && !(n instanceof Nil));
    if (filtered.length === 1 && !this._options?.preserveWhitespace) {
      return filtered[0]!;
    }
    const unchanged = (
      filtered.length === this.value.length
      && filtered.every((node, index) => node === this.value[index])
    );
    return unchanged ? this : this.withValue(filtered);
  }

  override compare(other: Node) {
    if (other instanceof Sequence) {
      const equalityMode = this.treeContext?.equalityMode ?? 'coerce';
      const result = compareNodeArray(this.value, other.value, equalityMode);
      return result;
    }
    if (other.type === 'Any') {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      const left = normalize(this.toString());
      const right = normalize(other.toString());
      return left === right ? 0 : undefined;
    }
    return undefined;
  }

  private renderSequenceSyntax(value = this.value, options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    if (printOptions.inCustom) {
      const w = printOptions.writer!;
      const mark = w.mark();
      for (const node of value) {
        node.toString(printOptions);
      }
      return w.getSince(mark);
    }
    const w = printOptions.writer;
    const mark = w.mark();
    const length = value.length;

    if (length === 0) {
      return '';
    }

    value[0]!.toString(printOptions);

    // Serialize subsequent nodes with normalized spacing
    for (let i = 1; i < length; i++) {
      const prev = value[i - 1]!;
      const node = value[i]!;
      const prevLastChar = w.lastChar();
      const prevEndsWithSpace = prevLastChar === ' ';

      const sourceTrivia = (
        printOptions.trivia
        && prev.treeContext?.opts?.trivia === printOptions.trivia
        && node.treeContext?.opts?.trivia === printOptions.trivia
      );
      const trivia = sourceTrivia ? printOptions.trivia : undefined;
      const hasTrivia = Boolean(
        trivia
        && (
          hasNonWhitespaceTrivia(trivia.lookup(prev.location[3], 'after'))
          || hasNonWhitespaceTrivia(trivia.lookup(node.location[0], 'before'))
        )
      );
      const prevEnd = prev.location[3];
      const nodeStart = node.location[0];
      const noSep = Boolean(
        sourceTrivia
        && prevEnd !== undefined
        && nodeStart !== undefined
        && (prevEnd === nodeStart || prevEnd + 1 === nodeStart)
      );
      const needsMergeGuard = noSep && isIdentifierChar(prevLastChar);

      if (
        !prevEndsWithSpace
        && !hasTrivia
        && (!noSep || needsMergeGuard)
      ) {
        w.queueSpacer(' ', needsMergeGuard
          ? nextText => /^[A-Za-z0-9_-]/u.test(nextText)
          : undefined);
      }
      node.toString(printOptions);
    }

    return w.getSince(mark);
  }

  override toTrimmedString(options?: PrintOptions): string {
    return this.renderSequenceSyntax(this.value, options);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    return renderEvalOutput(context, this.resolveValue(context), bufferOrOptions, options);
  }

  override operate(b: Node, op: string, _context: Context): Sequence | List {
    if (op !== '+') {
      throw new Error(`Sequence operation "${op}" not supported`);
    }
    const newSequence = this.deriveAdditionSequence();
    if (b instanceof List) {
      return new List([
        newSequence,
        ...b.value.map(value => copyWithReusableLeaves(value))
      ]).inherit(this);
    } else if (isNode(b, N.Sequence)) {
      const values = b.value.map(v => copyWithReusableLeaves(v));
      newSequence.value.push(...values);
    } else {
      b = copyWithReusableLeaves(b);
      newSequence.value.push(b);
    }
    return newSequence;
  }

  /**
   * During evaluation of sequences,
   * Jess may find values that are lists.
   *
   * In this case, we need to create a single
   * list that contains members of the expanded lists.
   *
   * @todo - If this is a selector sequence, and we've
   *         evaluated an expression to an inner sequence,
   *         then we should be inserting white-space combinators?
   *
   * @todo - REWRITE
   */
  override evalNode(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    return pipe(
      () => this.evaluateValues(context, 'eval'),
      values => this.finalizeValues(values)
    );
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.resolveValue(context);
  }

  private resolveValue(context: Context): MaybePromise<Node> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    return pipe(
      () => this.evaluateValues(context, 'resolve'),
      values => this.finalizeValues(values)
    );
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector): void {
  //   const cast = context.cast
  //   this.value.forEach(n => {
  //     const val = cast(n)
  //     val.toCSS(context, out)
  //   })
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.expr([', loc)
  //   const length = this.value.length - 1
  //   this.value.forEach((n, i) => {
  //     n.toModule(context, out)
  //     if (i < length) {
  //       out.add(', ')
  //     }
  //   })
  //   out.add('])')
  // }
}

export const seq = defineType(Sequence, 'Sequence', 'seq');

export const spaced = (
  value: Node[],
  options?: SequenceOptions
) => {
  return new Sequence(value, options);
};
