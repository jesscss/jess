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
  const bindingRecordsByIndex = new Array<CallableParamBindingRecord | undefined>(params.length);
  const signatureParts: Array<string | undefined> = new Array(params.length);
  let hasRestParam = false;
  for (let i = 0; i < params.value.length; i++) {
    if (params.value[i]!.type === 'Rest') {
      hasRestParam = true;
      break;
    }
  }
  const maxPositionalArgs = hasRestParam ? Number.POSITIVE_INFINITY : params.length;
  const positions = params.length;
  let requiredPositions = 0;

  for (let i = 0; i < params.value.length; i++) {
    const param = params.value[i]!;
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
      for (let j = 0; j < params.value.length; j++) {
        const candidate = params.value[j]!;
        if (isNode(candidate, N.VarDeclaration)) {
          if (candidate.value.name.valueOf() === arg.value.name.valueOf()) {
            paramIndex = j;
            break;
          }
          continue;
        }
        if (isNode(candidate, N.Any) && candidate.options.role === 'property') {
          if (candidate.valueOf() === arg.value.name.valueOf()) {
            paramIndex = j;
            break;
          }
        }
      }
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
      bindingRecordsByIndex[paramIndex] = {
        name: param.value.name.valueOf(),
        value: argValue,
        prepareValue: cloneBoundValue,
        readonly: param.options.readonly,
        sourceNode: isNode(arg, N.VarDeclaration) ? arg : param
      };
      signatureParts[paramIndex] = getCallableNodeSignature(argValue);
    } else if (isNode(param, N.Any) && param.options.role === 'property') {
      bindingRecordsByIndex[paramIndex] = {
        name: param.valueOf(),
        value: argValue,
        prepareValue: cloneBoundValue,
        sourceNode: isNode(arg, N.VarDeclaration) ? arg : param
      };
      signatureParts[paramIndex] = getCallableNodeSignature(argValue);
    } else if (param.type === 'Rest') {
      const rest = new Array<Node>(args.length - argPos);
      for (let j = argPos; j < args.length; j++) {
        rest[j - argPos] = args[j]!;
      }
      const restName = param.value ? `${param.value}` : `rest${i}`;
      bindingRecordsByIndex[paramIndex] = {
        name: restName,
        prepareValue: () => createRestBindingValue(rest)
      };
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

  let positionalArgCount = 0;
  for (let i = 0; i < args.length; i++) {
    if (!isNode(args[i], N.VarDeclaration)) {
      positionalArgCount++;
    }
  }
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
      bindingRecordsByIndex[i] = {
        name: param.value.name.valueOf(),
        value: param.value.value,
        prepareValue: cloneBoundValue,
        readonly: param.options.readonly,
        sourceNode: param
      };
      signatureParts[i] = getCallableNodeSignature(param.value.value);
    } else if (param.type === 'Rest') {
      const restName = param.value ? `${param.value}` : `rest${i}`;
      bindingRecordsByIndex[i] = {
        name: restName,
        prepareValue: hasFileContext
          ? () => new Sequence([])
          : () => new Any(restName, { role: 'property' })
      };
      signatureParts[i] = hasFileContext ? '' : restName;
    }
  }

  const bindings: CallableParamBindingRecord[] = [];
  for (let i = 0; i < bindingRecordsByIndex.length; i++) {
    const binding = bindingRecordsByIndex[i];
    if (binding) {
      bindings.push(binding);
    }
  }

  return {
    bindings,
    signatureKey: getCallableSignatureKey(signatureParts)
  };
}
