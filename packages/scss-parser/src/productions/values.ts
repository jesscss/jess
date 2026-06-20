/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
// Value-related production rules for ScssRecursiveParser
// Converted from Chevrotain-based productions.ts
import type { RuleContext, TokenMap } from '../scssRecursiveParser.js';
import type { IToken } from '@jesscss/parser';
import { NoViableAltException } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import {
  Any,
  Call,
  Collection,
  Declaration,
  CustomDeclaration,
  Dimension,
  Expression,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type LocationInfo,
  type Node,
  List,
  Nil,
  negative,
  Num,
  Operation,
  type Operator,
  Paren,
  Rest,
  Quoted,
  Reference,
  type Selector,
  SelectorCapture,
  Sequence,
  shouldOperateWithMathFrames,
  VarDeclaration,
  isNode,
  N,
  Node as JessNode
} from '@jesscss/core';
import {
  desugarMapLookup,
  desugarNamespacedCall,
  looksLikeMapLiteral,
  makeNamespacedReference,
  parseSelectorListExpression,
  processScssStringInterpolation,
  toDeclKey,
  toNameInterpolationReplacement
} from './helpers.js';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;
type ProductionRule = (ctx?: RuleContext) => any;

type Alt = Array<{ ALT: () => any; GATE?: () => boolean }>;
type AltContext = (ctx?: RuleContext) => Alt;

// Save reference to CSS prototype functionCall
const cssFunctionCall = cssProductions.functionCall;
const cssDeclaration = cssProductions.declaration;

function getParenFrames(ctx: RuleContext | undefined): boolean[] {
  return (ctx?.parenFrames as boolean[] | undefined) ?? [];
}

function getCalcFrames(ctx: RuleContext | undefined): number {
  return (ctx?.calcFrames as number | undefined) ?? 0;
}

function wrapOuterExpressionIfNeeded($: P, node: Node, ctx: RuleContext | undefined, location?: LocationInfo): Node {
  if (!ctx?.wrapInExpression) {
    return node;
  }
  if (isNode(node, N.Expression)) {
    return node;
  }
  if (isNode(node, N.Operation)) {
    const shouldOperate = shouldOperateWithMathFrames(
      {
        mathMode: 'parens-division',
        parenFrames: getParenFrames(ctx),
        calcFrames: getCalcFrames(ctx)
      },
      node.operator,
      node.left,
      node.right
    );
    if (shouldOperate) {
      return new Expression(node, { parens: true }, location ?? (node.location as LocationInfo | undefined), $.context);
    }
  }
  return node;
}

function nodeFromSignedToken($: P, token: IToken, ctx: RuleContext): Node {
  const payload = (token as IToken & { payload?: [string, string?] }).payload;
  if (payload?.[1]) {
    return new Dimension(
      { number: parseFloat(payload[0]!), unit: payload[1] },
      undefined,
      $.getLocationInfo(token),
      $.context
    );
  }
  const num = parseFloat(token.image);
  if (!Number.isNaN(num)) {
    return new Num(num, undefined, $.getLocationInfo(token), $.context);
  }
  return $.processValueToken(token, ctx);
}

function skipBalanced($: P, startOffset: number, open: unknown, close: unknown): number | undefined {
  let depth = 0;
  let offset = startOffset;
  while (true) {
    const token = $.LA(offset);
    if (!token || token.tokenType.name === 'EOF') {
      return undefined;
    }
    if (token.tokenType === open) {
      depth++;
    } else if (token.tokenType === close) {
      depth--;
      if (depth === 0) {
        return offset + 1;
      }
    }
    offset++;
  }
}

function skipQuotedString($: P, startOffset: number, endToken: unknown): number | undefined {
  let offset = startOffset + 1;
  while (true) {
    const token = $.LA(offset);
    if (!token || token.tokenType.name === 'EOF') {
      return undefined;
    }
    if (token.tokenType === endToken) {
      return offset + 1;
    }
    offset++;
  }
}

function isExpressionAtomStart($: P, T: TokenMap, offset: number): boolean {
  const tokenType = $.LA(offset).tokenType;
  return tokenType === T.LParen
    || tokenType === T.InterpolationStart
    || tokenType === T.FunctionStart
    || tokenType === T.NamespacedFunctionStart
    || tokenType === T.DollarVariable
    || tokenType === T.Ident
    || tokenType === T.PlainIdent
    || tokenType === T.Dimension
    || tokenType === T.Number
    || tokenType === T.Color
    || tokenType === T.UnicodeRange
    || tokenType === T.SingleQuoteStart
    || tokenType === T.DoubleQuoteStart
    || tokenType === T.LSquare;
}

