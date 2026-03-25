import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import {
  Any,
  Condition,
  For,
  If,
  Nil,
  Rules,
  VarDeclaration,
  type Node
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

/**
 * Comparison: `value op value` → Condition.
 * Handles: `=`, `==`, `!=`, `>`, `<`, `>=`, `<=`
 */
export function jessComparison(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const left = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
    let opTok: IToken;
    if ($.RECORDING_PHASE) {
      opTok = $.OR([
        { ALT: () => $.CONSUME($.T.NotEq) },
        { ALT: () => $.CONSUME($.T.EqEq) },
        { ALT: () => $.CONSUME($.T.GtEq) },
        { ALT: () => $.CONSUME($.T.LtEq) },
        { ALT: () => $.CONSUME($.T.Gt) },
        { ALT: () => $.CONSUME($.T.Lt) },
        { ALT: () => $.CONSUME($.T.Eq) }
      ]) as unknown as IToken;
    } else if ($.isType($.T.NotEq)) {
      opTok = $.CONSUME($.T.NotEq) as unknown as IToken;
    } else if ($.isType($.T.EqEq)) {
      opTok = $.CONSUME($.T.EqEq) as unknown as IToken;
    } else if ($.isType($.T.GtEq)) {
      opTok = $.CONSUME($.T.GtEq) as unknown as IToken;
    } else if ($.isType($.T.LtEq)) {
      opTok = $.CONSUME($.T.LtEq) as unknown as IToken;
    } else if ($.isType($.T.Gt)) {
      opTok = $.CONSUME($.T.Gt) as unknown as IToken;
    } else if ($.isType($.T.Lt)) {
      opTok = $.CONSUME($.T.Lt) as unknown as IToken;
    } else {
      opTok = $.CONSUME($.T.Eq) as unknown as IToken;
    }
    const right = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const negate = opTok.tokenType.name === 'NotEq';
    const op = (opTok.image === '==' || opTok.image === '!=') ? '=' : opTok.image;
    return new Condition([$.wrap(left, true), op as '=' | '>' | '<' | '>=' | '<=', $.wrap(right)], negate ? { negate: true } : undefined, loc, $.context);
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
export function jessConditionInParens(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LParen);

    let condNode: Node;
    if (looksLikeComparison($)) {
      condNode = $.SUBRULE($.jessComparison, { ARGS: [ctx] }) as unknown as Node;
    } else {
      const expr = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
      if ($.RECORDING_PHASE) {
        $.CONSUME($.T.RParen);
        $.endRule();
        return;
      }
      condNode = new Condition([$.wrap(expr, true)], undefined, $.getLocationFromNodes([expr])!, $.context);
    }

    $.CONSUME($.T.RParen);
    $.endRule();
    return condNode;
  };
}

/**
 * `$if (cond) { rules } [$else if (cond) { rules }]* [$else { rules }]`
 */
export function jessIfStatement(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.JessIf);
    const conditions: Node[] = [];
    const bodies: Rules[] = [];

    const firstCond = $.SUBRULE($.jessConditionInParens, { ARGS: [ctx] }) as unknown as Node;
    conditions.push(firstCond);
    $.CONSUME($.T.LCurly);
    const firstBody = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
    bodies.push(firstBody);
    $.CONSUME($.T.RCurly);

    let elseBranch: Rules | undefined;

    while ($.LA(1).tokenType === $.T.JessElse) {
      $.CONSUME($.T.JessElse);

      if ($.LA(1).tokenType === $.T.JessIf) {
        // $else if (cond) { ... }
        $.CONSUME($.T.JessIf);
        const cond = $.SUBRULE($.jessConditionInParens, { ARGS: [ctx] }) as unknown as Node;
        conditions.push(cond);
        $.CONSUME($.T.LCurly);
        const body = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
        bodies.push(body);
        $.CONSUME($.T.RCurly);
      } else {
        // $else { ... }
        $.CONSUME($.T.LCurly);
        elseBranch = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
        $.CONSUME($.T.RCurly);
        break; // $else must be last
      }
    }

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new If({ conditions, bodies, elseBranch }, undefined, loc, $.context);
  };
}

/**
 * `$for ($var in iterable) { rules }`
 */
export function jessForStatement(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.JessFor);
    $.CONSUME($.T.LParen);

    const loopVarTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;

    $.CONSUME($.T.PlainIdent); // 'in'
    const iterable = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
    $.CONSUME($.T.RParen);

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const varLoc = $.getLocationInfo(loopVarTok);
    const varNameNode = new Any(loopVarTok.image.slice(1), { role: 'property' }, varLoc, $.context);
    const vars = new VarDeclaration(
      { name: varNameNode, value: new Nil(undefined, undefined, varLoc, $.context) },
      undefined,
      varLoc,
      $.context
    );
    return new For({ vars, iterable, rules }, undefined, loc, $.context);
  };
}
