import type { Fn, FnCtx, ValueGroup, Value } from '@jesscss/core';
import { defineFunction, emitValue, groupItems } from '@jesscss/core';
import { sameStringKind } from './string-result.js';

/** The selected token's Less string or CSS form, with uppercase URL encoding. */
function tokenValue(token: string, value: ValueGroup, ctx: FnCtx): string {
  const raw = /s/i.test(token) ? ctx.stringify(value) : emitValue(value);
  return /[A-Z]$/.test(token) ? encodeURIComponent(raw) : raw;
}

const FORMAT_PARAMS: Fn['params'] = [
  { type: 'any' },
  { type: 'any', optional: true },
  { type: 'any', optional: true },
  { type: 'any', optional: true },
  { type: 'any', optional: true }
];

function formatKernel(list: ValueGroup, ctx: FnCtx): Value {
  const items = groupItems(list);
  const template = items[0]!;
  let result = ctx.stringify(template);

  for (let index = 1; index < items.length; index++) {
    const value = items[index]!;
    const match = /%[sda]/i.exec(result);
    if (!match) {
      break;
    }
    result = `${result.slice(0, match.index)}${tokenValue(match[0], value, ctx)}${result.slice(match.index + match[0].length)}`;
  }
  return sameStringKind(template, result.replace(/%%/g, '%'));
}

/**
 * The `%()` string-format function (registered as `%`; public alias
 * `string-format`). Substitutes `%s`/`%d`/`%a` tokens in `template` with the
 * following arguments — uppercase (`%S`/`%D`/`%A`) URL-encodes the value, and `%%`
 * emits a literal `%`. The result is the template's kind of string
 * ({@link sameStringKind}).
 * @param template the format string
 * @param arg1 substituted for the first token
 * @param arg2 substituted for the second token
 * @param arg3 substituted for the third token
 * @param arg4 substituted for the fourth token
 * @returns the formatted string
 */
/** The registered whole-word spelling used by the AST-v2 evaluator. */
export const format: Fn = defineFunction('string-format', {
  params: FORMAT_PARAMS,
  variadic: true,
  body: formatKernel
});

/** The `%()` spelling retained by the public Less callable export. */
export const formatPercent: Fn = defineFunction('%', {
  params: FORMAT_PARAMS,
  variadic: true,
  body: formatKernel
});

export default formatPercent;