function skipExpressionAtom($: P, T: TokenMap, startOffset: number): number | undefined {
  let offset = startOffset;
  if ($.LA(offset).tokenType === T.Minus) {
    offset++;
  }
  const token = $.LA(offset);
  if (!token || token.tokenType.name === 'EOF') {
    return undefined;
  }
  if (token.tokenType === T.LParen) {
    return skipBalanced($, offset, T.LParen, T.RParen);
  }
  if (token.tokenType === T.LSquare) {
    return skipBalanced($, offset, T.LSquare, T.RSquare);
  }
  if (token.tokenType === T.SingleQuoteStart) {
    return skipQuotedString($, offset, T.SingleQuoteEnd);
  }
  if (token.tokenType === T.DoubleQuoteStart) {
    return skipQuotedString($, offset, T.DoubleQuoteEnd);
  }
  if (token.tokenType === T.InterpolationStart) {
    return skipBalanced($, offset, T.InterpolationStart, T.RCurly);
  }
  if (token.tokenType === T.FunctionStart || token.tokenType === T.NamespacedFunctionStart) {
    return skipBalanced($, offset, token.tokenType, T.RParen);
  }
  if (isExpressionAtomStart($, T, offset)) {
    return offset + 1;
  }
  return undefined;
}

function looksLikeIsolatedParenExpression($: P, T: TokenMap): boolean {
  if ($.LA(1).tokenType !== T.LParen) {
    return false;
  }
  let offset = 2;
  let next = skipExpressionAtom($, T, offset);
  if (!next) {
    return false;
  }
  let sawOperator = false;
  while (true) {
    const tokenType = $.LA(next).tokenType;
    if (tokenType === T.RParen) {
      return sawOperator;
    }
    if (
      tokenType !== T.Plus
      && tokenType !== T.Minus
      && tokenType !== T.Star
      && tokenType !== T.Divide
    ) {
      return false;
    }
    sawOperator = true;
    next = skipExpressionAtom($, T, next + 1);
    if (!next) {
      return false;
    }
  }
}

function saveValueDiagnostic($: P, token: IToken | undefined, location: LocationInfo | undefined, message: string): void {
  const err: NoViableAltException & {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    offset?: number;
    length?: number;
    location?: LocationInfo;
  } = new NoViableAltException(
    message,
    token ?? $.LA(1),
    $.LA(0)
  ) as NoViableAltException & {
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    offset?: number;
    length?: number;
    location?: LocationInfo;
  };
  if (location) {
    err.startLine = location[1];
    err.startColumn = location[2];
    err.endLine = location[4];
    err.endColumn = location[5];
    err.offset = location[0];
    err.length = Math.max(1, (location[3] - location[0]) + 1);
    err.location = location;
  }
  $.SAVE_ERROR(err);
}

function consumeScssVarFlags($: P) {
  let sawDefault = false;
  let sawGlobal = false;

  if ($.RECORDING_PHASE) {
    $.MANY(() => {
      $.OR2([
        { ALT: () => $.CONSUME($.T.SassDefault) },
        { ALT: () => $.CONSUME($.T.SassGlobal) }
      ]);
    });
    return { sawDefault, sawGlobal };
  }

  while ($.isType($.T.SassDefault) || $.isType($.T.SassGlobal)) {
    if ($.isType($.T.SassDefault)) {
      $.CONSUME($.T.SassDefault);
      sawDefault = true;
    } else {
      $.CONSUME($.T.SassGlobal);
      sawGlobal = true;
    }
  }

  return { sawDefault, sawGlobal };
}

export function scssNestedPropertyCollection(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LCurly);

    const decls: Declaration[] = [];

    $.MANY({
      GATE: () => $.LA(1).tokenType !== $.T.RCurly && $.LA(1).tokenType.name !== 'EOF',
      DEF: () => {
        if ($.LA(1).tokenType === $.T.Semi) {
          $.CONSUME($.T.Semi);
          return;
        }

        const decl = $.SUBRULE($.declaration, { ARGS: [ctx] }) as unknown as Node;
        if (!$.RECORDING_PHASE && isNode(decl, N.Declaration) && !isNode(decl, N.VarDeclaration)) {
          decls.push(decl as Declaration);
        }

        $.OPTION(() => {
          $.CONSUME2($.T.Semi);
        });
      }
    });

    $.CONSUME($.T.RCurly);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    return new Collection(decls, undefined, location, $.context);
  };
}

