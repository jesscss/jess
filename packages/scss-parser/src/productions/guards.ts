import type { RuleContext } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import {
  Condition,
  Paren,
  type Node
} from '@jesscss/core';
import { looksLikeScssComparison } from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

export function scssCondition(this: P, ctx: RuleContext = {}) {
  const $ = this;
  ctx.allowComma = true;
  const guardNode = $.scssGuardOr(ctx) as unknown as Node;
  // The guardNode is already wrapped in Paren by scssGuardInParens
  return guardNode;
}

/**
 * 'or' expression (similar to Less's guardOr).
 * Allows comma-separated conditions like historical media queries.
 */
export function scssGuardOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let left = $.scssGuardAnd(ctx) as unknown as Node;
  let right: Node | undefined;
  $.MANY({
    GATE: () => {
      const next = $.LA(1).tokenType;
      return (ctx.allowComma && next === $.T.Comma) || next === $.T.Or;
    },
    DEF: () => {
      /**
       * Nest expressions within expressions for correct
       * order of operations.
       */
      $.OR([
        { ALT: () => $.CONSUME($.T.Comma) },
        { ALT: () => $.CONSUME($.T.Or) }
      ]);
      right = $.scssGuardAnd(ctx) as unknown as Node;
      let location = $.endRule();
      $.startRule();
      left = new Condition(
        [$.wrap(left, true), 'or', $.wrap(right!)],
        undefined,
        location,
        $.context
      );
    }
  });
  $.endRule();
  return left;
}

/**
 * 'and' expression (similar to Less's guardAnd).
 */
export function scssGuardAnd(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let left: Node | undefined;
  $.MANY_SEP({
    SEP: $.T.And,
    DEF: () => {
      let not: IToken | undefined;
      $.OPTION(() => (not = $.CONSUME($.T.Not)));
      let allowComma = ctx.allowComma;
      ctx.allowComma = false;
      let right = $.scssGuardInParens(ctx) as unknown as Node;
      ctx.allowComma = allowComma;
      if (not) {
        let [,,, endOffset, endLine, endColumn] = right.location!;
        let [startOffset, startLine, startColumn] = $.getLocationInfo(not);
        right = new Condition(
          [right],
          { negate: true },
          [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
          $.context
        );
      }
      if (!left) {
        left = right;
        return;
      }
      left = new Condition(
        [$.wrap(left, true), 'and', $.wrap(right)],
        undefined,
        $.getLocationFromNodes([left, right]),
        $.context
      );
    }
  });
  return left!;
}

/**
 * Guard in parentheses (similar to Less's guardInParens).
 * Always wraps in Paren node for consistency with Less.
 */
export function scssGuardInParens(this: P, ctx: RuleContext) {
  const $ = this;
  $.startRule();
  // Like Less: handle parenthesized content, or fall through to comparison
  // For non-parenthesized content, try comparison first (it will fail if there's no operator), then fall back to value
  let node = $.OR([
    {
      ALT: () => {
        $.CONSUME($.T.LParen);
        let innerNode = $.scssGuardInner(ctx) as unknown as Node;
        $.CONSUME($.T.RParen);
        return innerNode;
      }
    },
    {
      // Try comparison first - it requires an operator, so it will fail if there isn't one
      GATE: () => looksLikeScssComparison($, $.T),
      ALT: () => {
        return $.scssComparison(ctx);
      }
    },
    {
      // Fallback: just a value (no comparison operator)
      ALT: () => {
        return $.value(ctx);
      }
    }
  ]);

  node = $.wrap(node, 'both');
  return new Paren(node, undefined, $.endRule(), $.context);
}

/**
 * The inner content of a guard inside parentheses (similar to Less's guardInner).
 */
export function scssGuardInner(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.scssComparison(ctx) },
    {
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType !== $.T.Not;
      },
      ALT: () => $.value(ctx)
    },
    { ALT: () => $.scssGuardOr(ctx) }
  ]);
}

/**
 * Comparison expression (similar to Less's comparison).
 * Parses comparisons like $a == $b, $a != $b, $a > 10, etc.
 */
export function scssComparison(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const opAlt = [
    { ALT: () => $.CONSUME($.T.NotEq) },   // != (SCSS-specific token)
    { ALT: () => $.CONSUME($.T.EqEq) },    // == (SCSS-specific token, normalized to =)
    { ALT: () => $.CONSUME($.T.Eq) },      // =
    { ALT: () => $.CONSUME($.T.Gt) },      // >
    { ALT: () => $.CONSUME($.T.GtEq) },    // >=
    { ALT: () => $.CONSUME($.T.Lt) },      // <
    { ALT: () => $.CONSUME($.T.LtEq) }     // <=
  ];

  // Use valueList like Less does - it should stop at comparison operators
  // valueList naturally stops when value can't parse the next token (like == or !=)
  let left = $.valueList(ctx) as unknown as Node;
  let op: IToken;
  let right: Node;
  let wasNotEqual = false;

  // Parse comparison operator (always required, like Less)
  op = $.OR(opAlt);
  right = $.valueList(ctx) as unknown as Node;

  let opStr = op.image;
  // Check for != (tokenized as NotEq)
  if (op.tokenType.name === 'NotEq') {
    wasNotEqual = true;
    opStr = '=';
  } else if (opStr === '==') {
    // Normalize == to =
    opStr = '=';
  }
  const cond = new Condition(
    [$.wrap(left, true), opStr as any, $.wrap(right)],
    wasNotEqual ? { negate: true } : undefined,
    $.getLocationFromNodes([left, right]),
    $.context
  );
  return cond;
}
