import { Node, defineType } from './node';
import { Nil } from './nil';
import { List } from './list';
import type { Context } from '../context';
import combinate from 'combinate';
import { compareNodeArray } from './util/compare';
import { isNode } from '..';
import { type MaybePromise, pipe, isThenable, serialForEach } from '@jesscss/awaitable-pipe';

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
   *
   * @todo - REWRITE
   */
  override evalNode(context: Context): MaybePromise<Node> {
    return pipe(
      () => {
        const node = this.maybeClone(context);
        const maybe = serialForEach(node.value.map((n, i) => [n, i] as const), ([n, i]) => {
          const out = n.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Node>).then((res) => {
              node.value[i] = res;
              return undefined;
            });
          }
          node.value[i] = out as Node;
          return undefined;
        });
        if (isThenable(maybe)) {
          return (maybe as Promise<void>).then(() => node);
        }
        return node;
      },
      (node) => {
        node.value = node.value.filter(n => n && !(n instanceof Nil));
        let lists: Record<number, Node[]> | undefined;
        for (let [i, n] of node.value.entries()) {
          if (n instanceof List) {
            if (!lists) {
              lists = { [i]: n.value };
            } else {
              lists[i] = n.value;
            }
          }
        }
        if (lists) {
          let Class = Object.getPrototypeOf(this).constructor;
          let combinations = combinate(lists);
          let returnList = new List([] as Node[]).inherit(this);
          combinations.forEach((combo) => {
            let expr = [...node.value];
            for (let pos in combo) {
              if (Object.prototype.hasOwnProperty.call(combo, pos)) {
                expr[pos] = combo[pos] as Node;
              }
            }
            returnList.value.push(new Class(expr));
          });
          if (returnList.value.length === 1) {
            return returnList.value[0] as typeof Class;
          }
          return returnList;
        }
        if (node.type !== 'Selector' && node.value.length === 1) {
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