export function scssIdentValue(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const ident = (
      $.isType($.T.PlainIdent)
        ? $.CONSUME($.T.PlainIdent)
        : $.CONSUME($.T.Ident)
    ) as unknown as IToken;

    let kind: 'ruleset' | 'module-var' | 'module-fn' | undefined;
    let member: IToken | undefined;
    let dollarVariable: IToken | undefined;
    let dotName: IToken | undefined;
    let args: List | undefined;

    $.OPTION({
      GATE: () =>
        $.LA(1).tokenType === $.T.Unknown
        && $.LA(1).image === '.'
        && $.LA(2).tokenType === $.T.Unknown
        && $.LA(2).image === '\\'
        && ($.LA(3).tokenType === $.T.HashName || $.LA(3).tokenType === $.T.DotName)
        && $.LA(4).tokenType === $.T.LParen,
      DEF: () => {
        kind = 'ruleset';
        $.CONSUME($.T.Unknown);
        $.CONSUME2($.T.Unknown);
        member = $.OR([
          { ALT: () => $.CONSUME($.T.HashName) },
          { ALT: () => $.CONSUME($.T.DotName) }
        ]) as unknown as IToken;
        $.CONSUME($.T.LParen);
        $.OPTION2(() => (args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }) as unknown as List));
        $.CONSUME($.T.RParen);
      }
    });

    $.OPTION2({
      GATE: () =>
        $.LA(1).tokenType === $.T.Unknown
        && $.LA(1).image === '.'
        && $.LA(2).tokenType === $.T.DollarVariable,
      DEF: () => {
        kind = 'module-var';
        $.CONSUME3($.T.Unknown);
        dollarVariable = $.CONSUME($.T.DollarVariable);
      }
    });

    $.OPTION3({
      GATE: () =>
        $.LA(1).tokenType === $.T.DotName
        && $.LA(2).tokenType === $.T.LParen,
      DEF: () => {
        kind = 'module-fn';
        dotName = $.CONSUME2($.T.DotName) as unknown as IToken;
        $.CONSUME2($.T.LParen);
        $.OPTION4(() => (args = $.SUBRULE2($.functionCallArgs, { ARGS: [ctx] }) as unknown as List));
        $.CONSUME2($.T.RParen);
      }
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return ident;
    }

    if (kind === 'ruleset') {
      const key = member!.image.slice(1);
      const ref = makeNamespacedReference($, [ident.image, key], 'mixin-ruleset');
      const call = new Call({ name: ref, args }, undefined, loc, $.context);
      return new Expression(call, undefined, loc, $.context);
    }

    if (kind === 'module-var') {
      const key = dollarVariable!.image.slice(1);
      const nsRef = new Reference(ident.image, { type: 'variable' }, loc, $.context);
      return new Reference({ target: nsRef, key }, { type: 'variable' }, loc, $.context);
    }

    if (kind === 'module-fn') {
      const fnName = `${ident.image}.${dotName!.image.slice(1)}`;
      const call = new Call({ name: fnName, args }, undefined, loc, $.context);
      const mapped = desugarMapLookup($, call);
      if (isNode(mapped, N.Reference)) {
        return new Expression(mapped as unknown as Node, undefined, loc, $.context);
      }
      const maybe = desugarNamespacedCall($, mapped as Call);
      return new Expression(maybe, undefined, loc, $.context);
    }

    return ident;
  };
}

function getScssValueAlts($: P, T: TokenMap, ctx: RuleContext = {}): Alt {
  return [
    {
      GATE: () => $.LA(1).tokenType === $.T.LParen && looksLikeMapLiteral($, $.T),
      ALT: () => $.SUBRULE($.scssMapLiteral, { ARGS: [ctx] })
    },
    {
      GATE: () => $.LA(1).tokenType === $.T.LParen,
      ALT: () => $.SUBRULE($.parenValue, { ARGS: [ctx] })
    },
    {
      GATE: () => $.LA(1).tokenType === $.T.InterpolationStart,
      ALT: () => {
        $.startRule();
        $.CONSUME($.T.InterpolationStart);
        const expr = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME($.T.RCurly);
        const loc = $.endRule();
        return new Interpolated(
          { source: INTERPOLATION_PLACEHOLDER, replacements: [expr] },
          { role: 'any' },
          loc,
          $.context
        );
      }
    },
    {
      GATE: () => $.isTypeAt(1, $.T.FunctionStart),
      ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] })
    },
    { GATE: () => $.LA(1).tokenType === $.T.DollarVariable, ALT: () => $.CONSUME($.T.DollarVariable) },
    {
      GATE: () => $.isType($.T.Ident) || $.LA(1).tokenType === $.T.PlainIdent,
      ALT: () => $.SUBRULE($.scssIdentValue, { ARGS: [ctx] })
    },
    { GATE: () => $.isType($.T.Dimension), ALT: () => $.CONSUME($.T.Dimension) },
    { GATE: () => $.isType($.T.Number), ALT: () => $.CONSUME($.T.Number) },
    { GATE: () => $.isType($.T.Color), ALT: () => $.CONSUME($.T.Color) },
    { GATE: () => $.LA(1).tokenType === $.T.UnicodeRange, ALT: () => $.CONSUME($.T.UnicodeRange) },
    {
      GATE: () => $.LA(1).tokenType === $.T.SingleQuoteStart || $.LA(1).tokenType === $.T.DoubleQuoteStart,
      ALT: () => $.SUBRULE($.string, { ARGS: [ctx] })
    },
    { GATE: () => $.LA(1).tokenType === $.T.LSquare, ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
    {
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME($.T.LegacyMSFilter)
    }
  ];
}

