/**
 * A run of CSS component values holding a delim Less gives no meaning (`a.b`,
 * `a~b`; ledger N18) where Less reads an operand: a paren group's, a guard's,
 * an `if()` / `boolean()` condition's, a mixin argument's comparison. It parses
 * there as it does in a value (ledger P45).
 *
 * While it is read it is one operand, a space run glued as authored. A
 * comparison one of whose sides is such a run is not a Less comparison: it is
 * the CSS run it is, its operator one more delim, as a chain is (ledger N18).
 * A paren group around one run holds the run's components, as css's group
 * does, so the value check reads its delims where it is written (ledger P48).
 */
import { any, isValueSlotArray, spaced, valueLayoutOf, withValueLayout } from '@jesscss/core/ast';
import type { Sequence, ValueNode, ValueSlot } from '@jesscss/core/ast';

/** A run's components; a value reducer builds a run of value nodes only. */
function componentsOf(run: readonly ValueSlot[]): ValueNode[] {
  return run.map((part) => {
    if (isValueSlotArray(part)) {
      throw new TypeError('Less delim run holds a nested run.');
    }
    return part;
  });
}

/** The operand a delim run is: one space run, glued where its components were. */
export function runOperand(run: ValueSlot): ValueNode {
  return isValueSlotArray(run)
    ? withValueLayout(spaced(componentsOf(run)), valueLayoutOf(run) ?? [])
    : run;
}

/** What a paren group around one operand holds: a run operand's components, or the operand. */
export function groupContent(operand: ValueNode): ValueSlot {
  return operand.type === 'Sequence'
    ? withValueLayout([...operand.parts], valueLayoutOf(operand) ?? [])
    : operand;
}

function isSequence(value: unknown): value is Sequence {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Sequence';
}

/** Whether a comparison side is a delim run: a run operand holding a delim, read whole or as a guard operand's run. */
export function holdsDelimRun(side: unknown): boolean {
  const value = typeof side === 'object' && side !== null && 'kind' in side && side.kind === 'less-guard-operand' && 'run' in side
    ? side.run
    : side;
  return isSequence(value) && value.parts.some(part => part.type === 'Any');
}

/** A run of comparison sides and operators as one CSS run: each side's components in place, glued as authored. */
export function flattenRuns(run: readonly ValueNode[]): ValueNode[] {
  const layout = valueLayoutOf(run) ?? [];
  const values: ValueNode[] = [];
  const separators: string[] = [];
  run.forEach((value, at) => {
    if (at > 0) {
      separators.push(layout[at - 1] ?? ' ');
    }
    const inner = isSequence(value) ? valueLayoutOf(value) ?? [] : [];
    (isSequence(value) ? value.parts : [value]).forEach((part, index) => {
      if (index > 0) {
        separators.push(inner[index - 1] ?? ' ');
      }
      values.push(part);
    });
  });
  return withValueLayout(values, separators);
}

/** Comparison sides and operators that make no Less comparison (`.m(a =)`): the CSS run they are, each operator a delim. */
export function operatorRun(parts: ReadonlyArray<ValueNode | string>): ValueNode[] {
  return flattenRuns(parts.map(part => typeof part === 'string' ? any(part.trim()) : part));
}

/**
 * A comparison operator among a paren term's children: the terminal
 * `functionConditionOperator` reads, the whole delim run at that point, which
 * alone of a term's terminals opens with `<`, `>` or `=` (its padding, comments
 * included, its `not` and the group's parens do not; an operand is a node).
 * Only a Less spelling compares (`guardOperatorText`); `==` is a delim.
 */
export function isComparisonOperator(child: unknown): boolean {
  const text = typeof child === 'string'
    ? child
    : typeof child === 'object' && child !== null && !('type' in child) && 'value' in child && typeof child.value === 'string' ? child.value : '';
  return text.startsWith('<') || text.startsWith('>') || text.startsWith('=');
}
