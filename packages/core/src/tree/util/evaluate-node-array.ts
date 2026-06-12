import type { Context } from '../../context.js';
import { Node } from '../node.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

export function evaluateNodeArraySync(
  context: Context,
  value: Node[]
): Node[] {
  let values: Node[] | undefined;
  for (let index = 0; index < value.length; index++) {
    const node = value[index]!;
    const evaluated = node.eval(context);
    if (!(evaluated instanceof Node)) {
      throw new TypeError('Expected node array item to evaluate to a node');
    }
    if (values) {
      values[index] = evaluated;
    } else if (evaluated !== node) {
      values = new Array<Node>(value.length);
      for (let copyIndex = 0; copyIndex < index; copyIndex++) {
        values[copyIndex] = value[copyIndex]!;
      }
      values[index] = evaluated;
    }
  }
  return values ?? value;
}

export function evaluateNodeArrayMaybe(
  context: Context,
  value: Node[]
): MaybePromise<Node[]> {
  let values: Node[] | undefined;
  for (let index = 0; index < value.length; index++) {
    const node = value[index]!;
    const out = node.eval(context);
    if (isThenable(out)) {
      return evaluateNodeArrayRest(context, value, values, index, out as Promise<Node>);
    }
    const evaluated = out as Node;
    if (values) {
      values[index] = evaluated;
    } else if (evaluated !== node) {
      values = new Array<Node>(value.length);
      for (let copyIndex = 0; copyIndex < index; copyIndex++) {
        values[copyIndex] = value[copyIndex]!;
      }
      values[index] = evaluated;
    }
  }
  return values ?? value;
}

async function evaluateNodeArrayRest(
  context: Context,
  value: Node[],
  values: Node[] | undefined,
  pendingIndex: number,
  pending: Promise<Node>
): Promise<Node[]> {
  const pendingValue = await pending;
  if (values) {
    values[pendingIndex] = pendingValue;
  } else if (pendingValue !== value[pendingIndex]) {
    values = new Array<Node>(value.length);
    for (let copyIndex = 0; copyIndex < pendingIndex; copyIndex++) {
      values[copyIndex] = value[copyIndex]!;
    }
    values[pendingIndex] = pendingValue;
  }
  for (let index = pendingIndex + 1; index < value.length; index++) {
    const node = value[index]!;
    const out = node.eval(context);
    const evaluated = isThenable(out) ? await out : out as Node;
    if (values) {
      values[index] = evaluated;
    } else if (evaluated !== node) {
      values = new Array<Node>(value.length);
      for (let copyIndex = 0; copyIndex < index; copyIndex++) {
        values[copyIndex] = value[copyIndex]!;
      }
      values[index] = evaluated;
    }
  }
  return values ?? value;
}
