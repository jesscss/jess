import { Node, F_STATIC, defineType } from './node.js';
import { Nil } from './nil.js';
import { List } from './list.js';
import type { Context } from '../context.js';
import { compareNodeArray } from './util/compare.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { sessionGetField, sessionPatchField, sessionSetParent } from './util/session-helpers.js';

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  // spaced: boolean
  /** Used with custom properties */
  preserveWhitespace?: boolean;
};

/**
 * A continuous collection of nodes. Historically in Less,
 * these were termed "expressions", but in computer science,
 * an expression will yield a value, and a CSS value can
 * actually be a sequence of values (like for shorthand)
 */
export interface Sequence {
  type: 'Sequence' | 'QueryCondition';
  shortType: 'seq' | 'query';
}
export class Sequence extends Node<Node[], SequenceOptions> {
  static override childKeys = ['value'] as const;

  value!: Node[];

  constructor(value: Node[], options?: SequenceOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.value = value;
    for (const child of value) {
      if (child instanceof Node) {
        this.adopt(child);
      }
    }
  }

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const value = this._getValue(ctx);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const clonedValue = deep
      ? value.map(child => cloneChild(child))
      : [...value];
    const options = (this as any)._meta?.options;
    const newNode = new (this.constructor as any)(
      [],
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    newNode.value = clonedValue;
    if (ctx?.session) {
      for (const child of clonedValue) {
        sessionSetParent(child, newNode, ctx);
      }
    } else {
      for (const child of clonedValue) {
        newNode.adopt(child);
      }
    }
    newNode.inherit(this);
    return newNode;
  }

  get length() {
    return this.value.length;
  }

  protected _getValue(context?: Context): Node[] {
    return context
      ? sessionGetField<Node[]>(this, 'value', context)
      : this.value;
  }

  protected _setValue(value: Node[], context: Context): void {
    if (context.session) {
      for (const child of value) {
        sessionSetParent(child, this, context);
      }
      if (this === this.sourceNode) {
        sessionPatchField(this, 'value', value, context);
        return;
      }
    } else {
      for (const child of value) {
        this.adopt(child);
      }
    }
    this.value = value;
  }

  protected _setValueAt(index: number, value: Node, context: Context): void {
    const next = [...this._getValue(context)];
    next[index] = value;
    this._setValue(next, context);
  }

  override compare(other: Node) {
    if (other instanceof Sequence) {
      const equalityMode = this.treeContext?.equalityMode ?? 'coerce';
      const result = compareNodeArray([...this.value], [...other.value], equalityMode);
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

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    if (options?.inCustom) {
      return super.toTrimmedString(options);
    }
    const w = options.writer!;
    const mark = w.mark();
    const value = this._getValue(options.context);
    const length = value.length;

    if (length === 0) {
      return '';
    }

    // Serialize first node with toString() to preserve comments
    const firstCaptured = w.captureWithMeta(() => value[0]!.toString(options));
    w.add(firstCaptured.text);
    let prevTrailingIntent = firstCaptured.trailingIntent;

    // Serialize subsequent nodes with normalized spacing
    for (let i = 1; i < length; i++) {
      const node = value[i]!;
      // For sequences, normalize spacing based on actual serialized output (including pre/post)
      // If direct child has explicit pre === 0, respect that (no space)
      if (node.pre === 0) {
        // Explicitly no space - respect that, but still use toString() to preserve comments
        node.toString(options);
      } else {
        // Check what's already written (previous node's output) to see if it ends with space
        const currentMark = w.mark();
        const writtenSoFar = w.getSince(mark);
        const prevEndsWithSpace = writtenSoFar.endsWith(' ');
        w.restore(currentMark);

        // Capture current node's output to check if it starts with space
        // This captures the serialized output including pre/post from child nodes
        const currentCaptured = w.captureWithMeta(() => node.toString(options));
        const currentNodeOut = currentCaptured.text;
        const currentStartsWithSpace = currentNodeOut.startsWith(' ');
        const hasExplicitNoSpaceBoundary = (
          prevTrailingIntent === 'explicit_none'
          || currentCaptured.leadingIntent === 'explicit_none'
        );

        if (!prevEndsWithSpace && !currentStartsWithSpace && !hasExplicitNoSpaceBoundary) {
          // No space present - add single space before node
          w.add(' ');
        }
        // Write the captured output (node was already serialized in capture())
        w.add(currentNodeOut);
        prevTrailingIntent = currentCaptured.trailingIntent;
      }
    }

    return w.getSince(mark);
  }

  override operate(b: Node, op: string, context: Context): Sequence | List {
    if (op !== '+') {
      throw new Error(`Sequence operation "${op}" not supported`);
    }
    let newSequence = this.maybeClone(context);
    if (b instanceof List) {
      return new List([newSequence, ...b.value]).inherit(this);
    } else if (isNode(b, N.Sequence)) {
      /** Inference not working in this class? */
      const values = b._getValue(context).map(v => v.maybeClone(context));
      if (values.length) {
        values[0]!.pre = 1;
      }
      newSequence._setValue([...newSequence._getValue(context), ...values], context);
    } else {
      b = b.maybeClone(context);
      b.pre = 1;
      newSequence._setValue([...newSequence._getValue(context), b], context);
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
      () => {
        const node = this;
        const maybe = serialForEach(node._getValue(context).map((n, i) => [n, i] as const), ([n, i]) => {
          const out = n.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then((res) => {
              node._setValueAt(i, res, context);
            });
          }
          node._setValueAt(i, out as Node, context);
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => node);
        }
        return node;
      },
      (node) => {
        const value = node._getValue(context).filter(n => n && !(n instanceof Nil));
        node._setValue(value, context);
        if (value.length === 1 && !node.options.preserveWhitespace) {
          return value[0]!;
        }
        return node;
      }
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
  for (let i = 1; i < value.length; i++) {
    value[i]!.pre = 1;
  }
  return new Sequence(value, options);
};