export function expressionValue(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const minus = $.OPTION(() => $.CONSUME($.T.Minus));
    let node = $.OR(getScssValueAlts($, T, { ...ctx, preferExpressionInParens: true })) as unknown as Node | IToken;

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    if (!(node instanceof JessNode)) {
      node = $.processValueToken(node as IToken, ctx);
    }
    if (minus) {
      return negative(node as Node, undefined, location);
    }
    return node as Node;
  };
}

export function expressionProduct(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let left = (ctx.startValue as Node | undefined) ?? ($.SUBRULE($.expressionValue, { ARGS: [ctx] }) as unknown as Node);

    while (true) {
      let opToken: IToken | undefined;
      if ($.isType($.T.Star)) {
        opToken = $.CONSUME($.T.Star) as unknown as IToken;
      } else if ((ctx.allowSlashDivision ?? false) && $.LA(1).tokenType === $.T.Divide) {
        opToken = $.CONSUME($.T.Divide) as unknown as IToken;
      } else {
        break;
      }
      const right = $.SUBRULE2($.expressionValue, { ARGS: [ctx] }) as unknown as Node;
      left = new Operation(
        [left, opToken.image as Operator, right],
        undefined,
        $.getLocationFromNodes([left, right]),
        $.context
      );
    }

    $.endRule();
    return left;
  };
}

export function expressionSum(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let left = $.SUBRULE($.expressionProduct, { ARGS: [ctx] }) as unknown as Node;

    while (true) {
      let right: Node | undefined;
      let op: string | undefined;

      if ($.isType($.T.Plus)) {
        const opToken = $.CONSUME($.T.Plus) as unknown as IToken;
        op = opToken.image;
        right = $.SUBRULE2($.expressionProduct, { ARGS: [ctx] }) as unknown as Node;
      } else if ($.isType($.T.Minus)) {
        const opToken = $.CONSUME2($.T.Minus) as unknown as IToken;
        op = opToken.image;
        right = $.SUBRULE3($.expressionProduct, { ARGS: [ctx] }) as unknown as Node;
      } else if ($.noSep() && $.matchToken($.LA(1), $.T.Signed)) {
        const token = $.CONSUME($.T.Signed) as unknown as IToken;
        op = token.image[0];
        right = $.SUBRULE4($.expressionProduct, {
          ARGS: [{ ...ctx, startValue: nodeFromSignedToken($, token, ctx) }]
        }) as unknown as Node;
      } else {
        break;
      }

      left = new Operation(
        [left, op as Operator, right!],
        undefined,
        $.getLocationFromNodes([left, right!]),
        $.context
      );
    }

    $.endRule();
    return left;
  };
}

