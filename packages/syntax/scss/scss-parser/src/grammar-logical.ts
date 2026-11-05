import { NO_SPAN, condition, cssBaseMathOutsideParens, expression, guardCompare, guardLogical, guardNot, isToken, operation } from '@jesscss/core/ast';
import type { GuardNode, ValueNode } from '@jesscss/core/ast';
import { COMPARISON_OPERATORS, isConditionWord, isScssValue, scssConditionSource, scssTruth } from './grammar-helpers.js';

const RELATIONAL_OPERATORS: ReadonlySet<string> = new Set(['>=', '<=', '>', '<']);

/*
 * A comparison in value position needs the `$( … )` computation boundary (§4.5.2),
 * so it is an `Expression` over a `Condition`, the pair the unary `not` rung builds.
 * Sass `==` lowers to the named primitive `sass-equal`, not an operator (§5.1): the
 * same lowering `IfComparison` performs, so a comparison means one thing in a guard
 * and in a value. `!=` is that comparison under `not`.
 */
function scssComparison(left: ValueNode, operator: string, right: ValueNode): ValueNode {
  const comparison = guardCompare('cmp', operator === '==' || operator === '!=' ? 'sass-equal' : operator, left, right, false);
  return expression(condition(
    operator === '!=' ? guardNot(comparison, 'not', NO_SPAN, 0) : comparison,
    `${scssConditionSource(left)} ${operator} ${scssConditionSource(right)}`
  ));
}

/** One left-associative pass over a rung's operators: those in `level` fold into their operands. */
function foldComparisons(
  { values, words }: { readonly values: readonly ValueNode[]; readonly words: readonly string[] },
  level: ReadonlySet<string>
): { values: ValueNode[]; words: string[] } {
  const folded = [values[0]!];
  const left: string[] = [];
  words.forEach((word, index) => {
    const right = values[index + 1]!;
    if (level.has(word)) {
      folded[folded.length - 1] = scssComparison(folded.at(-1)!, word, right);
    } else {
      left.push(word);
      folded.push(right);
    }
  });
  return { values: folded, words: left };
}

/**
 * Fold one logical rung left-associatively onto `Operation` nodes carrying the
 * word itself as the operator. The operator token is kept out of the fold by
 * shape (only values participate), so the rung reduces the same way whether it
 * spelled `and` or `or`.
 *
 * In a CSS `if()` condition the keyword arrives as authored ({@link
 * ConditionWord}); one not in lower case (`AND`) folds to the condition
 * written as authored ({@link Condition}, its `word` kept, ledger J20), which
 * {@link ifCondition} reads as the condition's own `and` / `or` (ledger P38:
 * "in CSS it comes out as written"). Its truth is Sass's `and` / `or`'s, so a
 * Sass `if()` that consumes it decides as before.
 */
export function foldLogicalOperation(children: readonly unknown[]): ValueNode {
  const operands = children.filter(isScssValue);
  const operators: string[] = [];
  for (const child of children) {
    if (isConditionWord(child)) {
      operators.push(child.conditionWord);
    } else if (isToken(child) && !isScssValue(child)) {
      const word = child.value.trim().toLowerCase();
      if (word === 'and' || word === 'or' || COMPARISON_OPERATORS.has(word)) {
        operators.push(word);
      }
    }
  }
  const { values, words } = operators.some(operator => COMPARISON_OPERATORS.has(operator))
    ? foldComparisons(foldComparisons({ values: operands, words: operators }, RELATIONAL_OPERATORS), COMPARISON_OPERATORS)
    : { values: operands, words: operators };
  let result = values[0]!;
  for (let index = 1; index < values.length; index += 1) {
    const word = words[index - 1]!;
    const right = values[index]!;
    if (word === 'and' || word === 'or') {
      result = operation(word, result, right, false, cssBaseMathOutsideParens(word));
    } else {
      const guard: GuardNode = guardLogical(word.toLowerCase() === 'and' ? 'and' : 'or', scssTruth(result), scssTruth(right), word, NO_SPAN);

      /* Written from its guard (`word`, ledger J20), so no source text is kept: an operand may be one `scssConditionSource` cannot spell (`#{$a}`). */
      result = condition(guard, '');
    }
  }
  return result;
}
