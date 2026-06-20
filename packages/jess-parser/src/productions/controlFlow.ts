import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import {
  Any,
  Condition,
  For,
  If,
  Nil,
  Rules,
  VarDeclaration,
  While,
  isNode,
  type Node
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;
type Production<T = unknown> = (ctx?: RuleContext) => T | undefined;

function expectNode(value: unknown): Node {
  if (isNode(value)) {
    return value;
  }
  throw new Error('Expected parser production to return a Jess node');
}

function expectRules(value: unknown): Rules {
  if (value instanceof Rules) {
    return value;
  }
  throw new Error('Expected parser production to return Rules');
}

function isToken(value: unknown): value is IToken {
  return typeof value === 'object'
    && value !== null
    && 'image' in value
    && 'tokenType' in value;
}

function expectToken(value: unknown): IToken {
  if (isToken(value)) {
    return value;
  }
  throw new Error('Expected parser production to return a token');
}

function normalizeComparisonOperator(image: string): '=' | '>' | '<' | '>=' | '<=' {
  if (image === '==' || image === '!=') {
    return '=';
  }
  if (image === '=' || image === '>' || image === '<' || image === '>=' || image === '<=') {
    return image;
  }
  throw new Error(`Unsupported comparison operator: ${image}`);
}

/**
 * Comparison: `value op value` → Condition.
 * Handles: `=`, `==`, `!=`, `>`, `<`, `>=`, `<=`
 */
export function jessComparison(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const leftValue: unknown = $.SUBRULE($.value, { ARGS: [ctx] });
    let opValue: unknown;
    if ($.RECORDING_PHASE) {
      opValue = $.OR([
        { ALT: () => $.CONSUME($.T.NotEq) },
        { ALT: () => $.CONSUME($.T.EqEq) },
        { ALT: () => $.CONSUME($.T.GtEq) },
        { ALT: () => $.CONSUME($.T.LtEq) },
        { ALT: () => $.CONSUME($.T.Gt) },
        { ALT: () => $.CONSUME($.T.Lt) },
        { ALT: () => $.CONSUME($.T.Eq) }
      ]);
    } else if ($.isType($.T.NotEq)) {
      opValue = $.CONSUME($.T.NotEq);
    } else if ($.isType($.T.EqEq)) {
      opValue = $.CONSUME($.T.EqEq);
    } else if ($.isType($.T.GtEq)) {
      opValue = $.CONSUME($.T.GtEq);
    } else if ($.isType($.T.LtEq)) {
      opValue = $.CONSUME($.T.LtEq);
    } else if ($.isType($.T.Gt)) {
      opValue = $.CONSUME($.T.Gt);
    } else if ($.isType($.T.Lt)) {
      opValue = $.CONSUME($.T.Lt);
    } else {
      opValue = $.CONSUME($.T.Eq);
    }
    const rightValue: unknown = $.SUBRULE($.value, { ARGS: [ctx] });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const left = expectNode(leftValue);
    const opTok = expectToken(opValue);
    const right = expectNode(rightValue);
    const negate = opTok.tokenType.name === 'NotEq';
    const op = normalizeComparisonOperator(opTok.image);
    return new Condition([left, op, right], negate ? { negate: true } : undefined, loc, $.context);
  };
}