export function functionCallArgs(this: P, T: TokenMap): ProductionRule {
  const $ = this;

  const parseCallArgument = (ctx: RuleContext = {}) => {
    $.startRule();

    let node: Node;
    if (
      $.LA(1).tokenType === $.T.DollarVariable
      && $.isTypeAt(2, $.T.Assign)
    ) {
      const dv = $.CONSUME($.T.DollarVariable) as unknown as IToken;
      $.CONSUME($.T.Assign);
      const value = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      const name = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);
      return new VarDeclaration({ name, value }, undefined, location, $.context);
    }

    node = $.SUBRULE2($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
    $.OPTION({
      GATE: () => $.LA(1).tokenType === $.T.Ellipsis,
      DEF: () => {
        const ellipsis = $.CONSUME($.T.Ellipsis);
        if (!$.RECORDING_PHASE) {
          node = new Rest(node, undefined, $.getLocationFromNodes([node, ellipsis]), $.context);
        }
      }
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return node ?? new Nil(undefined, undefined, location, $.context);
  };

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let node = parseCallArgument(ctx) as unknown as Node;
    let commaNodes: Node[] | undefined;
    let semiNodes: Node[] | undefined;
    let isSemiList = false;

    if (!$.RECORDING_PHASE) {
      commaNodes = [node];
      semiNodes = [];
    }

    $.MANY(() => {
      if ($.RECORDING_PHASE) {
        $.OR([
          {
            ALT: () => {
              $.CONSUME($.T.Comma);
              $.OPTION2(() => {
                parseCallArgument(ctx);
              });
            }
          },
          {
            ALT: () => {
              $.CONSUME($.T.Semi);
              $.SUBRULE($.valueList, { ARGS: [ctx] });
            }
          }
        ]);
        return;
      }

      if (!isSemiList && $.isType($.T.Comma)) {
        $.CONSUME($.T.Comma);
        if ($.LA(1).tokenType === $.T.RParen) {
          return;
        }
        node = parseCallArgument(ctx) as unknown as Node;
        commaNodes!.push(node);
        return;
      }

      isSemiList = true;
      $.CONSUME($.T.Semi);
      if (commaNodes!.length > 1) {
        semiNodes!.push(new List(commaNodes!, undefined, $.getLocationFromNodes(commaNodes!)!, $.context));
      } else {
        semiNodes!.push(commaNodes![0]!);
      }
      node = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
      semiNodes!.push(node);
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nodes = isSemiList ? semiNodes! : commaNodes!;
    return new List(nodes, isSemiList ? { sep: ';' } : undefined, location, $.context);
  };
}

export function parenValue(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const parseAsExpression = (ctx.preferExpressionInParens ?? false) && looksLikeIsolatedParenExpression($, T);
    $.startRule();
    $.CONSUME($.T.LParen);

    if (parseAsExpression) {
      const exprCtx: RuleContext = {
        ...ctx,
        inner: true,
        wrapInExpression: true,
        allowSlashDivision: true,
        parenFrames: [...getParenFrames(ctx), true]
      };
      const value = $.SUBRULE($.expressionSum, { ARGS: [exprCtx] }) as unknown as Node;
      $.CONSUME($.T.RParen);
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      return wrapOuterExpressionIfNeeded($, value, exprCtx, location);
    }

    let value: Node | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RParen,
      DEF: () => {
        value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Node;
      }
    });

    $.CONSUME($.T.RParen);
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    if (
      (ctx.preferExpressionInParens ?? false)
      && isNode(value, N.List)
      && value.options?.sep === '/'
      && (value as List).value.length === 2
    ) {
      const [left, right] = (value as List).value;
      const exprCtx: RuleContext = {
        ...ctx,
        wrapInExpression: true,
        allowSlashDivision: true,
        parenFrames: [...getParenFrames(ctx), true]
      };
      const operation = new Operation(
        [left!, '/', right!],
        undefined,
        $.getLocationFromNodes([left!, right!]),
        $.context
      );
      return wrapOuterExpressionIfNeeded($, operation, exprCtx, location);
    }

    return new Paren(value, undefined, location, $.context);
  };
}

export function squareValue(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LSquare);

    let value: Node | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RSquare,
      DEF: () => {
        value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] }) as unknown as Node;
      }
    });

    $.CONSUME($.T.RSquare);
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const delimiter = (
      isNode(value, N.Any)
      && value.options?.role === 'ident'
    )
      ? 'square'
      : 'paren';

    return new Paren(value, { delimiter }, location, $.context);
  };
}

/**
 * Override CSS `value` to add SCSS interpolation, map literals, and
 * module-qualified references.
 */
export function value(this: P, T: TokenMap, valueAlt?: AltContext): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const exprCtx: RuleContext = {
      ...ctx,
      wrapInExpression: true,
      allowSlashDivision: ctx.allowSlashDivision ?? false
    };
    valueAlt ??= (innerCtx: RuleContext = {}) => getScssValueAlts($, T, innerCtx);
    let node = $.SUBRULE($.expressionSum, { ARGS: [exprCtx] }) as unknown as Node;
    let additionalValue: Node | undefined;
    $.OPTION(() => {
      $.CONSUME($.T.Divide);
      additionalValue = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
    });
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    node = wrapOuterExpressionIfNeeded($, node, exprCtx, location);
    if (additionalValue) {
      return new List([node, additionalValue], { sep: '/' }, location, $.context);
    }
    return node;
  };
}

/**
 * Override CSS functionCall to desugar module-qualified calls like `ns.fn(...)`.
 * We return an Expression(Call(Reference(ns.fn))) to match Less-style outer wrapping.
 */
