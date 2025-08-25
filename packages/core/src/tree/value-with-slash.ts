import { defineType, Node } from './node';
import { List } from './list';
import type { Context } from '../context';
import { isNode } from './util/is-node';
import { Operation } from './operation';
import { Sequence } from './sequence';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';

/**
 * In CSS, values with slashes are ambiguous and are determined by the
 * micro-syntax of the given property or function.
 *
 * @see https://dev.to/matthewdean/css-the-language-with-no-syntax-oom
 *
 * We extend List to generalize grouping, but any value with a slash
 * does not really have predictable list "members" in the syntactic sense.
 */
export class SlashValue extends List {
  override type = 'SlashValue';
  override shortType = 'slash';

  override evalNode(context: Context): MaybePromise<Node> {
    let list = this;
    if (!context.shouldOperate('/')) {
      return list as Node;
    }
    let { value } = list;
    if (value.length !== 2) {
      throw new Error('A SlashValue must have exactly two members');
    }
    let left = list.value[0]!;
    let preLeft: Node[] | undefined;
    let preRight: Node[] | undefined;
    if (isNode(left, 'Sequence')) {
      value = left.value;
      left = value[left.value.length - 1]!;
      preLeft = value.slice(0, -1);
    }
    let right = list.value[1]!;
    if (isNode(right, 'Sequence')) {
      value = right.value;
      right = value[0]!;
      preRight = value.slice(1);
    }
    let op = new Operation([left, '/', right]);
    if (preLeft) {
      if (preRight) {
        return (new Sequence([...preLeft, op, ...preRight])).eval(context);
      }
      return (new Sequence([...preLeft, op])).eval(context);
    } else if (preRight) {
      return (new Sequence([op, ...preRight])).eval(context);
    }
    return op.eval(context);
  }
}

export const slash = defineType(SlashValue, 'SlashValue');