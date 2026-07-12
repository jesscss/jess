import type { RuleContext } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
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
  const condNode = $.scssConditionOr(ctx) as unknown as Node;
  return condNode;
}

/**
 * 'or' expression — handles `or` keyword and comma-separated conditions
 * (comma is allowed in @if for historical media-query-style syntax).
 */
export function scssConditionOr(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let left = $.scssConditionAnd(ctx) as unknown as Node;
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
      right = $.scssConditionAnd(ctx) as unknown as Node;
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
 * 'and' expression — handles `and` keyword with optional `not` prefix.
 */
export function scssConditionAnd(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let left: Node | undefined;
  $.MANY_SEP({
    SEP: $.T.And,
    DEF: () => {
      let not: IToken | undefined;
      $.OPTION(() => (not = $.CONSUME($.T.Not)));
      let allowComma = ctx.allowComma;
      ctx.allowComma = false;
      let right = $.scssConditionInParens(ctx) as unknown as Node;
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
 * A single condition term: either a parenthesized sub-expression,
 * a comparison, or a bare value.
 */
export function scssConditionInParens(this: P, ctx: RuleContext) {
  const $ = this;
  $.startRule();
  let node = $.OR([
    {
      ALT: () => {
        $.CONSUME($.T.LParen);
        let innerNode = $.scssConditionInner(ctx) as unknown as Node;
        $.CONSUME($.T.RParen);
        return innerNode;
      }
    },
    {
      GATE: () => looksLikeScssComparison($, $.T),
      ALT: () => {
        return $.scssComparison(ctx);
      }
    },
    {
      ALT: () => {
        return $.value(ctx);
      }
    }
  ]);

  node = $.wrap(node, 'both');
  return new Paren(node, undefined, $.endRule(), $.context);
}

/**
 * The inner content of a parenthesized condition — a comparison,
 * a bare value, or a nested or-expression.
 */
export function scssConditionInner(this: P, ctx: RuleContext = {}) {
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
    { ALT: () => $.scssConditionOr(ctx) }
  ]);
}

/**
 * Comparison expression — parses `$a == $b`, `$a != $b`, `$a > 10`, etc.
 */
export function scssComparison(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const opAlt = [
    { ALT: () => $.CONSUME($.T.NotEq) },   // !=  (normalized to = with negate)
    { ALT: () => $.CONSUME($.T.EqEq) },    // ==  (normalized to =)
    { ALT: () => $.CONSUME($.T.Eq) },      // =
    { ALT: () => $.CONSUME($.T.Gt) },      // >
    { ALT: () => $.CONSUME($.T.GtEq) },    // >=
    { ALT: () => $.CONSUME($.T.Lt) },      // <
    { ALT: () => $.CONSUME($.T.LtEq) }     // <=
  ];

  let left = $.valueList(ctx) as unknown as Node;
  let op: IToken;
  let right: Node;
  let wasNotEqual = false;

  op = $.OR(opAlt);
  right = $.valueList(ctx) as unknown as Node;

  let opStr = op.image;
  if (op.tokenType.name === 'NotEq') {
    wasNotEqual = true;
    opStr = '=';
  } else if (opStr === '==') {
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