export function functionCall(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const node = cssFunctionCall.call($, $.T)(ctx) as unknown as Call;

    if ($.RECORDING_PHASE) {
      return node as unknown as any;
    }

    if (!isNode(node, N.Call)) {
      return node as unknown as any;
    }

    // First, keep existing Sass map.get() desugaring behavior.
    const mapped = desugarMapLookup($, node);
    if (isNode(mapped, N.Reference)) {
      return mapped as unknown as any;
    }
    const call = mapped as Call;
    const { name, args } = call.value;

    if (typeof name === 'string' && name === 'selector.parse') {
      const argValues = isNode(args, N.List) ? (args as List).value : [];
      const firstArg = argValues[0];
      const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
        ? (call.location as LocationInfo)
        : undefined;
      if (!firstArg || !isNode(firstArg, N.Quoted) || !isNode((firstArg as Quoted).value, N.Any)) {
        saveValueDiagnostic($, undefined, firstArg?.location as LocationInfo | undefined ?? loc, 'selector.parse() requires a quoted selector string literal.');
        return call;
      }
      const selectorText = String((firstArg as Quoted).value.valueOf());
      let selector: Selector;
      try {
        selector = parseSelectorListExpression(selectorText);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        saveValueDiagnostic($, undefined, firstArg.location as LocationInfo | undefined ?? loc, `selector.parse() failed: ${message}`);
        return call;
      }
      return new SelectorCapture(selector, undefined, loc, $.context);
    }

    const maybe = desugarNamespacedCall($, call);
    if (maybe !== call) {
      const loc: LocationInfo | undefined = Array.isArray(maybe.location) && maybe.location.length === 6
        ? (maybe.location as LocationInfo)
        : undefined;
      // Namespaced call: emit as Expression so it serializes like `$ns.func(...)`.
      return new Expression(maybe, undefined, loc, $.context);
    }

    // Plain Sass/Less-style function call: `foo(...)`
    // Parse as Call(name: Reference(type='function', fallbackValue: true)) so evaluation tries function registry,
    // but still serializes safely if unresolved.
    if (typeof name === 'string') {
      const loc: LocationInfo | undefined = Array.isArray(call.location) && call.location.length === 6
        ? (call.location as LocationInfo)
        : undefined;
      const ref = new Reference(
        { key: name },
        { type: 'function', fallbackValue: true },
        loc,
        $.context
      );
      // Sass/Less plain function calls are not optional/silent-fail calls (no `?(` output).
      // Keep other call options if present, but drop `silentFail` coming from CSS fallback behavior.
      const { silentFail: silentFailIgnored, ...rest } = call.options ?? {};
      void silentFailIgnored;
      const nextOptions = Object.keys(rest).length > 0 ? rest : undefined;
      return new Call({ name: ref, args }, nextOptions, loc, $.context);
    }
    return call;
  };
}

/**
 * Override CSS `string` to add SCSS string interpolation support.
 */
export function string(this: P, T: TokenMap, stringAlt?: AltContext): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const parseSingleQuoted = () => {
      $.startRule();
      const quote = $.CONSUME($.T.SingleQuoteStart);

      let contents: IToken | undefined;
      if ($.RECORDING_PHASE) {
        $.OPTION(() => (contents = $.CONSUME($.T.SingleQuoteStringContents)));
      } else if ($.isType($.T.SingleQuoteStringContents)) {
        contents = $.CONSUME($.T.SingleQuoteStringContents) as unknown as IToken;
      }

      $.CONSUME($.T.SingleQuoteEnd);
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      const raw = contents?.image ?? '';
      const inner = processScssStringInterpolation(raw, location, $.context);
      return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
    };

    const parseDoubleQuoted = () => {
      $.startRule();
      const quote = $.CONSUME($.T.DoubleQuoteStart);

      let contents: IToken | undefined;
      if ($.RECORDING_PHASE) {
        $.OPTION(() => (contents = $.CONSUME($.T.DoubleQuoteStringContents)));
      } else if ($.isType($.T.DoubleQuoteStringContents)) {
        contents = $.CONSUME($.T.DoubleQuoteStringContents) as unknown as IToken;
      }

      $.CONSUME($.T.DoubleQuoteEnd);
      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      const raw = contents?.image ?? '';
      const inner = processScssStringInterpolation(raw, location, $.context);
      return new Quoted(inner as any, { quote: quote.image as '"' | '\'' }, location, $.context);
    };

    if ($.RECORDING_PHASE) {
      $.OR([
        { ALT: () => parseSingleQuoted() },
        { ALT: () => parseDoubleQuoted() }
      ]);
      return;
    }

    if ($.LA(1).tokenType === $.T.SingleQuoteStart) {
      return parseSingleQuoted();
    }
    return parseDoubleQuoted();
  };
}

