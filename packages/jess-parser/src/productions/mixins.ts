import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import type { IToken } from 'chevrotain';
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
type Production<T = unknown> = (ctx?: RuleContext) => T | undefined;

/**
 * Parse mixin parameter list: `($var[: default], ...)` or empty.
 * Returns an array of VarDeclaration nodes.
 * @param skipLParen - When true, the leading `(` was already consumed (e.g. as part of a Function token).
 */
export function jessMixinParams(this: P, T: TokenMap): Production<Node[]> {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const params: Node[] = [];
    if (!ctx.skipLParen) {
      $.CONSUME($.T.LParen);
    }
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RParen,
      DEF: () => {
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            const paramTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
            const paramLoc = $.getLocationInfo(paramTok);
            const varName = paramTok.image.slice(1);
            let defaultValue: Node | undefined;
            $.OPTION2({
              GATE: () => $.isType($.T.Assign),
              DEF: () => {
                $.CONSUME($.T.Assign); // ':'
                defaultValue = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
              }
            });
            const nameNode = new Any(varName, { role: 'property' }, paramLoc, $.context);
            const decl = new VarDeclaration(
              { name: nameNode, value: defaultValue ?? new Nil(undefined, undefined, paramLoc, $.context) },
              undefined,
              paramLoc,
              $.context
            );
            params.push(decl);
          }
        });
      }
    });
    $.CONSUME($.T.RParen);
    return params;
  };
}

/**
 * Parse mixin guard: `when (condition)` → Condition
 */
export function jessGuard(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.CONSUME($.T.PlainIdent); // 'when'
    return $.SUBRULE($.jessConditionInParens, { ARGS: [ctx] }) as unknown as Condition;
  };
}

/**
 * Mixin definition: `[.#]name([params]) [when (guard)] { rules }`
 *
 * Handles: `mixin() {}`, `.mixin() {}`, `#mixin() {}`, `mixin($x) when ($x > 0) {}`
 */
export function jessMixinDefinition(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let nameTok!: IToken;
    let isFunctionToken = false;

    nameTok = $.OR([
      {
        GATE: () => $.LA(1).tokenType === $.T.FunctionStart || $.LA(1).tokenType === $.T.GenericFunctionStart,
        ALT: () => {
          isFunctionToken = true;
          return $.OR2([
            { GATE: () => $.LA(1).tokenType === $.T.FunctionStart, ALT: () => $.CONSUME($.T.FunctionStart) },
            { ALT: () => $.CONSUME($.T.GenericFunctionStart) }
          ]);
        }
      },
      { GATE: () => $.LA(1).tokenType === $.T.DotName, ALT: () => $.CONSUME($.T.DotName) },
      { GATE: () => $.LA(1).tokenType === $.T.HashName, ALT: () => $.CONSUME($.T.HashName) },
      { ALT: () => $.CONSUME($.T.PlainIdent) }
    ]) as unknown as IToken;

    const params = $.SUBRULE($.jessMixinParams, { ARGS: [{ ...ctx, skipLParen: isFunctionToken }] }) as unknown as Node[];

    let guard: Condition | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.PlainIdent && $.LA(1).image === 'when',
      DEF: () => {
        guard = $.SUBRULE($.jessGuard, { ARGS: [ctx] }) as unknown as Condition;
      }
    });

    $.CONSUME($.T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Rules;
    $.CONSUME($.T.RCurly);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const nameLoc = $.getLocationInfo(nameTok);
    // FunctionStart/GenericFunctionStart image is `name(` — strip the trailing `(`.
    const nameImage = isFunctionToken ? nameTok.image.slice(0, -1) : nameTok.image;
    const nameNode = new Any(nameImage, { role: 'name' }, nameLoc, $.context);
    return new Mixin(
      { name: nameNode, params: new List(params), rules: rules.rules, guard },
      undefined,
      loc,
      $.context
    );
  };
}

/**
 * Mixin call: `$ > .name([args])` or `$ > #ns > .name([args])`
 * The `$` (JessDollar) token is consumed here.
 *
 * Builds a Reference chain: each segment holds the previous as `target`, so
 * `Reference(".mixin", { type: 'mixin', target: Reference("#ns", { ..., target: Any('$') }) })`
 * serializes as `$ > #ns > .mixin` via Reference.toTrimmedString.
 */
export function jessMixinCall(this: P, T: TokenMap): Production<Node> {
  const $ = this;
  return (ctx: RuleContext = {}) => {
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
        { target: chainRef as unknown as Reference, key: segTok.image },
        { type: 'mixin' },
        segLoc,
        $.context
      );
      chainRef = segRef;

      $.OPTION({
        GATE: () => $.LA(1).tokenType === $.T.LParen && $.noSep(),
        DEF: () => {
        $.startRule();
        $.CONSUME($.T.LParen);
        const args: Node[] = [];
        $.OPTION2(() => {
          $.AT_LEAST_ONE_SEP({
            SEP: $.T.Comma,
            DEF: () => {
              args.push($.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node);
            }
          });
        });
        $.CONSUME($.T.RParen);
        const callLoc = $.endRule();
        resultNode = new Call({ name: segRef, args: new List(args) }, undefined, callLoc, $.context);
        }
      });
      if (!(resultNode instanceof Call)) {
        resultNode = segRef;
      }
    });

    $.CONSUME($.T.Semi);
    $.endRule();
    return resultNode;
  };
}
