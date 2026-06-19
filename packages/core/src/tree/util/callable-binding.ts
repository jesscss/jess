import { Node } from '../node.js';
import { Sequence } from '../sequence.js';

export function createRestBindingValue(args: Node[]): Sequence {
  const restArgs = new Array<Node>(args.length);
  for (let i = 0; i < args.length; i++) {
    restArgs[i] = args[i]!;
  }
  return new Sequence(restArgs);
}

export function createArgumentsBindingValue(args: Node[]): Sequence {
  const value: Node[] = [];
  for (let i = 0; i < args.length; i++) {
    const argNode = args[i]!;
    if (argNode instanceof Sequence) {
      for (let j = 0; j < argNode.items.length; j++) {
        value.push(argNode.items[j]!);
      }
    } else {
      value.push(argNode);
    }
  }
  return new Sequence(value);
}
