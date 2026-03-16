import type { JessRuleContext as RuleContext } from '../jessRecursiveParser.js';
import { tokenMatches } from '@jesscss/parser';
import { ScssRecursiveParser } from '@jesscss/scss-parser';
import {
  Any,
  Collection,
  Rules,
  VarDeclaration,
  type Node
} from '@jesscss/core';
import type { IToken } from '@jesscss/parser';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

type AltContext = (ctx?: RuleContext) => Array<{ ALT: () => any; GATE?: () => boolean }>;

const scssMain = ScssRecursiveParser.prototype.main as Function;

/**
 * Collection literal body: `{ key: value; ... }` consumed and returned as Rules.
 * Caller must consume the trailing `;`.
 */
export function jessCollection(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: true }) as unknown as Rules;
  $.CONSUME($.T.RCurly);
  $.CONSUME($.T.Semi);
  const loc = $.endRule();
  return new Collection(rules, undefined, loc, $.context);
}

/**
 * `$var: valueOrCollection;` → VarDeclaration
 */
export function varDeclaration(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  const dvTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
  const dvLoc = $.getLocationInfo(dvTok);
  const varName = dvTok.image.slice(1);

  $.CONSUME($.T.Assign); // ':'

  let valueNode: Node;
  if ($.LA(1).tokenType === $.T.LCurly) {
    valueNode = $.jessCollection(ctx) as unknown as Node;
  } else {
    valueNode = $.valueList(ctx) as unknown as Node;
    $.CONSUME($.T.Semi);
  }

  const loc = $.endRule();
  const nameNode = new Any(varName, { role: 'property' }, dvLoc, $.context);
  return new VarDeclaration({ name: nameNode, value: valueNode }, undefined, loc, $.context);
}

/**
 * Bare `$foo[.bar][…];` at statement level — expression statement.
 */
export function jessExprStatement(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // jessVarWithAccessors handles $var, $var.prop, $var[idx], etc.
  const node = $.jessVarWithAccessors(ctx) as unknown as Node;
  $.OPTION(() => $.CONSUME($.T.Semi));
  return node;
}

/**
 * Override SCSS `main` to dispatch Jess-specific constructs first.
 */
export function main(this: P, ctx: RuleContext = {}, alt?: AltContext) {
  const $ = this;

  // Jess dispatch goes BEFORE SCSS so it runs on each iteration of the main loop.
  // We pass our Jess alternatives as the `alt` parameter to scssMain.
  const jessAlt: AltContext = (innerCtx: RuleContext = {}) => [
    // $if / $while
    {
      GATE: () => {
        const tt = $.LA(1).tokenType;
        return tt === $.T.JessIf || tt === $.T.JessWhile;
      },
      ALT: () => $.jessIfStatement(innerCtx)
    },
    // $for
    {
      GATE: () => $.LA(1).tokenType === $.T.JessFor,
      ALT: () => $.jessForStatement(innerCtx)
    },
    // $var: value;  — variable declaration (DollarVariable + Assign)
    {
      GATE: () =>
        $.LA(1).tokenType === $.T.DollarVariable
        && $.checkAt(2, $.T.Assign),
      ALT: () => $.varDeclaration(innerCtx)
    },
    // $ > .mixin()  — mixin call
    {
      GATE: () => $.LA(1).tokenType === $.T.JessDollar,
      ALT: () => $.jessMixinCall(innerCtx)
    },
    // name() { }  — mixin definition (NOT a CSS qualified rule)
    // `mixin(` is lexed as FunctionStart/GenericFunctionStart; `.mixin(` / `#mixin(` are DotName/HashName + LParen.
    {
      GATE: () => {
        const la1 = $.LA(1).tokenType;
        const la2 = $.LA(2).tokenType;
        return tokenMatches($.LA(1), $.T.FunctionStart)
          || tokenMatches($.LA(1), $.T.GenericFunctionStart)
          || ((la1 === $.T.PlainIdent || la1 === $.T.DotName || la1 === $.T.HashName) && la2 === $.T.LParen);
      },
      ALT: () => $.jessMixinDefinition(innerCtx)
    },
    // bare $foo; — expression statement (DollarVariable NOT followed by Assign)
    {
      GATE: () =>
        $.LA(1).tokenType === $.T.DollarVariable
        && !$.checkAt(2, $.T.Assign),
      ALT: () => $.jessExprStatement(innerCtx)
    },
    // Caller-supplied alternatives (e.g. from atRuleBody)
    ...(alt?.(innerCtx) ?? []),
    // SCSS/CSS defaults — must always be included since scssMain's alt??= is bypassed
    { ALT: () => $.declaration(innerCtx) },
    { ALT: () => $.qualifiedRule() },
    { ALT: () => $.atRule() },
    { ALT: () => $.CONSUME($.T.Semi) }
  ];

  return scssMain.call($, ctx, jessAlt);
}
