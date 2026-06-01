import type { Node } from '../node.js';
import type { List } from '../list.js';
import { Any } from '../any.js';
import { Sequence } from '../sequence.js';
import { Nil } from '../nil.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { cloneBoundValue, createRestBindingValue } from './callable-binding.js';
import { getCallableNodeSignature, getCallableRestSignature, getCallableSignatureKey } from './callable-signature.js';

export type CallableParamBindingRecord = {
  name: string;
  value?: Node;
  prepareValue?: (value: Node | undefined) => Node;
  readonly?: boolean;
  sourceNode?: Node;
};

export type CallableParamMatch = {
  bindings: CallableParamBindingRecord[];
  signatureKey: string | undefined;
};

type CallableParamMatchOptions = {
  params: List<Node>;
  args: Node[];
  hasFileContext: boolean;
};

export function matchCallableParams({
  params,
  args,
  hasFileContext
}: CallableParamMatchOptions): CallableParamMatch | undefined {
  const bindingRecordsByIndex = new Map<number, CallableParamBindingRecord>();
  const signatureParts: Array<string | undefined> = new Array(params.length);
  const hasRestParam = params.value.some(param => param.type === 'Rest');
  const maxPositionalArgs = hasRestParam ? Number.POSITIVE_INFINITY : params.length;
  const positions = params.length;
  let requiredPositions = 0;

  for (const param of params.value) {
    if (isNode(param, N.VarDeclaration)) {
      if (param.value.value instanceof Nil) {
        requiredPositions++;
      }
    } else if (isNode(param, N.Any) && param.options.role === 'property') {
      requiredPositions++;
    } else if (param.type !== 'Rest') {
      requiredPositions++;
    }
  }

  let argPos = 0;
  let match = true;
  for (let i = 0; i < positions; i++) {
    const arg = args[argPos];
    if (!arg) {
      continue;
    }

    let param: Node | undefined;
    let paramIndex = -1;
    let argValue: Node;

    if (isNode(arg, N.VarDeclaration)) {
      paramIndex = params.value.findIndex((candidate) => {
        if (isNode(candidate, N.VarDeclaration)) {
          return candidate.value.name.valueOf() === arg.value.name.valueOf();
        }
        if (isNode(candidate, N.Any) && candidate.options.role === 'property') {
          return candidate.valueOf() === arg.value.name.valueOf();
        }
        return false;
      });
      if (paramIndex >= 0) {
        param = params.value[paramIndex];
        argValue = arg.value.value;
      } else {
        match = false;
        break;
      }
    } else {
      paramIndex = i;
      param = params.value[paramIndex];
      if (!param) {
        match = false;
        break;
      }
      argValue = arg;
    }

    if (!param) {
      match = false;
      break;
    }

    if (isNode(param, N.VarDeclaration)) {
      bindingRecordsByIndex.set(paramIndex, {
        name: param.value.name.valueOf(),
        value: argValue,
        prepareValue: cloneBoundValue,
        readonly: param.options.readonly,
        sourceNode: isNode(arg, N.VarDeclaration) ? arg : param
      });
      signatureParts[paramIndex] = getCallableNodeSignature(argValue);
    } else if (isNode(param, N.Any) && param.options.role === 'property') {
      bindingRecordsByIndex.set(paramIndex, {
        name: param.valueOf(),
        value: argValue,
        prepareValue: cloneBoundValue,
        sourceNode: isNode(arg, N.VarDeclaration) ? arg : param
      });
      signatureParts[paramIndex] = getCallableNodeSignature(argValue);
    } else if (param.type === 'Rest') {
      const rest = args.slice(argPos);
      const restName = param.value ? `${param.value}` : `rest${i}`;
      bindingRecordsByIndex.set(paramIndex, {
        name: restName,
        prepareValue: () => createRestBindingValue(rest)
      });
      signatureParts[paramIndex] = getCallableRestSignature(rest, restName, hasFileContext);
    } else {
      signatureParts[paramIndex] = getCallableNodeSignature(argValue);
      if (param.compare(argValue) !== 0) {
        match = false;
        break;
      }
    }

    argPos++;
  }

  const positionalArgCount = args.filter(arg => !isNode(arg, N.VarDeclaration)).length;
  if (positionalArgCount > maxPositionalArgs) {
    return undefined;
  }
  if (argPos < requiredPositions) {
    return undefined;
  }
  if (args.length > 1 && params.value.length === 1 && requiredPositions === 1) {
    return undefined;
  }
  if (!match) {
    return undefined;
  }

  for (let i = 0; i < positions; i++) {
    const param = params.value[i]!;
    if (signatureParts[i] !== undefined) {
      continue;
    }
    if (isNode(param, N.VarDeclaration)) {
      bindingRecordsByIndex.set(i, {
        name: param.value.name.valueOf(),
        value: param.value.value,
        prepareValue: cloneBoundValue,
        readonly: param.options.readonly,
        sourceNode: param
      });
      signatureParts[i] = getCallableNodeSignature(param.value.value);
    } else if (param.type === 'Rest') {
      const restName = param.value ? `${param.value}` : `rest${i}`;
      bindingRecordsByIndex.set(i, {
        name: restName,
        prepareValue: hasFileContext
          ? () => new Sequence([])
          : () => new Any(restName, { role: 'property' })
      });
      signatureParts[i] = hasFileContext ? '' : restName;
    }
  }

  return {
    bindings: [...bindingRecordsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, binding]) => binding),
    signatureKey: getCallableSignatureKey(signatureParts)
  };
}
