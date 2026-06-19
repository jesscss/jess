import { F_HAS_NODE_CHILD, F_STATIC, Node } from '../node.js';
import { N } from '../node-type.js';
import { Sequence } from '../sequence.js';
import { copyWithReusableLeaves } from './cloning.js';
import { isNode } from './is-node.js';

function canReuseStaticScalarLeaf(value: Node): boolean {
  return value.hasFlag(F_STATIC)
    && value.location.length === 0
    && !value.hasFlag(F_HAS_NODE_CHILD);
}

export function cloneBoundValue(value: Node): Node {
  if (isNode(value, N.Rules | N.Collection)) {
    return value;
  }
  if (canReuseStaticScalarLeaf(value)) {
    return value;
  }
  return copyWithReusableLeaves(value).detachTrivia(true);
}

export function createRestBindingValue(args: Node[]): Sequence {
  const restArgs = new Array<Node>(args.length);
  for (let i = 0; i < args.length; i++) {
    restArgs[i] = cloneBoundValue(args[i]!);
  }
  return new Sequence(restArgs);
}

export function createArgumentsBindingValue(args: Node[]): Sequence {
  const value: Node[] = [];
  for (let i = 0; i < args.length; i++) {
    const argNode = args[i]!;
    if (argNode instanceof Sequence) {
      for (let j = 0; j < argNode.items.length; j++) {
        value.push(cloneBoundValue(argNode.items[j]!));
      }
    } else {
      value.push(cloneBoundValue(argNode));
    }
  }
  return new Sequence(value);
}
