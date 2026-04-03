import { CANONICAL, Node, F_STATIC, defineType, type NodeEdge, type RenderKey } from './node.js';
import { canReuseEvalState } from './node-base.js';
import { Nil } from './nil.js';
import { List } from './list.js';
import type { Context } from '../context.js';
import { compare, compareNodeArray } from './util/compare.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { setParent } from './util/field-helpers.js';
import { addEdgeAt, addParentEdge, removeParentEdge } from './util/cursor.js';

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  // spaced: boolean
  /** Used with custom properties */
  preserveWhitespace?: boolean;
  /** Serialize children as a spaced value list without mutating child `pre` fields. */
  forceSpacing?: boolean;
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

  value!: Node[];
  valueEdges?: Array<NodeEdge<Node> | undefined>;

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
    const value = this.getValue(ctx?.renderKey ?? this.renderKey);
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const clonedValue = deep
      ? value.map(child => cloneChild(child))
      : [...value];
    const options = this._meta?.options;
    const newNode: this = Reflect.construct(this.constructor, [
      [],
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    ]);
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

  getValue(renderKey?: RenderKey) {
    if (renderKey === undefined || !this.valueEdges) {
      return this.value;
    }
    let resolved: Node[] | undefined;
    for (let i = 0; i < this.value.length; i++) {
      const alternate = this.valueEdges[i]?.get(renderKey);
      if (alternate !== undefined) {
        (resolved ??= [...this.value])[i] = alternate;
      }
    }
    return resolved ?? this.value;
  }

  getValueAt(index: number, renderKey?: RenderKey) {
    return renderKey !== undefined
      ? this.valueEdges?.[index]?.get(renderKey) ?? this.value[index]
      : this.value[index];
  }

  private _replaceValueAt(index: number, node: Node, renderKey: RenderKey): void {
    const previous = this.getValueAt(index, renderKey);
    if (previous === node) {
      return;
    }
    if (previous && previous !== node) {
      removeParentEdge(previous, renderKey);
    }
    addEdgeAt(this, 'value', index, renderKey, node);
    addParentEdge(node, renderKey, this);
  }

  private _cloneWithValue(value: Node[]): this {
    const node = this.clone();
    node.value = value;
    for (const child of value) {
      if (child instanceof Node) {
        node.adopt(child);
      }
    }
    return node;
  }

  // NOTE: `length` intentionally remains canonical for now. A state-aware
  // getter would need an explicit Context channel; otherwise the same node
  // instance would have ambiguous answers when different sessions patch
  // `value` to different lengths at the same time.

  override compare(other: Node, context?: Context) {
    if (other instanceof Sequence) {
      const equalityMode = this.treeContext?.equalityMode ?? 'coerce';
      const renderKey = context?.renderKey;
      const left = this.getValue(renderKey);
      const right = other.getValue(renderKey);
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

  /** @todo - This serialization seems overly complex */
  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    if (options?.inCustom) {
      return super.toTrimmedString(options);
    }
    const w = options.writer!;
    const mark = w.mark();
    const value = this.getValue(options.context?.renderKey ?? this.renderKey);
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
      if (node.pre === 0 && !this.options?.forceSpacing) {
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
        let currentNodeOut = currentCaptured.text;
        const isNegativeValue = isNode(node, N.Negative);
        if (
          isNegativeValue
          && !this.options?.preserveWhitespace
          && /^\s+-/.test(currentNodeOut)
        ) {
          currentNodeOut = currentNodeOut.replace(/^\s+/, '');
        }
        const currentStartsWithSpace = /^\s/.test(currentNodeOut);
        const hasExplicitNoSpaceBoundary = (
          !this.options?.forceSpacing
          && (
            prevTrailingIntent === 'explicit_none'
            || currentCaptured.leadingIntent === 'explicit_none'
          )
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
    let newSequence = this.clone();
    if (b instanceof List) {
      return new List([newSequence, ...b.getValue(context.renderKey)]).inherit(this);
    } else if (isNode(b, N.Sequence)) {
      /** Inference not working in this class? */
      const values = b.getValue(context.renderKey).map(v => v.clone());
      if (values.length) {
        values[0]!.pre = 1;
      }
      newSequence.value = [...newSequence.getValue(context.renderKey), ...values];
      for (const child of newSequence.value) {
        newSequence.adopt(child);
      }
    } else {
      b = b.clone();
      b.pre = 1;
      newSequence.value = [...newSequence.getValue(context.renderKey), b];
      for (const child of newSequence.value) {
        newSequence.adopt(child);
      }
    }
    return newSequence;
  }

  override preEval(context: Context): MaybePromise<Node> {
    const reusableState = canReuseEvalState(this, context);
    if (this.preEvaluated && reusableState) {
      return this;
    }
    const renderKey = context.renderKey ?? this.renderKey;
    const isNonCanonical = renderKey !== undefined && renderKey !== CANONICAL;
    const value = this.getValue(renderKey);
    const nextValue = [...value];

    if (!this.hasFlag(F_STATIC)) {
      const maybe = serialForEach(nextValue, (child, i) => {
        const result = child.preEval(context);
        if (isThenable(result)) {
          return (result as Promise<Node>).then((resolved) => {
            if (resolved !== child) {
              nextValue[i] = resolved;
            }
          });
        }
        if (result !== child) {
          nextValue[i] = result as Node;
        }
      });
      if (isThenable(maybe)) {
        return (maybe as Promise<void>).then(() => {
          if (isNonCanonical) {
            for (let i = 0; i < nextValue.length; i++) {
              if (nextValue[i] !== value[i]) {
                this._replaceValueAt(i, nextValue[i]!, renderKey);
              }
            }
            if (reusableState) {
              this.preEvaluated = true;
            }
            return this;
          }
          const changed = nextValue.some((child, i) => child !== value[i]);
          if (!changed) {
            if (reusableState) {
              this.preEvaluated = true;
            }
            return this;
          }
          const node = this._cloneWithValue(nextValue);
          node.preEvaluated = true;
          return node;
        });
      }
      if (isNonCanonical) {
        for (let i = 0; i < nextValue.length; i++) {
          if (nextValue[i] !== value[i]) {
            this._replaceValueAt(i, nextValue[i]!, renderKey);
          }
        }
        if (reusableState) {
          this.preEvaluated = true;
        }
        return this;
      }
      const changed = nextValue.some((child, i) => child !== value[i]);
      if (!changed) {
        if (reusableState) {
          this.preEvaluated = true;
        }
        return this;
      }
      const node = this._cloneWithValue(nextValue);
      node.preEvaluated = true;
      return node;
    }

    if (reusableState) {
      this.preEvaluated = true;
    }
    return this;
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
    const renderKey = context.renderKey ?? this.renderKey;
    const isNonCanonical = renderKey !== undefined && renderKey !== CANONICAL;
    return pipe(
      () => {
        const nextValue = [...this.getValue(renderKey)];
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
            return { changed, nextValue };
          });
        }
        return { changed, nextValue };
      },
      ({ changed, nextValue }) => {
        const currentValue = this.getValue(renderKey);
        const value = nextValue.filter(n => n && !(n instanceof Nil));
        const shapeChanged = value.length !== currentValue.length;

        if (isNonCanonical && !shapeChanged) {
          if (changed) {
            for (let i = 0; i < value.length; i++) {
              if (value[i] !== currentValue[i]) {
                this._replaceValueAt(i, value[i]!, renderKey);
              }
            }
          }
          return this;
        }

        if (value.length === 1 && !this.options?.preserveWhitespace) {
          return value[0]!;
        }
        if (!changed && !shapeChanged) {
          return this;
        }
        return this._cloneWithValue(value);
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
