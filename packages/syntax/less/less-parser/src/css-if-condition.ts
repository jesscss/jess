/*
 * A CSS `if()` condition in a Less value (css-values-5 §8.3, ledger P38):
 * `media()`, `supports()` and `style()` tests joined by `not`, `and`, `or` and
 * paren groups. The browser answers it, so Less does not read it as its own
 * condition: it is the component run css builds for the same bytes, each
 * keyword as authored (ledger J20, owner 2026-10-13: "B: CSS any case, Less
 * lowercase"). Owner 2026-10-20: ".css in general is just .css".
 *
 * The condition reducers (`grammar-helpers.ts`) carry that run on their facts
 * as `css`; these build it.
 */
import { NO_SPAN, block, isSpannedToken, isValueSlotArray, keyword, sourceStartOf, withSourceSpan } from '@jesscss/core/ast';
import type { SourceSpan, ValueSlot } from '@jesscss/core/ast';

/** A condition fact, as far as the CSS run it may be. */
interface CssConditionFact {
  readonly css?: ValueSlot;
}

/** `fact`, carrying `css` when the condition is a CSS one. */
export function withCss<T extends object>(fact: T, css: ValueSlot | undefined): T & CssConditionFact {
  return css === undefined ? fact : { ...fact, css };
}

/** A paren group around a CSS condition: the paren group css builds. */
export function cssGroup(css: ValueSlot | undefined, span: SourceSpan): ValueSlot | undefined {
  return css === undefined ? undefined : withSourceSpan(block(css), span);
}

/**
 * `not` before a CSS condition, unless glued to its group: `not(…)` is one
 * function token in CSS (CSS Syntax 3 §4.3.4). A value paren group records
 * the glue (`gluedAt`); a function condition's `not` token ends where the
 * group starts.
 */
export function cssNegation(operand: CssConditionFact, word: string, gluedAt: number, not: unknown): ValueSlot | undefined {
  const css = operand.css;
  const glued = gluedAt !== NO_SPAN || (isSpannedToken(not) && css !== undefined && !isValueSlotArray(css) && sourceStartOf(css) === not.span.end);
  return css === undefined || glued ? undefined : [keyword(word), css];
}

/**
 * Terms joined by `and` / `or`: the run of every term's CSS condition and each
 * keyword between them, or `undefined` when a term is a Less condition or a
 * keyword is glued to its group (`and(…)`). The terms are condition facts; a
 * keyword is a value paren group's (`word`, `gluedAt`) or a function
 * condition's token, which carries the whitespace around it.
 */
export function cssConditionRun(children: readonly unknown[]): ValueSlot | undefined {
  const run: ValueSlot[] = [];
  for (const child of children) {
    if (typeof child !== 'object' || child === null) {
      continue;
    }
    if (isConditionFact(child)) {
      if (child.css === undefined) {
        return undefined;
      }
      run.push(child.css);
    } else if ('gluedAt' in child && 'word' in child && typeof child.word === 'string') {
      if (child.gluedAt !== NO_SPAN) {
        return undefined;
      }
      run.push(keyword(child.word));
    } else if ('value' in child && typeof child.value === 'string') {
      /* The token carries the whitespace after the keyword, so one ending on the keyword is glued to its group (`and(…)`). */
      if (child.value.trimEnd() === child.value) {
        return undefined;
      }
      run.push(keyword(child.value.trim()));
    }
  }
  return run.length > 1 ? run : undefined;
}

/* A condition fact, which carries the guard it lowers to; a keyword never does. */
function isConditionFact(child: object): child is CssConditionFact {
  return 'guard' in child;
}
