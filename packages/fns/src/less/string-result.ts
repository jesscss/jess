import type { Value, ValueGroup } from '@jesscss/core';
import { isValueGroupArray, makeAny, makeKeyword, makeQuoted } from '@jesscss/core';

/**
 * A string function's result in its input's kind: a quoted input stays quoted
 * with its quote, an escaped string (`~"…"`, `e()`) stays an escaped string
 * (ledger V3), and anything else is an unquoted keyword.
 */
export function sameStringKind(input: ValueGroup, text: string): Value {
  if (!isValueGroupArray(input)) {
    if (input.type === 'Quoted' && !input.escaped) {
      return makeQuoted(text, input.quote, false);
    }
    if (input.type === 'Any' && input.escapedQuote !== '') {
      return makeAny(text, input.escapedQuote);
    }
  }
  return makeKeyword(text);
}
