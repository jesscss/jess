import type { JessRuleContext as RuleContext } from '../jessRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import { tokenMatches } from '@jesscss/parser';
import {
  Any,
  Call,
  Condition,
  List,
  Mixin,
  Reference,
  Rules,
  VarDeclaration,
  Nil,
  type Node
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

/**
 * Parse mixin parameter list: `($var[: default], ...)` or empty.
 * Returns an array of VarDeclaration nodes.
 * @param skipLParen - When true, the leading `(` was already consumed (e.g. as part of a Function token).
 */
export function jessMixinParams(this: P, ctx: RuleContext = {}, skipLParen = false): Node[] {
  const $ = this;
  const params: Node[] = [];
  if (!skipLParen) {
    $.CONSUME($.T.LParen);
  }
  $.OPTION(() => {
    $.AT_LEAST_ONE_SEP({
      SEP: $.T.Comma,
      DEF: () => {
        const paramTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
        const paramLoc = $.getLocationInfo(paramTok);
        const varName = paramTok.image.slice(1);
        let defaultValue: Node | undefined;
        $.OPTION(() => {
          if (!tokenMatches($.LA(1), $.T.Assign)) {
            return;
          }
          $.CONSUME($.T.Assign); // ':'
          defaultValue = $.value(ctx) as unknown as Node;
        });
        const nameNode = new Any(varName, { role: 'property' }, paramLoc, $.context);
        const decl = new VarDeclaration(
          { name: nameNode, value: (defaultValue ?? new Nil(undefined, undefined, paramLoc, $.context)) as any },
          undefined,
          paramLoc,
          $.context
        );
        params.push(decl);
      }
    });
  });
  $.CONSUME($.T.RParen);
  return params;
}

/**
 * Parse mixin guard: `when (condition)` → Condition
 */
export function jessGuard(this: P, ctx: RuleContext = {}): Condition {
  const $ = this;
  $.CONSUME($.T.PlainIdent); // 'when'
  return $.jessConditionInParens(ctx) as unknown as Condition;
}

/**
 * Mixin definition: `[.#]name([params]) [when (guard)] { rules }`
 *
 * Handles: `mixin() {}`, `.mixin() {}`, `#mixin() {}`, `mixin($x) when ($x > 0) {}`
 */
export function jessMixinDefinition(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let nameTok: IToken;
  let isFunctionToken = false;

  if (tokenMatches($.LA(1), $.T.FunctionStart) || tokenMatches($.LA(1), $.T.GenericFunctionStart)) {
    // `mixin(` is lexed as FunctionStart/GenericFunctionStart; the `(` is part of the token.
    nameTok = $.OR([
      { GATE: () => tokenMatches($.LA(1), $.T.FunctionStart), ALT: () => $.CONSUME($.T.FunctionStart) },
      { ALT: () => $.CONSUME($.T.GenericFunctionStart) }
    ]) as unknown as IToken;
    isFunctionToken = true;
  } else {
    nameTok = $.OR([
      { GATE: () => $.LA(1).tokenType === $.T.DotName,  ALT: () => $.CONSUME($.T.DotName)  },
      { GATE: () => $.LA(1).tokenType === $.T.HashName, ALT: () => $.CONSUME($.T.HashName) },
      { ALT: () => $.CONSUME($.T.PlainIdent) }
    ]) as unknown as IToken;
  }
  const nameLoc = $.getLocationInfo(nameTok);
  // FunctionStart/GenericFunctionStart image is `name(` — strip the trailing `(`.
  const nameImage = isFunctionToken ? nameTok.image.slice(0, -1) : nameTok.image;

  const params = $.jessMixinParams(ctx, isFunctionToken);

  let guard: Condition | undefined;
  if ($.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'when') {
    guard = $.jessGuard(ctx) as unknown as Condition;
  }

  $.CONSUME($.T.LCurly);
  const rules = $.atRuleBody({ ...ctx, inner: true }) as unknown as Rules;
  $.CONSUME($.T.RCurly);

  const loc = $.endRule();
  const nameNode = new Any(nameImage, { role: 'name' }, nameLoc, $.context);
  return new Mixin(
    { name: nameNode, params: new List(params), rules, guard },
    undefined,
    loc,
    $.context
  );
}

/**
 * Mixin call: `$ > .name([args])` or `$ > #ns > .name([args])`
 * The `$` (JessDollar) token is consumed here.
 *
 * Builds a Reference chain: each segment holds the previous as `target`, so
 * `Reference(".mixin", { type: 'mixin', target: Reference("#ns", { ..., target: Any('$') }) })`
 * serializes as `$ > #ns > .mixin` via Reference.toTrimmedString.
 */
export function jessMixinCall(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.JessDollar); // $

  // Root of the chain — the literal `$` marker.
  let chainRef: Node = new Any('$', { role: 'any' }, undefined, $.context);
  let resultNode: Node = chainRef;

  $.AT_LEAST_ONE(() => {
    $.CONSUME($.T.Gt); // >
    const segTok = $.OR([
      { GATE: () => $.LA(1).tokenType === $.T.DotName,  ALT: () => $.CONSUME($.T.DotName)  },
      { GATE: () => $.LA(1).tokenType === $.T.HashName, ALT: () => $.CONSUME($.T.HashName) },
      { ALT: () => $.CONSUME($.T.PlainIdent) }
    ]) as unknown as IToken;
    const segLoc = $.getLocationInfo(segTok);

    const segRef = new Reference(
      { target: chainRef as any, key: segTok.image },
      { type: 'mixin' },
      segLoc,
      $.context
    );
    chainRef = segRef;

    if ($.LA(1).tokenType === $.T.LParen && $.noSep()) {
      $.startRule();
      $.CONSUME($.T.LParen);
      const args: Node[] = [];
      $.OPTION(() => {
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            args.push($.value(ctx) as unknown as Node);
          }
        });
      });
      $.CONSUME($.T.RParen);
      const callLoc = $.endRule();
      resultNode = new Call({ name: segRef, args: new List(args) }, undefined, callLoc, $.context);
    } else {
      resultNode = segRef;
    }
  });

  $.CONSUME($.T.Semi);
  $.endRule();
  return resultNode;
}
