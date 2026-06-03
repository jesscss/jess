import type { Node } from '../node.js';
import { F_VISIBLE } from '../node.js';
import { type BindingCell, getBindingCellValue } from '../scope-frame.js';
import { createArgumentsBindingValue, getArgumentsBindingValues } from './callable-binding.js';
import type { CallableParamBindingRecord } from './callable-param-match.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

type CreateCallableLiveSlotsOptions = {
  paramBindings: CallableParamBindingRecord[];
  nodeArgs: Node[];
  defineArguments?: boolean;
  rulesContext?: object;
};

export function createCallableLiveSlots({
  paramBindings,
  nodeArgs,
  defineArguments = false,
  rulesContext
}: CreateCallableLiveSlotsOptions): Map<string, BindingCell> {
  const liveSlots = new Map<string, BindingCell>();
  for (const binding of paramBindings) {
    if (isNode(binding.sourceNode, N.VarDeclaration)) {
      binding.sourceNode.options ??= {};
      binding.sourceNode.options.paramVar = true;
      binding.sourceNode.removeFlag(F_VISIBLE);
    }
    liveSlots.set(binding.name, {
      value: binding.value,
      prepareValue: binding.prepareValue,
      sourceNode: binding.sourceNode as Node | undefined,
      rulesContext,
      readonly: binding.readonly
    });
  }
  if (defineArguments) {
    liveSlots.set('arguments', {
      prepareValue: () => {
        const paramValues: Node[] = [];
        for (const binding of paramBindings) {
          const liveSlot = liveSlots.get(binding.name);
          if (liveSlot) {
            paramValues.push(getBindingCellValue(liveSlot));
          } else if (binding.value) {
            paramValues.push(binding.value);
          }
        }
        const argumentNodes = (paramValues.length > 0) ? paramValues : nodeArgs;
        return createArgumentsBindingValue(getArgumentsBindingValues(argumentNodes));
      },
      readonly: true
    });
  }
  return liveSlots;
}
