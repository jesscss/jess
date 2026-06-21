import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import {
  Any,
  Collection,
  Node,
  Rules,
  VarDeclaration,
  isNode,
  type Node as NodeType
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

type AltContext = (ctx?: RuleContext) => Array<{ ALT: () => any; GATE?: () => boolean }>;

function expectNode(value: unknown): NodeType {
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
  if (
    typeof value === 'object'
    && value !== null
    && 'image' in value
    && 'tokenType' in value
    && 'startOffset' in value
    && 'tokenTypeIdx' in value
    && typeof value.image === 'string'
    && typeof value.startOffset === 'number'
    && typeof value.tokenTypeIdx === 'number'
  ) {
    return true;
  }
  return false;
}

function expectToken(value: unknown): IToken {
  if (isToken(value)) {
    return value;
  }
  throw new Error('Expected parser production to return a token');
}

function isJessMixinDefinitionStart($: P): boolean {
  const la1 = $.LA(1).tokenType;
  const la2 = $.LA(2).tokenType;
  return la1 === $.T.FunctionStart
    || la1 === $.T.GenericFunctionStart
    || ((la1 === $.T.PlainIdent || la1 === $.T.DotName || la1 === $.T.HashName) && la2 === $.T.LParen);
}

/**
 * Collection literal body: `{ key: value; ... }` consumed and returned as Rules.
 * Caller must consume the trailing `;`.
 */
export function jessCollection(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LCurly);
    const rulesValue: unknown = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] });
    $.CONSUME($.T.RCurly);
    $.CONSUME($.T.Semi);
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const rules = expectRules(rulesValue);
    return new Collection(rules.rules, undefined, loc, $.context);
  };
}

/**
 * `$var: valueOrCollection;` → VarDeclaration
 */
export function varDeclaration(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const dvTokenValue: unknown = $.CONSUME($.T.DollarVariable);

    $.CONSUME($.T.Assign); // ':'

    let valueResult: unknown;
    if ($.LA(1).tokenType === $.T.LCurly) {
      valueResult = $.SUBRULE($.jessCollection, { ARGS: [ctx] });
    } else {
      valueResult = $.SUBRULE($.valueList, { ARGS: [ctx] });
      $.CONSUME($.T.Semi);
    }

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const dvTok = expectToken(dvTokenValue);
    const dvLoc = $.getLocationInfo(dvTok);
    const varName = dvTok.image.slice(1);
    const value = expectNode(valueResult);
    const nameNode = new Any(varName, { role: 'property' }, dvLoc, $.context);
    return new VarDeclaration({ name: nameNode, value: value }, undefined, loc, $.context);
  };
}

/**
 * Bare `$foo[.bar][…];` at statement level — expression statement.
 */
export function jessExprStatement(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    // jessVarWithAccessors handles $var, $var.prop, $var[idx], etc.
    const nodeValue: unknown = $.SUBRULE($.jessVarWithAccessors, { ARGS: [ctx] });
    $.OPTION(() => $.CONSUME($.T.Semi));
    return $.RECORDING_PHASE ? undefined : expectNode(nodeValue);
  };
}

/**
 * Override SCSS `main` to dispatch Jess-specific constructs first.
 */
