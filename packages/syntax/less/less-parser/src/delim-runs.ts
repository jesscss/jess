/**
 * A run of CSS component values holding a delim Less gives no meaning (`a.b`,
 * `a~b`; ledger N18) where Less reads an operand: a paren group's, a guard's,
 * an `if()` / `boolean()` condition's. It parses there as it does in a value
 * (ledger P45). As a comparison side it is one operand, a space run glued as
 * authored; a paren group that holds nothing else holds its components, as
 * css's group does, so the value check reads its delims (ledger P48).
 */
import { isValueSlotArray, spaced, valueLayoutOf, withValueLayout } from '@jesscss/core/ast';
import type { ValueNode, ValueSlot } from '@jesscss/core/ast';

/** The operand a delim run is: one space run, glued where its components were. */
export function runOperand(run: ValueSlot): ValueNode {
  return isValueSlotArray(run)
    ? withValueLayout(spaced(run.filter((part): part is ValueNode => !isValueSlotArray(part))), valueLayoutOf(run) ?? [])
    : run;
}

/** What a paren group around one operand holds: a run operand's components, or the operand. */
export function groupContent(operand: ValueNode): ValueSlot {
  return operand.type === 'Sequence'
    ? withValueLayout([...operand.parts], valueLayoutOf(operand) ?? [])
    : operand;
}
