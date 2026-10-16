import { any } from './nodes.js';
import { withValueLayout } from './provenance.js';
import { isTerminalText, isValueSlotValue, tokenText } from './css-grammar-helpers.js';
import type { ValueSlot } from './nodes.js';

/**
 * A run of component values: one value is itself, several keep the authored
 * run between each two. Two components with no whitespace between them
 * (`opacity=50`, `a~b`) are adjacent component values (css-syntax-3 §5.4.7),
 * so that boundary's run is the empty string, not an implied space. A `=`
 * delim terminal — read by a dialect whose expression grammar gives `=` no
 * meaning in a call argument (`alpha(opacity=50)`, `foo(a = b)`) — is the same
 * `Any` component the css reading builds, so the run is written exactly as
 * authored.
 */
export function componentRun(children: readonly unknown[]): ValueSlot {
  const values: ValueSlot[] = [];
  const layout: string[] = [];
  let separator = '';
  for (const child of children) {
    if (isValueSlotValue(child)) {
      if (values.length > 0) {
        layout.push(separator);
      }
      values.push(child);
      separator = '';
    } else if (isTerminalText(child)) {
      const text = tokenText(child);
      if (text === '=') {
        layout.push(separator);
        values.push(any('='));
        separator = '';
      } else {
        separator += text;
      }
    }
  }
  return values.length === 1 ? values[0]! : withValueLayout(values, layout);
}