/**
 * Parses a Sass map literal: `("k": v, ...)` into a Jess `Collection`.
 * (Only the map form is supported in this milestone; list literals come later.)
 */
export function scssMapLiteral(this: P, T: TokenMap): ProductionRule {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME($.T.LParen);

    const decls: Declaration[] = [];

    if ($.LA(1).tokenType !== $.T.RParen) {
      $.OPTION(() => {
        $.AT_LEAST_ONE_SEP({
          SEP: $.T.Comma,
          DEF: () => {
            const keyNode = $.SUBRULE($.value, { ARGS: [ctx] }) as unknown as Node;
            $.CONSUME($.T.Colon);
            const valueNode = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;

            const keyStr = toDeclKey(keyNode);
            const declName = new Any(keyStr, { role: 'property' });
            const decl = new Declaration(
              { name: declName, value: valueNode },
              undefined,
              $.getLocationFromNodes([keyNode, valueNode]),
              $.context
            );
            decls.push(decl);
          }
        });
      });
    }

    $.CONSUME($.T.RParen);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    const coll = new Collection(decls, undefined, location, $.context);
    return coll;
  };
}

/**
 * Override CSS `declaration` to add:
 *  - `$var: ...` SCSS variable declarations
 *  - Interpolated declaration names: `foo-#{$bar}: ...`
 */
