/*
 * A CSS `if()` condition in a Less value (css-values-5 §8.3, ledger P38):
 * `media()`, `supports()` and `style()` tests joined by `not`, `and`, `or` and
 * paren groups. The browser answers it, so Less does not read it as its own
 * condition: it is the component run css builds for the same bytes, each
 * keyword as authored (ledger J20, owner 2026-10-13: "B: CSS any case, Less
 * lowercase"). Owner 2026-10-20: ".css in general is just .css".
 *
 * The condition reducers (`grammar-helpers.ts`) carry the run on their facts
 * as `css`, with the keyword tokens in it as `cssKeywords`: a keyword is CSS's
 * only while the whole condition is, so its case is reported (as a Less
 * keyword's) by the first enclosing condition that is Less's. This module
 * cannot import the reducers' fact guards (they import it), so it reads the
 * three shapes a fold's children take by their fields.
 */
import { NO_SPAN, block, isSpannedToken, isValueSlotArray, keyword, sourceStartOf, withSourceSpan } from '@jesscss/core/ast';
import type { SourceSpan, ValueSlot } from '@jesscss/core/ast';

/** A CSS condition: its run, and the keyword tokens written in it. */
export interface CssCondition {
  readonly css: ValueSlot;
  readonly cssKeywords: readonly unknown[];
}

/** A condition fact, as far as the CSS condition it may be. */
type CssConditionFact = Partial<CssCondition>;

/** `fact`, carrying `css` when the condition is a CSS one. */
export function withCss<T extends object>(fact: T, css: CssCondition | undefined): T & CssConditionFact {
  return css === undefined ? fact : { ...fact, ...css };
}

/** A CSS test, the condition's operand. */
export function cssOperand(test: ValueSlot): CssCondition {
  return { css: test, cssKeywords: [] };
}

/** A paren group around a CSS condition: the paren group css builds. */
export function cssGroup(inner: CssConditionFact, span: SourceSpan): CssCondition | undefined {
  return inner.css === undefined ? undefined : { css: withSourceSpan(block(inner.css), span), cssKeywords: inner.cssKeywords ?? [] };
}

/**
 * `not` before a CSS condition, unless glued to its group: `not(…)` is one
 * function token in CSS (CSS Syntax 3 §4.3.4). A value paren group records
 * the glue (`gluedAt`); a function condition's `not` token ends where the
 * group starts.
 */
export function cssNegation(operand: CssConditionFact, word: string, gluedAt: number, not: unknown): CssCondition | undefined {
  const css = operand.css;
  if (css === undefined || gluedAt !== NO_SPAN || gluedTo(not, css)) {
    return undefined;
  }
  return { css: [keyword(word), css], cssKeywords: [not, ...(operand.cssKeywords ?? [])] };
}

/**
 * Terms joined by `and` / `or`: the run of every term's CSS condition and each
 * keyword between them, or `undefined` when a term is a Less condition or a
 * keyword is glued to its group (`and(…)`). Then the condition is Less's, and
 * the keywords its CSS terms deferred are reported through `report`.
 */
export function cssConditionRun(children: readonly unknown[], rawChildren: readonly unknown[], report: (keyword: unknown) => void): CssCondition | undefined {
  const run: ValueSlot[] = [];
  const deferred: unknown[] = [];
  const own: unknown[] = [];
  let lessCondition = false;
  let keywordToken: unknown;
  for (const [index, child] of children.entries()) {
    if (typeof child !== 'object' || child === null) {
      continue;
    }
    if (isConditionFact(child)) {
      lessCondition ||= child.css === undefined || gluedTo(keywordToken, child.css);
      run.push(child.css ?? []);
      deferred.push(...(child.cssKeywords ?? []));
    } else if ('gluedAt' in child && 'word' in child && typeof child.word === 'string') {
      lessCondition ||= child.gluedAt !== NO_SPAN;
      run.push(keyword(child.word));
    } else if ('value' in child && typeof child.value === 'string') {
      keywordToken = rawChildren[index];
      own.push(keywordToken);
      run.push(keyword(child.value.trim()));
    }
  }
  if (run.length < 2) {
    return undefined;
  }
  if (lessCondition) {
    deferred.forEach(report);
    return undefined;
  }
  return { css: run, cssKeywords: [...deferred, ...own] };
}

/* A condition fact, which carries the guard it lowers to; a keyword never does. */
function isConditionFact(child: object): child is CssConditionFact {
  return 'guard' in child;
}

/* A keyword token whose keyword ends where the group after it starts: the token carries the whitespace around it. */
function gluedTo(token: unknown, css: ValueSlot): boolean {
  if (!isSpannedToken(token) || typeof token.value !== 'string' || isValueSlotArray(css) || css.type !== 'Block') {
    return false;
  }
  return sourceStartOf(css) === token.span.start + token.value.trimEnd().length;
}
