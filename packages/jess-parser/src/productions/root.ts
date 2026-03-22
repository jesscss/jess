import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import {
  Any,
  Collection,
  Node,
  Rules,
  VarDeclaration,
} from '@jesscss/core';
import type { IToken } from '@jesscss/parser';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

type AltContext = (ctx?: RuleContext) => Array<{ ALT: () => any; GATE?: () => boolean }>;

/**
 * Collection literal body: `{ key: value; ... }` consumed and returned as Rules.
 * Caller must consume the trailing `;`.
 */
export function jessCollection(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
    $.CONSUME($.T.RCurly);
    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    return new Collection(rules.value, undefined, loc, $.context);
  };
}

/**
 * `$var: valueOrCollection;` → VarDeclaration
 */
export function varDeclaration(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const dvTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
    const dvLoc = $.getLocationInfo(dvTok);
    const varName = dvTok.image.slice(1);

    $.CONSUME($.T.Assign); // ':'

    let valueNode: Node;
    if ($.LA(1).tokenType === $.T.LCurly) {
      valueNode = $.SUBRULE($.jessCollection, { ARGS: [ctx] }) as unknown as Node;
    } else {
      valueNode = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
      $.CONSUME($.T.Semi);
    }

    const loc = $.endRule();
    const nameNode = new Any(varName, { role: 'property' }, dvLoc, $.context);
    return new VarDeclaration({ name: nameNode, value: valueNode }, undefined, loc, $.context);
  };
}

/**
 * Bare `$foo[.bar][…];` at statement level — expression statement.
 */
export function jessExprStatement(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    // jessVarWithAccessors handles $var, $var.prop, $var[idx], etc.
    const node = $.SUBRULE($.jessVarWithAccessors, { ARGS: [ctx] }) as unknown as Node;
    $.OPTION(() => $.CONSUME($.T.Semi));
    return node;
  };
}

/**
 * Override SCSS `main` to dispatch Jess-specific constructs first.
 */
export function main(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const jessAlt: AltContext = (innerCtx: RuleContext = {}) => [
      // $if / $while
      {
        GATE: () => {
          const tt = $.LA(1).tokenType;
          return tt === $.T.JessIf || tt === $.T.JessWhile;
        },
        ALT: () => $.SUBRULE($.jessIfStatement, { ARGS: [innerCtx] })
      },
      // $for
      {
        GATE: () => $.LA(1).tokenType === $.T.JessFor,
        ALT: () => $.SUBRULE($.jessForStatement, { ARGS: [innerCtx] })
      },
      // $var: value;  — variable declaration (DollarVariable + Assign)
      {
        GATE: () =>
          $.LA(1).tokenType === $.T.DollarVariable
          && $.isTypeAt(2, $.T.Assign),
        ALT: () => $.SUBRULE($.varDeclaration, { ARGS: [innerCtx] })
      },
      // $ > .mixin()  — mixin call
      {
        GATE: () => $.LA(1).tokenType === $.T.JessDollar,
        ALT: () => $.SUBRULE($.jessMixinCall, { ARGS: [innerCtx] })
      },
      // name() { }  — mixin definition (NOT a CSS qualified rule)
      // `mixin(` is lexed as FunctionStart/GenericFunctionStart; `.mixin(` / `#mixin(` are DotName/HashName + LParen.
      {
        GATE: () => {
          const la1 = $.LA(1).tokenType;
          const la2 = $.LA(2).tokenType;
          return la1 === $.T.FunctionStart
            || la1 === $.T.GenericFunctionStart
            || ((la1 === $.T.PlainIdent || la1 === $.T.DotName || la1 === $.T.HashName) && la2 === $.T.LParen);
        },
        ALT: () => $.SUBRULE($.jessMixinDefinition, { ARGS: [innerCtx] })
      },
      // bare $foo; — expression statement (DollarVariable NOT followed by Assign)
      {
        GATE: () =>
          $.LA(1).tokenType === $.T.DollarVariable
          && !$.isTypeAt(2, $.T.Assign),
        ALT: () => $.SUBRULE($.jessExprStatement, { ARGS: [innerCtx] })
      },
      { ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [innerCtx] }) },
      { ALT: () => $.SUBRULE($.atRule, { ARGS: [innerCtx] }) },
      { ALT: () => $.CONSUME($.T.Semi) }
    ];

    if (ctx.isRoot) {
      $.resetGeneratedState();
    }

    const rules: Node[] = [];
    let requiredSemi = false;
    let lastRule: Node | undefined;

    $.MANY({
      GATE: () => !requiredSemi || (requiredSemi && (
        $.LA(1).tokenType === $.T.Semi
        || $.LA(0).tokenType === $.T.Semi
      )),
      DEF: () => {
        const value = $.OR(jessAlt(ctx));
        if (!(value instanceof Node)) {
          if (lastRule) {
            lastRule.options.semi = true;
          } else {
            rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), $.context));
          }
          return;
        }

        const pending = $.consumePendingNodes();
        if (pending.length) {
          rules.push(...pending);
        }
        requiredSemi = !!value.requiredSemi;
        rules.push(value);
        lastRule = value;
      }
    });

    const withComments = $.getRulesWithComments(rules, $.getLocationInfo($.LA(1)));
    return $.wrap(withComments, true);
  };
}