export function declaration(this: P, T: TokenMap, alt?: AltContext): ProductionRule {
  const $ = this;
  const looksLikeInterpolatedDeclName = () => {
    for (let i = 1; i < 64; i++) {
      const tok = $.LA(i);
      if (tok.tokenType === $.T.Assign || tok.tokenType.name === 'EOF') {
        return false;
      }
      if (tok.tokenType === $.T.InterpolationStart) {
        return true;
      }
    }
    return false;
  };

  const parseVarDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    const dv = $.CONSUME($.T.DollarVariable);
    const assign = $.CONSUME($.T.Assign);
    const value = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;

    const { sawDefault, sawGlobal } = consumeScssVarFlags($);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = new Any(dv.image.slice(1), { role: 'property' }, $.getLocationInfo(dv), $.context);

    return new VarDeclaration(
      { name: nameNode, value: value },
      { assign: (sawDefault ? '?:' : assign.image) as any, setDefined: sawGlobal },
      location,
      $.context
    );
  };

  const parseInterpolatedDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    let source = '';
    const replacements: Node[] = [];

    $.AT_LEAST_ONE({
      DEF: () => {
        if ($.RECORDING_PHASE) {
          $.OR([
            {
              ALT: () => {
                $.CONSUME($.T.InterpolationStart);
                $.SUBRULE5($.valueSequence, { ARGS: [ctx] });
                $.CONSUME($.T.RCurly);
              }
            },
            { ALT: () => $.CONSUME($.T.PlainIdent) },
            { ALT: () => $.CONSUME($.T.Ident) },
            { ALT: () => $.CONSUME($.T.CustomProperty) },
            { ALT: () => $.CONSUME($.T.LegacyPropIdent) }
          ]);
          return;
        }

        if ($.LA(1).tokenType === $.T.InterpolationStart) {
          $.CONSUME($.T.InterpolationStart);
          const expr = $.SUBRULE5($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
          $.CONSUME($.T.RCurly);
          if (!$.RECORDING_PHASE) {
            source += INTERPOLATION_PLACEHOLDER;
            replacements.push(toNameInterpolationReplacement($, expr, $.getLocationFromNodes([expr])));
          }
          return;
        }

        let tok: IToken;
        if ($.isType($.T.PlainIdent)) {
          tok = $.CONSUME($.T.PlainIdent) as unknown as IToken;
        } else if ($.isType($.T.Ident)) {
          tok = $.CONSUME($.T.Ident) as unknown as IToken;
        } else if ($.isType($.T.CustomProperty)) {
          tok = $.CONSUME($.T.CustomProperty) as unknown as IToken;
        } else {
          tok = $.CONSUME($.T.LegacyPropIdent) as unknown as IToken;
        }
        if (!$.RECORDING_PHASE) {
          source += tok.image;
        }
      }
    });

    const assign = $.CONSUME($.T.Assign);
    let value!: Node;
    if ($.LA(1).tokenType === $.T.LCurly) {
      value = $.SUBRULE6($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
    } else {
      const initialValue = $.SUBRULE7($.valueList, { ARGS: [ctx] }) as unknown as Node;
      if ($.LA(1).tokenType === $.T.LCurly) {
        const nested = $.SUBRULE8($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
        value = new Sequence(
          [initialValue, nested],
          undefined,
          $.getLocationFromNodes([initialValue, nested]),
          $.context
        );
      } else {
        value = initialValue;
      }
    }
    let important: IToken | undefined;
    $.OPTION(() => {
      important = $.CONSUME($.T.Important);
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = new Interpolated({ source, replacements }, { role: 'property' }, $.getLocationFromNodes(replacements), $.context);
    const isCustom = nameNode.valueOf().startsWith('--');
    const wrapCtx = isCustom ? { ...ctx, inCustomPropertyValue: true } : ctx;
    const DeclClass = isCustom ? CustomDeclaration : Declaration;
    return new DeclClass({
      name: nameNode,
      value: value,
      important: important
        ? new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context)
        : undefined
    }, { assign: assign.image as any }, location, $.context);
  };

  const parseRegularDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    let name!: IToken;
    if ($.isType($.T.PlainIdent)) {
      name = $.CONSUME($.T.PlainIdent) as unknown as IToken;
    } else if ($.isType($.T.Ident)) {
      name = $.CONSUME($.T.Ident) as unknown as IToken;
    } else {
      name = $.CONSUME($.T.LegacyPropIdent) as unknown as IToken;
    }

    const assign = $.CONSUME($.T.Assign);
    let value!: Node;
    if ($.LA(1).tokenType === $.T.LCurly) {
      value = $.SUBRULE3($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
    } else {
      const initialValue = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
      if ($.LA(1).tokenType === $.T.LCurly) {
        const nested = $.SUBRULE4($.scssNestedPropertyCollection, { ARGS: [ctx] }) as unknown as Node;
        value = new Sequence(
          [initialValue, nested],
          undefined,
          $.getLocationFromNodes([initialValue, nested]),
          $.context
        );
      } else {
        value = initialValue;
      }
    }
    let important: IToken | undefined;
    $.OPTION(() => {
      important = $.CONSUME($.T.Important);
    });

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context);
    return new Declaration({
      name: nameNode,
      value: value,
      important: important
        ? new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context)
        : undefined
    }, { assign: assign.image as any }, location, $.context);
  };

  const parseCustomPropertyDeclaration = (ctx: RuleContext = {}) => {
    $.startRule();

    const name = $.CONSUME($.T.CustomProperty);
    const assign = $.CONSUME2($.T.Assign);
    let nodes: Node[] | undefined;
    if (!$.RECORDING_PHASE) {
      nodes = [];
    }
    $.startRule();
    $.MANY(() => {
      const val = $.SUBRULE2($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] }) as unknown as Node;
      if (!$.RECORDING_PHASE) {
        nodes!.push(val);
      }
    });

    const valueLocation = $.endRule();
    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nameNode = new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context);
    const value = new Sequence(nodes!, undefined, valueLocation, $.context);
    return new CustomDeclaration({
      name: nameNode,
      value: value
    }, { assign: assign.image as any }, location, $.context);
  };

  return (ctx: RuleContext = {}) => {
    if ($.RECORDING_PHASE) {
      $.OR([
        {
          GATE: () => $.LA(1).tokenType === $.T.DollarVariable,
          ALT: () => parseVarDeclaration(ctx)
        },
        {
          GATE: () => (
            (
              $.LA(1).tokenType === $.T.Ident
              || $.LA(1).tokenType === $.T.PlainIdent
              || $.LA(1).tokenType === $.T.CustomProperty
              || ($.legacyMode && $.LA(1).tokenType === $.T.LegacyPropIdent)
              || $.LA(1).tokenType === $.T.InterpolationStart
            ) && looksLikeInterpolatedDeclName()
          ),
          ALT: () => parseInterpolatedDeclaration(ctx)
        },
        {
          GATE: () => $.LA(1).tokenType === $.T.CustomProperty,
          ALT: () => parseCustomPropertyDeclaration(ctx)
        },
        {
          ALT: () => parseRegularDeclaration(ctx)
        }
      ]);
      return;
    }

    if ($.LA(1).tokenType === $.T.DollarVariable) {
      return parseVarDeclaration(ctx);
    }
    if (
      (
        $.LA(1).tokenType === $.T.Ident
        || $.LA(1).tokenType === $.T.PlainIdent
        || $.LA(1).tokenType === $.T.CustomProperty
        || ($.legacyMode && $.LA(1).tokenType === $.T.LegacyPropIdent)
        || $.LA(1).tokenType === $.T.InterpolationStart
      ) && looksLikeInterpolatedDeclName()
    ) {
      return parseInterpolatedDeclaration(ctx);
    }
    if ($.LA(1).tokenType === $.T.CustomProperty) {
      return parseCustomPropertyDeclaration(ctx);
    }
    return parseRegularDeclaration(ctx);
  };
}