export function main(this: P, _T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const jessAlt: AltContext = (innerCtx: RuleContext = {}) => [
      // $if
      {
        GATE: () => {
          const tt = $.LA(1).tokenType;
          return tt === $.T.JessIf;
        },
        ALT: () => $.SUBRULE($.jessIfStatement, { ARGS: [innerCtx] })
      },
      // $while
      {
        GATE: () => $.LA(1).tokenType === $.T.JessWhile,
        ALT: () => $.SUBRULE($.jessWhileStatement, { ARGS: [innerCtx] })
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
        GATE: () => isJessMixinDefinitionStart($),
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

    const rules: NodeType[] = [];
    let requiredSemi = false;
    let lastRule: NodeType | undefined;

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
    return withComments;
  };
}

export function declarationList(this: P, _T: TokenMap) {
  const $ = this;

  const isJessDeclarationStart = () =>
    $.LA(1).tokenType === $.T.DollarVariable
    || $.LA(1).tokenType === $.T.InterpolationStart
    || $.LA(1).tokenType === $.T.CustomProperty
    || ($.legacyMode && $.LA(1).tokenType === $.T.LegacyPropIdent)
    || (($.LA(1).tokenType === $.T.Ident || $.LA(1).tokenType === $.T.PlainIdent) && !$.shouldTryQualifiedRuleInDeclarationList());

  return (ctx: RuleContext = {}) => {
    const rules: NodeType[] = [];
    let requiredSemi = false;
    let lastRule: NodeType | undefined;

    $.MANY({
      GATE: () => !requiredSemi || (requiredSemi && (
        $.LA(1).tokenType === $.T.Semi
        || $.LA(0).tokenType === $.T.Semi
      )),
      DEF: () => {
        let value: unknown;

        if ($.RECORDING_PHASE) {
          value = $.OR([
            {
              GATE: () => $.LA(1).tokenType === $.T.JessIf,
              ALT: () => $.SUBRULE($.jessIfStatement, { ARGS: [{ ...ctx, inner: true }] })
            },
            {
              GATE: () => $.LA(1).tokenType === $.T.JessFor,
              ALT: () => $.SUBRULE($.jessForStatement, { ARGS: [{ ...ctx, inner: true }] })
            },
            {
              GATE: () => $.LA(1).tokenType === $.T.JessWhile,
              ALT: () => $.SUBRULE($.jessWhileStatement, { ARGS: [{ ...ctx, inner: true }] })
            },
            { ALT: () => $.SUBRULE($.innerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
            {
              GATE: () => isJessMixinDefinitionStart($),
              ALT: () => $.SUBRULE($.jessMixinDefinition, { ARGS: [{ ...ctx, inner: true }] })
            },
            {
              GATE: () => !isJessDeclarationStart(),
              ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] })
            },
            {
              GATE: () => isJessDeclarationStart(),
              ALT: () => $.SUBRULE($.declaration, { ARGS: [ctx] })
            },
            { ALT: () => $.CONSUME($.T.Semi) }
          ]);
        } else if ($.LA(1).tokenType === $.T.JessIf) {
          value = $.SUBRULE($.jessIfStatement, { ARGS: [{ ...ctx, inner: true }] });
        } else if ($.LA(1).tokenType === $.T.JessFor) {
          value = $.SUBRULE($.jessForStatement, { ARGS: [{ ...ctx, inner: true }] });
        } else if ($.LA(1).tokenType === $.T.JessWhile) {
          value = $.SUBRULE($.jessWhileStatement, { ARGS: [{ ...ctx, inner: true }] });
        } else if ($.LA(1).tokenType === $.T.Semi) {
          value = $.CONSUME($.T.Semi);
        } else if ($.isTypeAt(1, $.T.AtName)) {
          value = $.SUBRULE($.innerAtRule, { ARGS: [{ ...ctx, inner: true }] });
        } else if (isJessMixinDefinitionStart($)) {
          value = $.SUBRULE($.jessMixinDefinition, { ARGS: [{ ...ctx, inner: true }] });
        } else if (isJessDeclarationStart()) {
          value = $.SUBRULE($.declaration, { ARGS: [ctx] });
        } else {
          value = $.SUBRULE($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] });
        }

        if (!(value instanceof Node)) {
          if (lastRule) {
            lastRule.options.semi = true;
          } else if (!$.RECORDING_PHASE) {
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

    if ($.RECORDING_PHASE) {
      return;
    }

    const withComments = $.getRulesWithComments(rules, $.getLocationInfo($.LA(1)));
    return withComments;
  };
}
