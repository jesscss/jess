import type { JessRuleContext as RuleContext } from '../jessRecursiveParser.js';
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
 * Handles: `=`, `>`, `<`, `>=`, `<=`
 */
export function jessComparison(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  const left = $.value(ctx) as unknown as Node;
  const opTok = $.OR([
    { GATE: () => $.LA(1).tokenType === $.T.GtEq, ALT: () => $.CONSUME($.T.GtEq) },
    { GATE: () => $.LA(1).tokenType === $.T.LtEq, ALT: () => $.CONSUME($.T.LtEq) },
    { GATE: () => $.LA(1).tokenType === $.T.Gt,   ALT: () => $.CONSUME($.T.Gt)   },
    { GATE: () => $.LA(1).tokenType === $.T.Lt,   ALT: () => $.CONSUME($.T.Lt)   },
    { GATE: () => $.LA(1).tokenType === $.T.Eq,   ALT: () => $.CONSUME($.T.Eq)   }
  ]) as unknown as IToken;
  const right = $.value(ctx) as unknown as Node;

  const loc = $.endRule();
  const op = opTok.image === '==' ? '=' : opTok.image as Condition['operator'];
  return new Condition([$.wrap(left, true), op, $.wrap(right)], undefined, loc, $.context);
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
      tok.tokenType === $.T.Eq
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
export function jessConditionInParens(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LParen);

  let condNode: Node;
  if (looksLikeComparison($)) {
    condNode = $.jessComparison(ctx) as unknown as Node;
  } else {
    const expr = $.value(ctx) as unknown as Node;
    condNode = new Condition([$.wrap(expr, true)], undefined, $.getLocationFromNodes([expr])!, $.context);
  }

  $.CONSUME($.T.RParen);
  $.endRule();
  return condNode;
}

/**
 * `$if (cond) { rules } [$else if (cond) { rules }]* [$else { rules }]`
 */
export function jessIfStatement(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.JessIf);
  const conditions: Node[] = [];
  const bodies: Rules[] = [];

  const firstCond = $.jessConditionInParens(ctx) as unknown as Node;
  conditions.push(firstCond);
  $.CONSUME($.T.LCurly);
  const firstBody = $.atRuleBody({ ...ctx, inner: true }) as unknown as Rules;
  bodies.push(firstBody);
  $.CONSUME($.T.RCurly);

  let elseBranch: Rules | undefined;

  while ($.LA(1).tokenType === $.T.JessElse) {
    $.CONSUME($.T.JessElse);

    if ($.LA(1).tokenType === $.T.JessIf) {
      // $else if (cond) { ... }
      $.CONSUME($.T.JessIf);
      const cond = $.jessConditionInParens(ctx) as unknown as Node;
      conditions.push(cond);
      $.CONSUME($.T.LCurly);
      const body = $.atRuleBody({ ...ctx, inner: true }) as unknown as Rules;
      bodies.push(body);
      $.CONSUME($.T.RCurly);
    } else {
      // $else { ... }
      $.CONSUME($.T.LCurly);
      elseBranch = $.atRuleBody({ ...ctx, inner: true }) as unknown as Rules;
      $.CONSUME($.T.RCurly);
      break; // $else must be last
    }
  }

  const loc = $.endRule();
  return new If({ conditions, bodies, elseBranch }, undefined, loc, $.context);
}

/**
 * `$for ($var in iterable) { rules }`
 */
export function jessForStatement(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.JessFor);
  $.CONSUME($.T.LParen);

  const loopVarTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
  const varLoc = $.getLocationInfo(loopVarTok);
  const varNameNode = new Any(loopVarTok.image.slice(1), { role: 'property' }, varLoc, $.context);
  const vars = new VarDeclaration(
    { name: varNameNode, value: new Nil(undefined, undefined, varLoc, $.context) },
    undefined,
    varLoc,
    $.context
  );

  $.CONSUME($.T.PlainIdent); // 'in'
  const iterable = $.value(ctx) as unknown as Node;
  $.CONSUME($.T.RParen);

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: true }) as unknown as Rules;
  $.CONSUME($.T.RCurly);

  const loc = $.endRule();
  return new For({ vars, iterable, rules }, undefined, loc, $.context);
}
