import { Node, defineType } from './node';
import { Nil } from './nil';
import { List } from './list';
import type { Context } from '../context';
import combinate from 'combinate';
import { cast } from './util/cast';
import { compareNodeArray } from './util/compare';
import { isNode } from '..';

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
   */
  override async evalNode(context: Context) {
    let node = this.maybeClone(context);
    /** Convert all values to Nodes */
    let valuePromises = node.value
      .map(async n => await cast(n).eval(context));

    node.value = (await Promise.all(valuePromises))
      .filter(n => n && !(n instanceof Nil));

    let lists: Record<number, Node[]> | undefined;

    node.value.forEach((n, i) => {
      if (n instanceof List) {
        if (!lists) {
          lists = {
            [i]: n.value
          };
        } else {
          lists[i] = n.value;
        }
      }
    });

    if (lists) {
      /**
       * Create new sequences of the inherited type
       * @todo - Rewrite -- Object.getPrototypeOf(this).constructor I think is wrong and maybe
       * should be this.constructor.
       */
      let Class = Object.getPrototypeOf(this).constructor;
      let combinations = combinate(lists);
      let returnList = new List([]).inherit(this);

      /** @todo - create :is() in selector */
      combinations.forEach((combo) => {
        let expr = [...node.value];
        for (let pos in combo) {
          if (Object.prototype.hasOwnProperty.call(combo, pos)) {
            expr[pos] = combo[pos] as Node;
          }
        }
        returnList.value.push(new Class(expr));
      });
      /**
       * If the created list has a length of 1,
       * then it's still a sequence, in which
       * case we can return the first value
       */
      if (returnList.value.length === 1) {
        return returnList.value[0] as typeof Class;
      }
      return returnList;
    }

    /** Selectors maintain wrappers around elements */
    if (node.type !== 'Selector' && node.value.length === 1) {
      return node.value[0];
    }
    return node;
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
  const node = new Sequence(value, options);
  node.pre = 1;
  return node;
};
