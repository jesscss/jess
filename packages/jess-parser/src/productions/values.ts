import type { JessRuleContext as RuleContext, TokenMap } from '../jessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import { scssValueProduction } from '@jesscss/scss-parser';
import {
  Call,
  Expression,
  List,
  Reference,
  type Node
} from '@jesscss/core';

/** Use `any` for `this` to avoid structural incompatibility */
type P = any;

const scssValue = scssValueProduction;
const cssMathProduct = cssProductions.mathProduct;
const cssMathSum = cssProductions.mathSum;

/**
 * `$(expr)` → Expression node (serializes as `$(...)`)
 * Uses mathSum to handle arithmetic like `$(1 + 1)`.
 */
export function jessParenExpression(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME($.T.DollarParen); // $( — paren is part of the token
    const inner = $.SUBRULE($.expressionSum, {
      ARGS: [{ ...ctx, allowSlashDivision: true }]
    }) as unknown as Node;
    $.CONSUME($.T.RParen);

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new Expression(inner, undefined, loc, $.context);
  };
}

export function mathProduct(this: P, T: TokenMap) {
  return cssMathProduct.call(this, T);
}

export function mathSum(this: P, T: TokenMap) {
  return cssMathSum.call(this, T);
}

export function jessCallArgs(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    let argsNode: Node | undefined;
    $.OPTION({
      GATE: () => $.LA(1).tokenType !== $.T.RParen,
      DEF: () => {
        argsNode = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }) as unknown as Node;
      }
    });
    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return argsNode instanceof List ? argsNode : new List(argsNode ? [argsNode] : [], undefined, loc, $.context);
  };
}

