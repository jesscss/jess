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
  ctx.allowComma = true;
  const guardNode = this.scssGuardOr(ctx) as unknown as Node;
  // The guardNode is already wrapped in Paren by scssGuardInParens
  return guardNode;
}

/**
 * 'or' expression (similar to Less's guardOr).
 * Allows comma-separated conditions like historical media queries.
 */
export function scssGuardOr(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let left = this.scssGuardAnd(ctx) as unknown as Node;
  let right: Node | undefined;
  this.many({
    GATE: () => {
      const next = this.la(1).tokenType;
      return (ctx.allowComma && next === this.T.Comma) || next === this.T.Or;
    },
    DEF: () => {
      /**
       * Nest expressions within expressions for correct
       * order of operations.
       */
      this.or([
        { ALT: () => this.consume(this.T.Comma) },
        { ALT: () => this.consume(this.T.Or) }
      ]);
      right = this.scssGuardAnd(ctx) as unknown as Node;
      let location = this.endRule();
      this.startRule();
      left = new Condition(
        [this.wrap(left, true), 'or', this.wrap(right!)],
        undefined,
        location,
        this.context
      );
    }
  });
  this.endRule();
  return left;
}

/**
 * 'and' expression (similar to Less's guardAnd).
 */
export function scssGuardAnd(this: P, ctx: RuleContext = {}) {
  let left: Node | undefined;
  this.manySep({
    SEP: this.T.And,
    DEF: () => {
      let not: IToken | undefined;
      this.option(() => (not = this.consume(this.T.Not)));
      let allowComma = ctx.allowComma;
      ctx.allowComma = false;
      let right = this.scssGuardInParens(ctx) as unknown as Node;
      ctx.allowComma = allowComma;
      if (not) {
        let [,,, endOffset, endLine, endColumn] = right.location!;
        let [startOffset, startLine, startColumn] = this.getLocationInfo(not);
        right = new Condition(
          [right],
          { negate: true },
          [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
          this.context
        );
      }
      if (!left) {
        left = right;
        return;
      }
      left = new Condition(
        [this.wrap(left, true), 'and', this.wrap(right)],
        undefined,
        this.getLocationFromNodes([left, right]),
        this.context
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
  this.startRule();
  // Like Less: handle parenthesized content, or fall through to comparison
  // For non-parenthesized content, try comparison first (it will fail if there's no operator), then fall back to value
  let node = this.or([
    {
      ALT: () => {
        this.consume(this.T.LParen);
        let innerNode = this.scssGuardInner(ctx) as unknown as Node;
        this.consume(this.T.RParen);
        return innerNode;
      }
    },
    {
      // Try comparison first - it requires an operator, so it will fail if there isn't one
      GATE: () => looksLikeScssComparison(this, this.T),
      ALT: () => {
        return this.scssComparison(ctx);
      }
    },
    {
      // Fallback: just a value (no comparison operator)
      ALT: () => {
        return this.value(ctx);
      }
    }
  ]);

  node = this.wrap(node, 'both');
  return new Paren(node, undefined, this.endRule(), this.context);
}

/**
 * The inner content of a guard inside parentheses (similar to Less's guardInner).
 */
export function scssGuardInner(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.scssComparison(ctx) },
    {
      GATE: () => {
        let tokenType = this.la(1).tokenType;
        return tokenType !== this.T.Not;
      },
      ALT: () => this.value(ctx)
    },
    { ALT: () => this.scssGuardOr(ctx) }
  ]);
}

/**
 * Comparison expression (similar to Less's comparison).
 * Parses comparisons like $a == $b, $a != $b, $a > 10, etc.
 */
export function scssComparison(this: P, ctx: RuleContext = {}) {
  const opAlt = [
    { ALT: () => this.consume(this.T.NotEq) },   // != (SCSS-specific token)
    { ALT: () => this.consume(this.T.EqEq) },    // == (SCSS-specific token, normalized to =)
    { ALT: () => this.consume(this.T.Eq) },      // =
    { ALT: () => this.consume(this.T.Gt) },      // >
    { ALT: () => this.consume(this.T.GtEq) },    // >=
    { ALT: () => this.consume(this.T.Lt) },      // <
    { ALT: () => this.consume(this.T.LtEq) }     // <=
  ];

  // Use valueList like Less does - it should stop at comparison operators
  // valueList naturally stops when value can't parse the next token (like == or !=)
  let left = this.valueList(ctx) as unknown as Node;
  let op: IToken;
  let right: Node;
  let wasNotEqual = false;

  // Parse comparison operator (always required, like Less)
  op = this.or(opAlt);
  right = this.valueList(ctx) as unknown as Node;

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
    [this.wrap(left, true), opStr as any, this.wrap(right)],
    wasNotEqual ? { negate: true } : undefined,
    this.getLocationFromNodes([left, right]),
    this.context
  );
  return cond;
}
