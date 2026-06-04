import type { Context } from '../../context.js';
import { Node } from '../node.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

export function evaluateNodeArraySync(
  context: Context,
  value: readonly Node[]
): Node[] {
  const values = new Array<Node>(value.length);
  for (let index = 0; index < value.length; index++) {
    const node = value[index]!;
    const evaluated = node.eval(context);
    if (!(evaluated instanceof Node)) {
      throw new TypeError('Expected node array item to evaluate to a node');
    }
    values[index] = evaluated;
  }
  return values;
}

export function evaluateNodeArrayMaybe(
  context: Context,
  value: readonly Node[]
): MaybePromise<Node[]> {
  const values = new Array<Node>(value.length);
  for (let index = 0; index < value.length; index++) {
    const node = value[index]!;
    const out = node.eval(context);
    if (isThenable(out)) {
      return evaluateNodeArrayRest(context, value, values, index, out as Promise<Node>);
    }
    values[index] = out as Node;
  }
  return values;
}

async function evaluateNodeArrayRest(
  context: Context,
  value: readonly Node[],
  values: Node[],
  pendingIndex: number,
  pending: Promise<Node>
): Promise<Node[]> {
  values[pendingIndex] = await pending;
  for (let index = pendingIndex + 1; index < value.length; index++) {
    const node = value[index]!;
    const out = node.eval(context);
    values[index] = isThenable(out) ? await out : out as Node;
  }
  return values;
}