export function functionCallArgs(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let node = $.SUBRULE($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
    let commaNodes: Node[] | undefined;
    let semiNodes: Node[] | undefined;
    let isSemiList = false;

    if (!$.RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }

    $.MANY(() => {
      if ($.RECORDING_PHASE) {
        $.OR([
          {
            ALT: () => {
              $.CONSUME($.T.Comma);
              $.SUBRULE2($.valueSequence, { ARGS: [ctx] });
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
        node = $.SUBRULE2($.valueSequence, { ARGS: [ctx] }) as unknown as Node;
        commaNodes!.push($.wrap(node, true));
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
      semiNodes!.push($.wrap(node, true));
    });

    const loc = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }

    const nodes = isSemiList ? semiNodes! : commaNodes!;
    return new List(nodes, isSemiList ? { sep: ';' } : undefined, loc, $.context);
  };
}

/**
 * `$var` with optional accessor chain `.prop`, `[idx]`, `.method(args)`.
 * Returns a Reference for plain `$var` or a nested Reference/Call for chains.
 */
export function jessVarWithAccessors(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const dvTok = $.CONSUME($.T.DollarVariable) as unknown as IToken;
    const dvLoc = $.getLocationInfo(dvTok);
    let node: Node = new Reference(dvTok.image.slice(1), { type: 'variable' }, dvLoc, $.context);

    // Accessor chain — no whitespace allowed between parts
    while ($.noSep() && ($.LA(1).tokenType === $.T.DotName || $.LA(1).tokenType === $.T.LSquare)) {
      if ($.LA(1).tokenType === $.T.DotName) {
        const dotTok = $.CONSUME($.T.DotName) as unknown as IToken;
        const propName = dotTok.image.slice(1); // strip leading '.'
        const propLoc = $.getLocationInfo(dotTok);

        if ($.noSep() && $.LA(1).tokenType === $.T.LParen) {
          // Method call: `.method(args)`
          $.startRule();
          $.CONSUME($.T.LParen);
          const argsNode = $.SUBRULE($.jessCallArgs, { ARGS: [ctx] }) as unknown as List;
          $.CONSUME($.T.RParen);
          const callLoc = $.endRule();
          const propRef = new Reference(
            { target: node as unknown as Reference, key: propName },
            { type: 'property' },
            propLoc,
            $.context
          );
          node = new Call({
            name: propRef,
            args: argsNode
          }, undefined, callLoc, $.context);
        } else {
          // Property access: `node.prop`
          node = new Reference(
            { target: node as unknown as Reference, key: propName },
            { type: 'property' },
            propLoc,
            $.context
          );
        }
      } else {
        // Index access: `[idx]`
        $.startRule();
        $.CONSUME($.T.LSquare);
        const idx = $.SUBRULE($.valueList, { ARGS: [ctx] }) as unknown as Node;
        $.CONSUME($.T.RSquare);
        const idxLoc = $.endRule();
        node = new Reference(
          { target: node as unknown as Reference, key: idx },
          { type: 'index' },
          idxLoc,
          $.context
        );
      }
    }

    $.endRule();
    return $.wrap(node);
  };
}

/**
 * Override SCSS `value` to add Jess-specific alternatives before SCSS defaults.
 *
 * - `$(expr)` → Expression
 * - `$var.prop` / `$var[idx]` / `$var.method(args)` → Reference/Call chain
 */
export function value(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    if ($.RECORDING_PHASE) {
      $.OR2([
        {
          GATE: () => $.LA(1).tokenType === $.T.DollarParen,
          ALT: () => $.SUBRULE($.jessParenExpression, { ARGS: [ctx] })
        },
        {
          GATE: () =>
            $.LA(1).tokenType === $.T.DollarVariable
            && $.noSep(1)
            && ($.LA(2).tokenType === $.T.DotName || $.LA(2).tokenType === $.T.LSquare),
          ALT: () => $.SUBRULE($.jessVarWithAccessors, { ARGS: [ctx] })
        },
        {
          GATE: () => $.LA(1).tokenType === $.T.LParen,
          ALT: () => $.SUBRULE($.parenValue, { ARGS: [ctx] })
        },
        {
          ALT: () => scssValue.call($, T)(ctx)
        }
      ]);
      return;
    }

    if ($.LA(1).tokenType === $.T.DollarParen) {
      return $.SUBRULE($.jessParenExpression, { ARGS: [ctx] });
    }

    if (
      $.LA(1).tokenType === $.T.DollarVariable
      && $.noSep(1)
      && ($.LA(2).tokenType === $.T.DotName || $.LA(2).tokenType === $.T.LSquare)
    ) {
      return $.SUBRULE($.jessVarWithAccessors, { ARGS: [ctx] });
    }

    if ($.LA(1).tokenType === $.T.LParen) {
      return $.SUBRULE($.parenValue, { ARGS: [ctx] });
    }

    if ($.LA(1).tokenType === $.T.DollarVariable) {
      const token = $.CONSUME($.T.DollarVariable) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if (
      $.LA(1).tokenType === $.T.UrlStart
      || $.LA(1).tokenType === $.T.Var
      || $.LA(1).tokenType === $.T.Calc
    ) {
      return $.SUBRULE($.knownFunctions, { ARGS: [ctx] });
    }

    if ($.isType($.T.FunctionStart)) {
      return $.SUBRULE($.functionCall, { ARGS: [ctx] });
    }

    if ($.isType($.T.PlainIdent)) {
      const token = $.CONSUME($.T.PlainIdent) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if ($.isType($.T.Ident)) {
      const token = $.CONSUME($.T.Ident) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if ($.isType($.T.Dimension)) {
      const token = $.CONSUME($.T.Dimension) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if ($.isType($.T.Number)) {
      const token = $.CONSUME($.T.Number) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if ($.isType($.T.Color)) {
      const token = $.CONSUME($.T.Color) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if ($.LA(1).tokenType === $.T.UnicodeRange) {
      const token = $.CONSUME($.T.UnicodeRange) as unknown as IToken;
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }

    if ($.LA(1).tokenType === $.T.SingleQuoteStart || $.LA(1).tokenType === $.T.DoubleQuoteStart) {
      return $.SUBRULE($.string, { ARGS: [ctx] });
    }

    if ($.LA(1).tokenType === $.T.LSquare) {
      return $.SUBRULE($.squareValue, { ARGS: [ctx] });
    }

    return scssValue.call($, T)(ctx);
  };
}
