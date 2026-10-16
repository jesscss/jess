import { withValueLayout } from './provenance.js';
import { isTerminalText, isValueSlotValue, tokenText } from './css-grammar-helpers.js';
import type { ValueSlot } from './nodes.js';

/**
 * A run of component values: one value is itself, several keep the authored
 * run between each two. Two components with no whitespace between them
 * (`opacity=50`, `a~b`) are adjacent component values (css-syntax-3 §5.4.7),
 * so that boundary's run is the empty string, not an implied space. A delim
 * (`=`, `~`, `:`, …) is a component like any other — the `Any` a
 * `PunctuationValue` reduces to — so the run is written exactly as authored.
 * Every other terminal is the authored separator: whitespace or a comment.
 *
 * The exception is a `+`, `-` or `*` delim between two components: ledger F1
 * makes those separators, written with a space on each side regardless of
 * source (`a+b` → `a + b`). A run of more than one delim (`a+-b`'s `+-`) is not
 * one of them and stays as authored.
 *
 * `isOperand` is the dialect's value set, for a dialect whose values reach past
 * the css ones (a `.jess` collection).
 */
export function componentRun(
  children: readonly unknown[],
  isOperand: (child: unknown) => child is ValueSlot = isValueSlotValue
): ValueSlot {
  const values: ValueSlot[] = [];
  const layout: string[] = [];
  let separator = '';
  for (const child of children) {
    if (isOperand(child)) {
      if (values.length > 0) {
        layout.push(separator);
      }
      values.push(child);
      separator = '';
    } else if (isTerminalText(child)) {
      separator += tokenText(child);
    }
  }
  for (let i = 1; i < values.length - 1; i++) {
    if (isOperatorDelim(values[i])) {
      if (layout[i - 1] === '') {
        layout[i - 1] = ' ';
      }
      if (layout[i] === '') {
        layout[i] = ' ';
      }
    }
  }
  return values.length === 1 ? values[0]! : withValueLayout(values, layout);
}

function isOperatorDelim(value: ValueSlot | undefined): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'Any'
    && (value.src === '+' || value.src === '-' || value.src === '*');
}
