import { Node, F_STATIC, defineType } from './node.js';
import { Nil } from './nil.js';
import { List } from './list.js';
import type { Context } from '../context.js';
import { compare, compareNodeArray } from './util/compare.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { getField, setField, setParent } from './util/field-helpers.js';

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
export interface Sequence extends Node<Node[], SequenceOptions, SequenceChildData> {
  type: 'Sequence' | 'QueryCondition';
  shortType: 'seq' | 'query';
}
export type SequenceChildData = { value: Node[] };

export class Sequence extends Node<Node[], SequenceOptions, SequenceChildData> {
  static override childKeys = ['value'] as const;

  /** @internal */ value!: Node[];

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
    const value = this.get('value', ctx);
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
    if (ctx) {
      for (const child of clonedValue) {
        setParent(child, newNode, ctx);
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

  private _getOptions(context?: Context): SequenceOptions | undefined {
    return context
      ? getField<SequenceOptions | undefined>(this, 'options', context)
      : this.options;
  }

  // NOTE: `length` intentionally remains canonical for now. A state-aware
  // getter would need an explicit Context channel; otherwise the same node
  // instance would have ambiguous answers when different sessions patch
  // `value` to different lengths at the same time.

  override compare(other: Node, context?: Context) {
    if (other instanceof Sequence) {
      const equalityMode = this.treeContext?.equalityMode ?? 'coerce';
      const left = this.get('value', context);
      const right = other.get('value', context);
      const result = !context
        ? compareNodeArray(left, right, equalityMode)
        : compareSequenceItems(left, right, equalityMode, context);
      return result;
    }
    if (other.type === 'Any') {
      const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
      const left = normalize(this.toTrimmedString(context ? { context } : undefined));
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
    const value = this.get('value', options.context);
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
      return new List([newSequence, ...b.get('value')]).inherit(this);
    } else if (isNode(b, N.Sequence)) {
      /** Inference not working in this class? */
      const values = b.get('value', context).map(v => v.maybeClone(context));
      if (values.length) {
        values[0]!.pre = 1;
      }
      setField(newSequence, 'value', [...newSequence.get('value', context), ...values], context);
    } else {
      b = b.maybeClone(context);
      b.pre = 1;
      setField(newSequence, 'value', [...newSequence.get('value', context), b], context);
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
        const nextValue = [...node.get('value', context)];
        let changed = false;
        const maybe = serialForEach(nextValue.map((n, i) => [n, i] as const), ([n, i]) => {
          const out = n.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then((res) => {
              if (res !== n) {
                nextValue[i] = res;
                changed = true;
              }
            });
          }
          if ((out as Node) !== n) {
            nextValue[i] = out as Node;
            changed = true;
          }
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => {
            if (changed) {
              setField(node, 'value', nextValue, context);
            }
            return node;
          });
        }
        if (changed) {
          setField(node, 'value', nextValue, context);
        }
        return node;
      },
      (node) => {
        const value = node.get('value', context).filter(n => n && !(n instanceof Nil));
        setField(node, 'value', value, context);
        if (value.length === 1 && !node._getOptions(context)?.preserveWhitespace) {
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

function compareSequenceItems(
  left: Node[],
  right: Node[],
  equalityMode: 'coerce' | 'strict',
  context: Context
): 0 | 1 | -1 | undefined {
  let output: 0 | 1 | -1 | undefined;

  if (left.length !== right.length) {
    return undefined;
  }

  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    const result = a instanceof Node && b instanceof Node
      ? a.compare(b, context)
      : compare(a, b, equalityMode);
    if (result === undefined) {
      return undefined;
    }
    if (output === undefined) {
      output = result;
    } else if (result !== output) {
      return undefined;
    }
  }
  return output;
}
