import { Node, defineType } from './node';
import { Nil } from './nil';
import { List } from './list';
import type { Context } from '../context';
import combinate from 'combinate';
import { compareNodeArray } from './util/compare';
import { isNode } from '..';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print';

export type SequenceOptions = {
  /**
   * CSS values are typically spaced,
   * because of how they're parsed.
   */
  // spaced: boolean
};

/**
 * A continuous collection of nodes. Historically in Less,
 * these were termed "expressions", but in computer science,
 * an expression will yield a value, and a CSS value can
 * actually be a sequence of values (like for shorthand)
 */
export class Sequence extends Node<Node[], SequenceOptions> {
  type = 'Sequence';
  shortType = 'seq';

  override compare(other: Node) {
    if (other instanceof Sequence) {
      return compareNodeArray(this.value, other.value);
    }
    return super.compare(other);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const { value } = this;
    const length = value.length;

    if (length === 0) {
      return '';
    }

    // Serialize first node with toString() to preserve comments
    value[0]!.toString(options);

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
        const currentNodeOut = w.capture(() => node.toString(options));
        const currentStartsWithSpace = currentNodeOut.startsWith(' ');

        if (!prevEndsWithSpace && !currentStartsWithSpace) {
          // No space present - add single space before node
          w.add(' ');
        }
        // Write the captured output (node was already serialized in capture())
        w.add(currentNodeOut);
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
    } else if (isNode(b, 'Sequence')) {
      /** Inference not working in this class? */
      const values = b.value.map(v => v.maybeClone(context));
      if (values.length) {
        values[0]!.pre = 1;
      }
      newSequence.value.push(...values);
    } else {
      b = b.maybeClone(context);
      b.pre = 1;
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
    return pipe(
      () => {
        const node = this;
        const maybe = serialForEach(node.value.map((n, i) => [n, i] as const), ([n, i]) => {
          const out = n.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then((res) => {
              node.value[i] = res;
            });
          }
          node.value[i] = out as Node;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => node);
        }
        return node;
      },
      (node) => {
        node.value = node.value.filter(n => n && !(n instanceof Nil));
        // let lists: Record<number, Node[]> | undefined;
        // for (let [i, n] of node.value.entries()) {
        //   if (n instanceof List) {
        //     if (!lists) {
        //       lists = { [i]: n.value };
        //     } else {
        //       lists[i] = n.value;
        //     }
        //   }
        // }
        /**
         * List bubbling
         * @todo - Is this behavior we still want?
         */
        // if (lists) {
        //   let Class = Object.getPrototypeOf(this).constructor;
        //   let combinations = combinate(lists);
        //   let returnList = new List([] as Node[]).inherit(this);
        //   combinations.forEach((combo) => {
        //     let expr = [...node.value];
        //     for (let pos in combo) {
        //       if (Object.prototype.hasOwnProperty.call(combo, pos)) {
        //         expr[pos] = combo[pos] as Node;
        //       }
        //     }
        //     returnList.value.push(new Class(expr));
        //   });
        //   if (returnList.value.length === 1) {
        //     return returnList.value[0] as typeof Class;
        //   }
        //   return returnList;
        // }
        if (node.value.length === 1) {
          return node.value[0]!;
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
