/**
 * The `.scss` sum reducer: a `+` chain with a string literal is the
 * interpolated string it builds (ledger V36, owner 2026-10-23).
 */
import { appendInterpolationLiteral, authoredSource, expression, interpolation, isToken, isMathOperator, isValueSlotArray, quoted } from '@jesscss/core/ast';
import type { AstSourceSpan, Interpolation, ValueNode } from '@jesscss/core/ast';
import { isInCalculation, isScssValue, scssFoldOperation } from './grammar-helpers.js';

/**
 * A string literal written as an operand of `+`: a quoted string, or
 * `unquote("…")` / `string.unquote("…")` of a plain one, which is the escaped
 * string `~"…"` (owner 2026-10-22), in that string's own quote. Its parts are
 * its text and interpolations.
 */
function plusStringLiteral(node: ValueNode): { readonly quote: string; readonly escaped: boolean; readonly parts: Interpolation['parts'] } | null {
  if (node.type === 'Quoted' && !node.escaped) {
    return { quote: node.quote, escaped: false, parts: node.interp === null ? [{ lit: node.value }] : node.interp.parts };
  }
  const arg = node.type === 'FunctionCall' && (node.name === 'unquote' || node.name === 'string.unquote') && node.args.length === 1 ? node.args[0]! : undefined;
  const value = arg === undefined || arg.spread || arg.name !== undefined || isValueSlotArray(arg.value) ? undefined : arg.value;
  return value?.type === 'Quoted' && !value.escaped && value.interp === null ? { quote: value.quote, escaped: true, parts: [{ lit: value.value }] } : null;
}

/**
 * The reducer of an `.scss` sum. A `+` chain with a string literal among its
 * operands is the interpolated string it builds (owner 2026-10-23: *"parse
 * "Elapsed " + 10px as "Elapsed $(10px)""*): `"Elapsed " + $t` is the `Quoted`
 * template `.jess` writes `"Elapsed $($t)"`, and `unquote("(") + $v +
 * unquote(")")` the escaped one, `~"($($v))"`. As in Dart Sass, `+` folds
 * left: the operands before the first literal stay one sum (`1 + 2 + "a"` is
 * `"$(1 + 2)a"`), each one after it is interpolated (`"a" + 1 + 2` is
 * `"a$(1)$(2)"`). The result is quoted as its first literal, unless a word or
 * an interpolation before it makes it unquoted; a leading operand only
 * evaluation knows (`$prefix + "-x"`) decides it there (`leadQuoting`). The
 * template keeps its literals as written and the first literal's quote;
 * evaluation chooses the quote from the text it builds (`quotedText`). A chain
 * with `-`, with no literal, or inside a math function's arguments (a
 * calculation) is math ({@link scssFoldOperation}; ledger V36).
 */
export function scssSum(children: readonly unknown[], span: AstSourceSpan, state: unknown): ValueNode {
  const operands = children.filter(isScssValue);
  const literals = operands.map(plusStringLiteral);
  const first = literals.findIndex(literal => literal !== null);
  if (first === -1 || operands.length < 2 || isInCalculation(state) || children.some(child => isToken(child) && isMathOperator(child.value) && child.value !== '+')) {
    return scssFoldOperation(children);
  }
  const head = literals[first]!;
  const lead = operands[0]!;
  const unquoted = head.escaped || (first === 1 && (lead.type === 'Keyword' || lead.type === 'Interpolation'));
  const texts = literals.flatMap(literal => (literal === null ? [] : literal.parts.flatMap(part => ('lit' in part ? [part.lit] : []))));
  const parts: Interpolation['parts'] = [];
  if (first > 0) {
    /* The operands before the first literal stay one sum, folded (and spanned) as math is. */
    parts.push({ ref: expression(scssFoldOperation(children.slice(0, children.indexOf(operands[first - 1]) + 1))), unquote: true });
  }
  for (let index = first; index < operands.length; index += 1) {
    const literal = literals[index];
    if (literal === null || literal === undefined) {
      parts.push({ ref: expression(operands[index]!), unquote: true });
      continue;
    }
    for (const part of literal.parts) {
      if ('lit' in part) {
        appendInterpolationLiteral(parts, part.lit);
      } else {
        parts.push(part);
      }
    }
  }
  const template = interpolation(parts);
  const leadQuoting = first === 1 && lead.type !== 'Keyword' && lead.type !== 'Interpolation' && lead.type !== 'Dimension' && lead.type !== 'Color' && lead.type !== 'Null';
  return quoted(authoredSource(span, state, 'An SCSS string built with +'), texts.join(''), head.quote, unquoted, leadQuoting ? { ...template, leadQuoting: true } : template);
}
