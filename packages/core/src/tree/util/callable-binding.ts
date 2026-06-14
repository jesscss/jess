import { F_HAS_NODE_CHILD, F_STATIC, Node } from '../node.js';
import { Sequence } from '../sequence.js';
import { copyWithReusableLeaves } from './cloning.js';

function canReuseStaticScalarLeaf(value: Node): boolean {
  return value.hasFlag(F_STATIC)
    && (value._location?.length ?? 0) === 0
    && !value.hasFlag(F_HAS_NODE_CHILD);
}

export function cloneBoundValue(value: Node): Node {
  if (canReuseStaticScalarLeaf(value)) {
    return value;
  }
  return copyWithReusableLeaves(value).detachTrivia(true);
}

export function createRestBindingValue(args: readonly Node[], start = 0): Sequence {
  const restLength = args.length - start;
  const restArgs = new Array<Node>(restLength);
  for (let i = 0; i < restLength; i++) {
    restArgs[i] = cloneBoundValue(args[start + i]!);
  }
  return new Sequence(restArgs);
}

export function createArgumentsBindingValue(args: Node[]): Sequence {
  const value = new Sequence([]);
  if (args.length > 0) {
    value.addFlag(F_HAS_NODE_CHILD);
  }
  for (let i = 0; i < args.length; i++) {
    value.value.push(args[i]!);
  }
  return value;
}

export function getArgumentsBindingValues(args: Node[]): Node[] {
  for (let i = 0; i < args.length; i++) {
    const argNode = args[i]!;
    if (argNode instanceof Sequence) {
      const argumentNodes = new Array<Node>();
      for (let j = 0; j < i; j++) {
        argumentNodes.push(args[j]!);
      }
      for (let j = 0; j < argNode.value.length; j++) {
        argumentNodes.push(argNode.value[j]!);
      }
      for (let j = i + 1; j < args.length; j++) {
        const nextArg = args[j]!;
        if (nextArg instanceof Sequence) {
          for (let k = 0; k < nextArg.value.length; k++) {
            argumentNodes.push(nextArg.value[k]!);
          }
        } else {
          argumentNodes.push(nextArg);
        }
      }
      return argumentNodes;
    }
  }
  return args;
}