/** Look-ahead: does `(...)` contain a comparison operator? */
function looksLikeComparison($: P) {
  for (let i = 2; i < 32; i++) {
    const tok = $.LA(i);
    if (!tok || tok.tokenType.name === 'EOF') {
      return false;
    }
    if (tok.tokenType === $.T.RParen || tok.tokenType === $.T.LCurly) {
      return false;
    }
    if (
      tok.tokenType === $.T.NotEq
      || tok.tokenType === $.T.EqEq
      || tok.tokenType === $.T.Eq
      ||   tok.tokenType === $.T.Gt
      ||   tok.tokenType === $.T.Lt
      ||   tok.tokenType === $.T.GtEq
      || tok.tokenType === $.T.LtEq
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Condition in parens: `(comparison)` → Condition, or `(expr)` → Condition([expr])
 */
export function jessConditionInParens(this: P, _T: TokenMap): Production<Node> {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LParen);

    let condValue: unknown;
    let parsedCondition: Node | undefined;
    if (looksLikeComparison($)) {
      condValue = $.SUBRULE($.jessComparison, { ARGS: [ctx] });
    } else {
      const exprValue: unknown = $.SUBRULE($.value, { ARGS: [ctx] });
      if ($.RECORDING_PHASE) {
        $.CONSUME($.T.RParen);
        $.endRule();
        return;
      }
      const expr = expectNode(exprValue);
      parsedCondition = new Condition([expr], undefined, $.getLocationFromNodes([expr])!, $.context);
    }

    $.CONSUME($.T.RParen);
    $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const condNode = condValue !== undefined
      ? expectNode(condValue)
      : parsedCondition;
    return condNode;
  };
}

/**
 * `$if (cond) { rules } [$else if (cond) { rules }]* [$else { rules }]`
 */
export function jessIfStatement(this: P, _T: TokenMap): Production<If | Rules> {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.JessIf);
    const conditions: unknown[] = [];
    const bodies: unknown[] = [];

    const firstCond: unknown = $.SUBRULE($.jessConditionInParens, { ARGS: [ctx] });
    conditions.push(firstCond);
    $.CONSUME($.T.LCurly);
    const firstBody: unknown = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
    bodies.push(firstBody);
    $.CONSUME($.T.RCurly);

    let elseBranch: unknown;

    while ($.LA(1).tokenType === $.T.JessElse) {
      $.CONSUME($.T.JessElse);

      if ($.LA(1).tokenType === $.T.JessIf) {
        // $else if (cond) { ... }
        $.CONSUME($.T.JessIf);
        const cond: unknown = $.SUBRULE($.jessConditionInParens, { ARGS: [ctx] });
        conditions.push(cond);
        $.CONSUME($.T.LCurly);
        const body: unknown = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
        bodies.push(body);
        $.CONSUME($.T.RCurly);
      } else {
        // $else { ... }
        $.CONSUME($.T.LCurly);
        elseBranch = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
        $.CONSUME($.T.RCurly);
        break; // $else must be last
      }
    }

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const resolvedConditions = conditions.map(condition => expectNode(condition));
    const resolvedBodies = bodies.map(body => expectRules(body));
    let elseNode: If | Rules | undefined = elseBranch ? expectRules(elseBranch) : undefined;
    for (let index = resolvedConditions.length - 1; index >= 0; index--) {
      elseNode = new If({
        condition: resolvedConditions[index]!,
        rules: resolvedBodies[index]!.rules,
        else: elseNode
      }, undefined, loc, $.context);
    }
    return elseNode;
  };
}

/**
 * `$while (cond) { rules }`
 */
export function jessWhileStatement(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.JessWhile);
    const conditionValue: unknown = $.SUBRULE($.jessConditionInParens, { ARGS: [ctx] });
    $.CONSUME($.T.LCurly);
    const rulesValue: unknown = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new While({
      condition: expectNode(conditionValue),
      rules: expectRules(rulesValue).rules
    }, undefined, loc, $.context);
  };
}

/**
 * `$for ($var in iterable) { rules }`
 */
export function jessForStatement(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.JessFor);
    $.CONSUME($.T.LParen);

    const loopVarValue: unknown = $.CONSUME($.T.DollarVariable);

    $.CONSUME($.T.PlainIdent); // 'in'
    const iterableValue: unknown = $.SUBRULE($.value, { ARGS: [ctx] });
    $.CONSUME($.T.RParen);

    $.CONSUME($.T.LCurly);
    const rulesValue: unknown = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const loopVarTok = expectToken(loopVarValue);
    const iterable = expectNode(iterableValue);
    const rules = expectRules(rulesValue);
    const varLoc = $.getLocationInfo(loopVarTok);
    const varNameNode = new Any(loopVarTok.image.slice(1), { role: 'property' }, varLoc, $.context);
    const vars = new VarDeclaration(
      { name: varNameNode, value: new Nil(undefined, undefined, varLoc, $.context) },
      undefined,
      varLoc,
      $.context
    );
    return new For({
      pattern: { kind: 'single', value: vars },
      iterable: { kind: 'node', value: iterable },
      rules: rules.rules
    }, undefined, loc, $.context);
  };
}
