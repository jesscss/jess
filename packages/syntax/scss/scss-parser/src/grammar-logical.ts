import { NO_SPAN, condition, cssBaseMathOutsideParens, expression, guardCompare, guardLogical, guardNot, isToken, isValueSlotArray, list, operation, sourceEndOf, sourceStartOf, withSourceSpan, withValueLayout } from '@jesscss/core/ast';
import type { AstSourceSpan, GuardNode, ValueNode, ValueSlot } from '@jesscss/core/ast';
import type { ComparisonWord } from './grammar-helpers.js';
import { COMPARISON_OPERATORS, isConditionWord, isScssValue, isScssValueTail, requireValue, scssTruth } from './grammar-helpers.js';

const RELATIONAL_OPERATORS: ReadonlySet<string> = new Set(['>=', '<=', '>', '<']);

/** Where a comparison's error points: the run's first operator. */
type ComparisonSite = AstSourceSpan | undefined;

const isComparisonWord = (child: unknown): child is ComparisonWord => typeof child === 'object' && child !== null && 'at' in child;

function comparisonSite(children: readonly unknown[]): ComparisonSite {
  return children.find(isComparisonWord)?.at;
}

/*
 * A comparison in value position needs the `$( … )` computation boundary (§4.5.2),
 * so it is an `Expression` over a `Condition`, the pair the unary `not` rung builds.
 * Sass `==` lowers to the named primitive `sass-equal`, not an operator (§5.1): the
 * same lowering `IfComparison` performs. `!=` is that comparison under `not`. A
 * relational lowers to Sass's own (`sass<`, …), which orders numbers and raises on
 * anything else. Written from its guard, so no source text is kept.
 */
function scssComparison(left: ValueNode, operator: string, right: ValueNode, at: ComparisonSite): ValueNode {
  const comparison = guardCompare('cmp', operator === '==' || operator === '!=' ? 'sass-equal' : `sass${operator}`, left, right, false);
  const node = condition(operator === '!=' ? guardNot(comparison, 'not', NO_SPAN, 0) : comparison, '');
  return expression(at === undefined ? node : withSourceSpan(node, at));
}

/** One left-associative pass over a rung's operators: those in `level` fold into their operands. */
function foldComparisons(
  { values, words }: { readonly values: readonly ValueNode[]; readonly words: readonly string[] },
  level: ReadonlySet<string>,
  at: ComparisonSite
): { values: ValueNode[]; words: string[] } {
  const folded = [values[0]!];
  const left: string[] = [];
  words.forEach((word, index) => {
    const right = values[index + 1]!;
    if (level.has(word)) {
      folded[folded.length - 1] = scssComparison(folded.at(-1)!, word, right, at);
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
  const only = children[0];
  if (children.length === 1 && isScssValue(only)) {
    return only;
  }
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
    ? foldComparisons(foldComparisons({ values: operands, words: operators }, RELATIONAL_OPERATORS, comparisonSite(children)), COMPARISON_OPERATORS, comparisonSite(children))
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

/** The comparison a value is, or the first under its `and`/`or`. */
function comparisonIn(value: ValueSlot): object | undefined {
  if (isValueSlotArray(value)) {
    return undefined;
  }
  if (value.type === 'Expression') {
    return !isValueSlotArray(value.value) && value.value.type === 'Condition' ? value.value : undefined;
  }
  return value.type === 'Operation' && (value.operator === 'and' || value.operator === 'or')
    ? comparisonIn(value.left) ?? comparisonIn(value.right)
    : undefined;
}

/*
 * A `/` list. `/` binds tighter than a comparison in Sass and is a separator read
 * around it here, so a comparison in one has no reading: it raises where it is read
 * (`SASS_SLASH_COMPARISON`), never `1/false`.
 */
function slashList(items: ValueSlot[]): ValueNode {
  const comparison = comparisonIn(items[0]!) ?? comparisonIn(items[items.length - 1]!);
  return comparison === undefined
    ? list(items, '/')
    : expression(withSourceSpan(condition(guardCompare('cmp', 'sass-slash', items[0]!, items[1]!, false), ''), { start: sourceStartOf(comparison), end: sourceEndOf(comparison) }));
}

/**
 * `ValueTerm`'s reduction. A slash groups only its DIRECT neighbours
 * (DESIGN-DECISIONS P33 as amended 2026-09-24, P35): comma, then whitespace,
 * then slash. A slash tail joins the item before it — `12px/1.5 Arial` is
 * `[12px / 1.5, Arial]` — and a space tail starts a new item.
 */
export function scssSlashGroupedTerm(children: readonly unknown[]): ValueSlot {
  const items: ValueNode[] = [requireValue(children[0])];
  const grouped: boolean[] = [false];
  const separators: string[] = [];
  for (const child of children.slice(1)) {
    if (!isScssValueTail(child)) {
      throw new TypeError('SCSS value term produced an invalid list boundary.');
    }
    const last = items.length - 1;
    const previous = items[last]!;
    if (child.kind === 'slash' || (child.separator === '/' && (comparisonIn(previous) ?? comparisonIn(child.value)) !== undefined)) {
      items[last] = grouped[last] === true && previous.type === 'List'
        ? slashList([...previous.value, child.value])
        : slashList([previous, child.value]);
      grouped[last] = true;
    } else {
      items.push(child.value);
      grouped.push(false);
      separators.push(child.separator);
      if (child.glued !== null) {
        items.push(child.glued);
        grouped.push(false);
        separators.push('');
      }
    }
  }
  return items.length === 1
    ? items[0]!
    : withValueLayout(items, separators);
}
