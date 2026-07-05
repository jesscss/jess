import type { RuleContext, TokenMap } from '../scssRecursiveParser.js';
import type { IToken } from 'chevrotain';
import {
  Condition,
  Paren,
  type Node
} from '@jesscss/core';
import { looksLikeScssComparison } from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;
type ProductionRule = (ctx?: RuleContext) => any;

export function scssCondition(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    ctx.allowComma = true;
    return $.SUBRULE($.scssConditionOr, { ARGS: [ctx] }) as unknown as Node;
  };
}

/**
 * 'or' expression — handles `or` keyword and comma-separated conditions
 * (comma is allowed in @if for historical media-query-style syntax).
 */
export function scssConditionOr(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let left = $.SUBRULE($.scssConditionAnd, { ARGS: [ctx] }) as unknown as Node;
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
        right = $.SUBRULE($.scssConditionAnd, { ARGS: [ctx] }) as unknown as Node;
        let location = $.endRule();
        $.startRule();
        left = new Condition(
          [left, 'or', right!],
          undefined,
          location,
          $.context
        );
      }
    });
    $.endRule();
    return left;
  };
}

/**
 * 'and' expression — handles `and` keyword with optional `not` prefix.
 */
export function scssConditionAnd(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let left: Node | undefined;
    $.MANY_SEP({
      SEP: $.T.And,
      DEF: () => {
        let not: IToken | undefined;
        $.OPTION(() => (not = $.CONSUME($.T.Not)));
        let allowComma = ctx.allowComma;
        ctx.allowComma = false;
        let right = $.SUBRULE($.scssConditionInParens, { ARGS: [ctx] }) as unknown as Node;
        ctx.allowComma = allowComma;
        if ($.RECORDING_PHASE) {
          if (!left) {
            left = right;
          }
          return;
        }
        if (not) {
          const [, , , endOffset, endLine, endColumn] = right.location as [number, number, number, number, number, number];
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
          [left, 'and', right],
          undefined,
          $.getLocationFromNodes([left, right]),
          $.context
        );
      }
    });
    return left!;
  };
}

/**
 * A single condition term: either a parenthesized sub-expression,
 * a comparison, or a bare value.
 */
export function scssConditionInParens(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext) => {
    $.startRule();
    let node = $.OR([
      {
        ALT: () => {
          $.CONSUME($.T.LParen);
          let innerNode = $.SUBRULE($.scssConditionInner, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME($.T.RParen);
          return innerNode;
        }
      },
      {
        GATE: () => looksLikeScssComparison($, $.T),
        ALT: () => {
          return $.SUBRULE($.scssComparison, { ARGS: [ctx] }) as unknown as Node;
        }
      },
      {
        ALT: () => {
          return $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
        }
      }
    ]);

    node = node;
    return new Paren(node, undefined, $.endRule(), $.context);
  };
}

/**
 * The inner content of a parenthesized condition — a comparison,
 * a bare value, or a nested or-expression.
 */
export function scssConditionInner(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    { ALT: () => $.SUBRULE($.scssComparison, { ARGS: [ctx] }) },
    {
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType !== $.T.Not;
      },
      ALT: () => $.SUBRULE($.value, { ARGS: [ctx] })
    },
    { ALT: () => $.SUBRULE($.scssConditionOr, { ARGS: [ctx] }) }
  ]);
}

/**
 * Comparison expression — parses `$a == $b`, `$a != $b`, `$a > 10`, etc.
 */
export function scssComparison(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let left = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
    let op: IToken;
    let right: Node;
    let wasNotEqual = false;

    if ($.RECORDING_PHASE) {
      op = $.OR([
        { ALT: () => $.CONSUME($.T.NotEq) },
        { ALT: () => $.CONSUME($.T.EqEq) },
        { ALT: () => $.CONSUME($.T.Eq) },
        { ALT: () => $.CONSUME($.T.GtEq) },
        { ALT: () => $.CONSUME($.T.Gt) },
        { ALT: () => $.CONSUME($.T.LtEq) },
        { ALT: () => $.CONSUME($.T.Lt) }
      ]) as unknown as IToken;
    } else if ($.isType($.T.NotEq)) {
      op = $.CONSUME($.T.NotEq) as unknown as IToken;
    } else if ($.isType($.T.EqEq)) {
      op = $.CONSUME($.T.EqEq) as unknown as IToken;
    } else if ($.isType($.T.Eq)) {
      op = $.CONSUME($.T.Eq) as unknown as IToken;
    } else if ($.isType($.T.GtEq)) {
      op = $.CONSUME($.T.GtEq) as unknown as IToken;
    } else if ($.isType($.T.Gt)) {
      op = $.CONSUME($.T.Gt) as unknown as IToken;
    } else if ($.isType($.T.LtEq)) {
      op = $.CONSUME($.T.LtEq) as unknown as IToken;
    } else {
      op = $.CONSUME($.T.Lt) as unknown as IToken;
    }

    right = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;

    if ($.RECORDING_PHASE) {
      return left;
    }

    let opStr = op.image;
    if (op.tokenType.name === 'NotEq') {
      wasNotEqual = true;
      opStr = '=';
    } else if (opStr === '==') {
      opStr = '=';
    }
    const cond = new Condition(
      [left, opStr as any, right],
      wasNotEqual ? { negate: true } : undefined,
      $.getLocationFromNodes([left, right]),
      $.context
    );
    return cond;
  };
}
