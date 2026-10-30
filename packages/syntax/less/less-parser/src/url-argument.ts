import type { FieldMap } from 'parseman';
import { any } from '@jesscss/core/ast';
import type { ValueNode } from '@jesscss/core/ast';
import { isInterp, isQuoted, requireTerminalText } from './grammar-helpers.js';

/**
 * The address a `url(` argument read (`plainUrlArgument` in `grammar.ts`): its
 * quoted body as written, its unquoted text as `Any`, or `undefined` when it is
 * empty. `url(`, `url-prefix(` and `domain(` all read it.
 */
export function plainUrlBodyFrom(fields: FieldMap | undefined): ValueNode | undefined {
  const captured = fields?.body;
  if (Array.isArray(captured)) {
    throw new TypeError('Less URL argument produced repeated body facts.');
  }
  const body = captured?.value;
  if (body === undefined) {
    return undefined;
  }
  return isQuoted(body) || isInterp(body) ? body : any(requireTerminalText(body));
}
