import { sourceSpanOf } from './provenance.js';
import { F_HAS_NODE_CHILD, F_STATIC, Node } from '../node.js';
import { Sequence } from '../sequence.js';

function canReuseStaticScalarLeaf(value: Node): boolean {
  return value.hasFlag(F_STATIC)
    && (sourceSpanOf(value) === undefined)
    && !value.hasFlag(F_HAS_NODE_CHILD);
}

export function cloneBoundValue(value: Node): Node {
  if (canReuseStaticScalarLeaf(value)) {
    return value;
  }
  return value.cloneForPlacement().detachTrivia(true);
}

export function createRestBindingValue(args: Node[]): Sequence {
  const restArgs = new Array<Node>(args.length);
  for (let i = 0; i < args.length; i++) {
    restArgs[i] = cloneBoundValue(args[i]!);
  }
  return new Sequence(restArgs);
}

export function createArgumentsBindingValue(args: Node[]): Sequence {
  const value = new Sequence([]);
  for (let i = 0; i < args.length; i++) {
    value.value.push(args[i]!);
  }
  return value;
}

export function getArgumentsBindingValues(args: Node[]): Node[] {
  const argumentNodes: Node[] = [];
  for (let i = 0; i < args.length; i++) {
    const argNode = args[i]!;
    if (argNode instanceof Sequence) {
      for (let j = 0; j < argNode.value.length; j++) {
        argumentNodes.push(argNode.value[j]!);
      }
    } else {
      argumentNodes.push(argNode);
    }
  }
  return argumentNodes;
}
