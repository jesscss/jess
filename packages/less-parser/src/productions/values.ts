// Values productions for LessRecursiveParser
// Converted from Chevrotain-based productions.ts (lines 2060-3015)
import type { RuleContext, TokenMap } from '../lessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import {
  type TreeContext,
  type LocationInfo,
  type Operator,
  Node,
  Any,
  Block,
  List,
  Sequence,
  Call,
  Paren,
  Operation,
  Quoted,
  Interpolated,
  Reference,
  Url,
  Dimension,
  Num,
  Negative,
  Rest,
  Expression,
  INTERPOLATION_PLACEHOLDER,
  isNode,
  N
} from '@jesscss/core';
import { getInterpolatedOrString } from '../utils.js';

/** Use `any` for `this` to avoid structural incompatibility between LessRecursiveParser and CssRecursiveParser */
type P = any;
type Alt = Array<{ ALT: () => any; GATE?: () => boolean }>;
type AltContext = (ctx?: RuleContext) => Alt;

// ── Save references to CSS production factories ────────────────────────
const cssNthValue = cssProductions.nthValue;
const cssKnownFunctions = cssProductions.knownFunctions;
const cssMathValue = cssProductions.mathValue;

// ── Helpers ───────────────────────────────────────────────────────────

function getParenFrames(ctx: RuleContext | undefined): boolean[] {
  return (ctx?.parenFrames as boolean[] | undefined) ?? [];
}

function withCalcFrame(ctx: RuleContext | undefined, delta: number): RuleContext {
  const calcFrames = ((ctx?.calcFrames as number | undefined) ?? 0) + delta;
  return { ...(ctx ?? {}), calcFrames };
}

function startsCustomValueToken($: P, T: TokenMap): boolean {
  return $.isType(T.LParen)
    || $.isType(T.FunctionStart)
    || $.isType(T.FunctionalPseudoClass)
    || $.isType(T.LSquare)
    || $.isType(T.LCurly)
    || $.isType(T.SingleQuoteStart)
    || $.isType(T.DoubleQuoteStart)
    || $.isType(T.Value)
    || $.isType(T.PlainIdent)
    || $.isType(T.AtKeyword)
    || $.isType(T.PropertyReference)
    || $.isType(T.CustomProperty)
    || $.isType(T.Dimension)
    || $.isType(T.Number)
    || $.isType(T.Color)
    || $.isType(T.UnicodeRange)
    || $.isType(T.Colon)
    || $.isType(T.Comma)
    || $.isType(T.Important)
    || $.isType(T.Unknown);
}

const createInterpolatedReference = (
  prefix: string,
  value: string,
  location: LocationInfo,
  context: TreeContext
): Reference => {
  const isProperty = prefix === '$';
  const key = isProperty
    ? new Quoted(value, { quote: '\'' }, location, context)
    : value;
  return new Reference(
    { key },
    { type: isProperty ? 'property' : 'variable', role: 'ident' },
    location,
    context
  );
};

// ── Production rules ──────────────────────────────────────────────────

export function expressionSum(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let left = $.SUBRULE($.expressionProduct, { ARGS: [ctx] });

    while (true) {
      let op: string | undefined;
      let right: Node | undefined;

      if ($.isType(T.Plus)) {
        const opToken = $.CONSUME(T.Plus);
        op = opToken.image;
        right = $.SUBRULE2($.expressionProduct, { ARGS: [ctx] });
      } else if ($.isType(T.Minus)) {
        const opToken = $.CONSUME(T.Minus);
        op = opToken.image;
        right = $.SUBRULE4($.expressionProduct, { ARGS: [ctx] });
      } else if ($.noSep() && $.matchToken($.LA(1), T.Signed)) {
        const tok = $.CONSUME(T.Signed);
        let startValue: Node | undefined;
        const str = tok.image;
        op = str[0];
        if (tok.payload && tok.payload[1]) {
          const dim = { number: parseFloat(tok.payload[0]), unit: tok.payload[1] };
          startValue = new Dimension(dim, undefined, $.getLocationInfo(tok), $.context);
        } else {
          const num = parseFloat(str);
          if (!Number.isNaN(num)) {
            startValue = new Num(num, undefined, $.getLocationInfo(tok), $.context);
          } else {
            startValue = $.processValueToken(tok);
          }
        }
        right = $.SUBRULE3($.expressionProduct, { ARGS: [{ ...ctx, startValue }] });
      } else {
        break;
      }

      const operation = new Operation(
        [$.wrap(left, true), op as Operator, $.wrap(right!)],
        undefined,
        $.getLocationFromNodes([left, right!]),
        $.context
      );
      left = operation;
    }

    $.endRule();

    return left;
  };
}

export function expressionProduct(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let left = ctx.startValue ?? $.SUBRULE($.expressionValue, { ARGS: [ctx] });

    while (true) {
      let op: IToken;

      if ($.isType(T.Star)) {
        op = $.CONSUME(T.Star);
      } else if ($.isType(T.Slash)) {
        op = $.CONSUME(T.Slash);
      } else if ($.isType(T.Percent)) {
        op = $.CONSUME(T.Percent);
      } else {
        break;
      }
      // Check for deprecated ./ operator
      if (op!.image === './') {
        $.warnDeprecation(
          './ operator is deprecated',
          op!,
          'dot-slash-operator'
        );
      }
      let right: Node = $.SUBRULE2($.expressionValue, { ARGS: [ctx] });

      const operation = new Operation(
        [$.wrap(left, true), op!.image as Operator, $.wrap(right)],
        undefined,
        $.getLocationFromNodes([left, right]),
        $.context
      );
      left = operation;
    }

    $.endRule();

    return left;
  };
}

export function customValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    if (
      $.isType(T.LParen)
      || $.isType(T.FunctionStart)
      || $.isType(T.FunctionalPseudoClass)
      || $.isType(T.LSquare)
      || $.isType(T.LCurly)
    ) {
      return $.SUBRULE($.customBlock, { ARGS: [ctx] });
    }
    if ($.isType(T.SingleQuoteStart) || $.isType(T.DoubleQuoteStart)) {
      return $.SUBRULE($.string, { ARGS: [ctx] });
    }

    let token: IToken;
    if ($.isType(T.Value)) {
      token = $.CONSUME(T.Value);
    } else if ($.isType(T.PlainIdent)) {
      token = $.CONSUME(T.PlainIdent);
    } else if ($.isType(T.AtKeyword)) {
      token = $.CONSUME(T.AtKeyword);
    } else if ($.isType(T.PropertyReference)) {
      token = $.CONSUME(T.PropertyReference);
    } else if ($.isType(T.CustomProperty)) {
      token = $.CONSUME(T.CustomProperty);
    } else if ($.isType(T.Dimension)) {
      token = $.CONSUME(T.Dimension);
    } else if ($.isType(T.Number)) {
      token = $.CONSUME(T.Number);
    } else if ($.isType(T.Color)) {
      token = $.CONSUME(T.Color);
    } else if ($.isType(T.UnicodeRange)) {
      token = $.CONSUME(T.UnicodeRange);
    } else if ($.isType(T.Colon)) {
      token = $.CONSUME(T.Colon);
    } else if ($.isType(T.Comma)) {
      token = $.CONSUME(T.Comma);
    } else if ($.isType(T.Important)) {
      token = $.CONSUME(T.Important);
    } else {
      token = $.CONSUME(T.Unknown);
    }

    if (!$.RECORDING_PHASE) {
      return $.wrap($.processValueToken(token, ctx), undefined, ctx);
    }
  };
}

export function innerCustomValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    if ($.isType(T.Semi)) {
      const semi = $.CONSUME(T.Semi);
      if ($.RECORDING_PHASE) {
        return;
      }
      return $.wrap(new Any(semi.image, { role: 'semi' }, $.getLocationInfo(semi), $.context));
    }
    return $.SUBRULE($.customValue, { ARGS: [ctx] });
  };
}

export function customBlock(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let start: IToken | undefined;
    let end: IToken | undefined;
    let nodes: Node[] | undefined;
    if (!RECORDING_PHASE) {
      nodes = [];
    }

    if ($.isType(T.LParen)) {
      start = $.CONSUME(T.LParen);
      while (!$.isType(T.RParen) && (startsCustomValueToken($, T) || $.isType(T.Semi))) {
        const val = $.SUBRULE($.innerCustomValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(val);
        }
      }
      end = $.CONSUME(T.RParen);
    } else if ($.isType(T.FunctionStart) || $.isType(T.FunctionalPseudoClass)) {
      start = $.isType(T.FunctionStart)
        ? $.CONSUME(T.FunctionStart)
        : $.CONSUME(T.FunctionalPseudoClass);
      while (!$.isType(T.RParen) && (startsCustomValueToken($, T) || $.isType(T.Semi))) {
        const val = $.SUBRULE2($.innerCustomValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(val);
        }
      }
      end = $.CONSUME2(T.RParen);
    } else if ($.isType(T.LSquare)) {
      start = $.CONSUME(T.LSquare);
      while (!$.isType(T.RSquare) && (startsCustomValueToken($, T) || $.isType(T.Semi))) {
        const val = $.SUBRULE3($.innerCustomValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(val);
        }
      }
      end = $.CONSUME(T.RSquare);
    } else {
      start = $.CONSUME(T.LCurly);
      while (!$.isType(T.RCurly) && (startsCustomValueToken($, T) || $.isType(T.Semi))) {
        const val = $.SUBRULE4($.innerCustomValue, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(val);
        }
      }
      end = $.CONSUME(T.RCurly);
    }

    if (RECORDING_PHASE) {
      return;
    }
    const location = $.endRule();
    let type: 'square' | 'curly' | undefined;
    switch (start!.image) {
      case '[':
        type = 'square';
        break;
      case '{':
        type = 'curly';
        break;
    }
    if (type) {
      const seqLoc = nodes!.length ? $.getLocationFromNodes(nodes!) : undefined;
      const seq = new Sequence(nodes!, undefined, seqLoc, $.context);
      return $.wrap(new Block($.wrap(seq, true, ctx), { type }, location, $.context), undefined, ctx);
    }
    const startNode = $.wrap(new Any(start!.image, { role: 'any' }, $.getLocationInfo(start!), $.context), undefined, ctx);
    const endNode = $.wrap(new Any(end!.image, { role: 'any' }, $.getLocationInfo(end!), $.context), undefined, ctx);
    return new Sequence([startNode, ...nodes!, endNode], undefined, location, $.context);
  };
}

export function expressionValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    /** Can create a negative expression */
    let minus = $.OPTION(() => $.CONSUME(T.Minus));
    let node = $.OR([
      {
        ALT: () => {
          $.startRule();
          let escape: IToken | undefined;
          $.OPTION2(() => {
            escape = $.CONSUME(T.Tilde);
          });

          $.CONSUME(T.LParen);
          const innerCtx: RuleContext = {
            ...ctx,
            inner: true,
            allowComma: true,
            // Parentheses in Less enable "math in parens" semantics
            parenFrames: [...getParenFrames(ctx), true]
          };
          let node = $.SUBRULE($.valueList, { ARGS: [innerCtx] });

          // ~() paren escapes also support semicolons as separators: ~(1; 2; 3)
          let isSemiList = false;
          if (escape) {
            let semiNodes: Node[] = [];
            $.OPTION3(() => {
              $.CONSUME(T.Semi);
              isSemiList = true;
              semiNodes.push($.wrap(node, true));
              node = $.SUBRULE2($.valueList, { ARGS: [innerCtx] });
              semiNodes.push($.wrap(node, true));
              $.MANY({
                GATE: () => $.isType(T.Semi),
                DEF: () => {
                  $.CONSUME2(T.Semi);
                  node = $.SUBRULE3($.valueList, { ARGS: [innerCtx] });
                  semiNodes.push($.wrap(node, true));
                }
              });
            });
            if (isSemiList) {
              node = new List(semiNodes, { sep: ';' });
            }
          }

          $.CONSUME(T.RParen);

          let location = $.endRule();
          node = $.wrap(node, 'both');
          return new Paren(node, { escaped: !!escape }, location, $.context);
        }
      },
      { ALT: () => $.SUBRULE($.value, { ARGS: [ctx] }) }
    ]);
    let location = $.endRule();
    if (minus) {
      return new Negative(node, undefined, location, $.context);
    }
    return node;
  };
}

/**
 * Add interpolation
 */
export function nthValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let nthValueAlt = (ctx: RuleContext = {}) => [
      { ALT: () => $.CONSUME(T.InterpolatedIdent) },
      { ALT: () => $.CONSUME(T.NthOdd) },
      { ALT: () => $.CONSUME(T.NthEven) },
      { ALT: () => $.CONSUME(T.Integer) },
      {
        ALT: () => {
          $.OR2([
            { ALT: () => $.CONSUME(T.NthSignedDimension) },
            { ALT: () => $.CONSUME(T.NthUnsignedDimension) },
            { ALT: () => $.CONSUME(T.NthSignedPlus) },
            { ALT: () => $.CONSUME(T.NthIdent) }
          ]);
          $.OPTION(() => {
            $.OR3([
              { ALT: () => $.CONSUME(T.SignedInt) },
              {
                ALT: () => {
                  $.CONSUME(T.Minus);
                  $.CONSUME(T.UnsignedInt);
                }
              }
            ]);
          });
          $.OPTION2(() => {
            $.CONSUME(T.Of);
            $.SUBRULE($.complexSelector, { ARGS: [ctx] });
          });
        }
      }
    ];

    return cssNthValue.call($, T, nthValueAlt)(ctx);
  };
}

export function knownFunctions(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let functions = (ctx: RuleContext = {}) => [
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE2($.varFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE3($.calcFunction, { ARGS: [ctx] }) },
      // colorFunction is already in cssKnownFunctions default, so we don't need to add it here
      { ALT: () => $.SUBRULE4($.ifFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE5($.booleanFunction, { ARGS: [ctx] }) }
    ];

    return cssKnownFunctions.call($, T, functions)(ctx);
  };
}

export function urlFunction(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME(T.UrlStart);
    let node: Any | IToken | Node = $.OR([
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.NonQuotedUrl) }
    ]);
    $.CONSUME(T.UrlEnd);

    if ($.RECORDING_PHASE) {
      return;
    }

    const location = $.endRule();
    if (!(node instanceof Node)) {
      const rawValue = node.image;
      const tokenLocation = $.getLocationInfo(node);
      if (rawValue.startsWith('@') || rawValue.startsWith('$')) {
        const resolved = getInterpolatedOrString(rawValue, tokenLocation, $.context);
        if (resolved instanceof Interpolated) {
          node = resolved;
        } else {
          node = new Reference(
            resolved,
            { type: rawValue.startsWith('$') ? 'property' : 'variable' },
            tokenLocation,
            $.context
          );
        }
      } else {
        node = new Any(rawValue, { role: 'urlvalue' }, tokenLocation, $.context);
      }
    }
    return new Url(node, undefined, location, $.context);
  };
}

/**
 * Override CSS calc() parsing so we can maintain parse-time `calcFrames`.
 * This is the parse-time analogue of `Call.evalNode`'s calcFrames++/--.
 */
export function calcFunction(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME(T.Calc);
    const innerCtx = withCalcFrame(ctx, 1);
    const args = $.SUBRULE($.mathSum, { ARGS: [innerCtx] });
    $.CONSUME(T.RParen);

    const location = $.endRule();
    return new Call({
      name: 'calc',
      args: new List([args])
    }, undefined, location, $.context);
  };
}

export function ifFunction(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.CONSUME(T.IfFunction);
    let args = new List<Node>([]);
    let isCssBranch = false;
    const firstNode = $.SUBRULE($.guardInner, { ARGS: [{ ...ctx, inValueList: true }] });

    if ($.isType(T.Assign)) {
      isCssBranch = true;
      const branches: Node[] = [];
      const pushBranch = (condition: Node, value: Node) => {
        const sep = $.wrap(new Any(':', { role: 'operator' }, undefined, $.context), true);
        const loc = $.getLocationFromNodes([condition, value]);
        branches.push(new Sequence([$.wrap(condition, true), sep, $.wrap(value, true)], undefined, loc, $.context));
      };

      $.CONSUME(T.Assign);
      let branchValue = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] });
      pushBranch(firstNode, branchValue);

      $.MANY({
        GATE: () => $.isType(T.Semi) && !$.isTypeAt(2, T.RParen),
        DEF: () => {
          $.CONSUME2(T.Semi);
          const condition = $.SUBRULE2($.guardInner, { ARGS: [{ ...ctx, inValueList: true }] });
          $.CONSUME2(T.Assign);
          const value = $.SUBRULE2($.valueList, { ARGS: [{ ...ctx, inner: true }] });
          pushBranch(condition, value);
        }
      });
      $.OPTION(() => $.CONSUME3(T.Semi));
      $.CONSUME2(T.RParen);

      const cssArgs = branches.length === 1
        ? branches[0]!
        : new List(branches, { sep: ';' }, $.getLocationFromNodes(branches), $.context);
      args = new List([cssArgs]);
    } else {
      isCssBranch = false;
      let node: Node = firstNode;
      const parenValue = node instanceof Paren ? node.value : undefined;
      const condNode = parenValue instanceof Node ? parenValue : node;
      args = new List([condNode]);

      $.OR([
        {
          ALT: () => {
            $.CONSUME(T.Semi);
            node = $.SUBRULE2($.valueList, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
            args = new List([...args.value, node], args.options, $.getLocationFromNodes([...args.value, node]), $.context);
            $.OPTION(() => {
              $.CONSUME4(T.Semi);
              node = $.SUBRULE3($.valueList, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
              args = new List([...args.value, node], args.options, $.getLocationFromNodes([...args.value, node]), $.context);
            });
          }
        },
        {
          ALT: () => {
            $.CONSUME(T.Comma);
            node = $.SUBRULE($.callArgument, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
            args = new List([...args.value, node], args.options, $.getLocationFromNodes([...args.value, node]), $.context);
            $.OPTION2(() => {
              $.CONSUME2(T.Comma);
              node = $.SUBRULE2($.callArgument, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
              args = new List([...args.value, node], args.options, $.getLocationFromNodes([...args.value, node]), $.context);
            });
          }
        }
      ]);
      $.CONSUME3(T.RParen);
    }

    let location = $.endRule();
    let nameNode = new Reference('if', {
      type: 'function',
      fallbackValue: isCssBranch ? true : undefined
    }, $.getLocationInfo(name), $.context);
    const callNode = new Call({ name: nameNode, args }, undefined, location, $.context);
    return callNode;
  };
}

export function booleanFunction(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.BooleanFunction);
    let arg: Node = $.SUBRULE($.guardInner, { ARGS: [{ ...ctx, inValueList: true }] });
    $.CONSUME(T.RParen);

    let location = $.endRule();
    const argValue = arg instanceof Paren ? arg.value : undefined;
    const conditionNode = argValue instanceof Node ? argValue : arg;
    const exprNode = new Expression(conditionNode, { parens: true }, location, $.context);
    return exprNode;
  };
}

export function varReference(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let node: Node | undefined = $.OR([
      {
        ALT: () => {
          let token = $.CONSUME(T.PropertyReference);
          if ($.RECORDING_PHASE) {
            return;
          }
          // Warn about $ident in custom property values - it's treated as literal text, not a property reference
          if (ctx.inCustomPropertyValue) {
            const atName = token.image;
            const ident = token.image.slice(1);
            $.warnDeprecation(
              `${atName} in custom property values is treated as literal text, not a property reference. Use \${${ident}} if you want it to be evaluated.`,
              token,
              'property-in-unknown-value'
            );
            return new Reference(
              { key: token.image.slice(1) },
              { type: 'property', role: 'ident' },
              $.getLocationInfo(token),
              $.context
            );
          }
          return new Reference(token.image.slice(1), { type: 'property' }, $.getLocationInfo(token), $.context);
        }
      },
      {
        ALT: () => {
          let token = $.CONSUME(T.NestedReference);
          if ($.RECORDING_PHASE) {
            return;
          }
          const raw = token.image;
          const type: 'variable' | 'property' = raw.startsWith('@') ? 'variable' : 'property';
          const key = getInterpolatedOrString(raw);
          if (ctx.inCustomPropertyValue && typeof key === 'string') {
            return new Reference({ key }, { type: 'variable', role: 'ident' }, $.getLocationInfo(token), $.context);
          }
          if (typeof key === 'string') {
            return new Reference(key, { type }, $.getLocationInfo(token), $.context);
          }
          return new Reference({ key }, { type }, $.getLocationInfo(token), $.context);
        }
      },
      {
        ALT: () => {
          let token = $.SUBRULE($.varName, { ARGS: [ctx] });
          if ($.RECORDING_PHASE) {
            return;
          }
          // Warn about @ident in custom property values - it's treated as literal text, not a variable reference
          if (ctx.inCustomPropertyValue) {
            const atName = token.image;
            const ident = token.image.slice(1);
            $.warnDeprecation(
              `${atName} in custom property values is treated as literal text, not a variable reference. Use @{${ident}} if you want it to be evaluated.`,
              token,
              'variable-in-unknown-value'
            );
            return new Reference(
              { key: token.image.slice(1) },
              { type: 'variable', role: 'ident' },
              $.getLocationInfo(token),
              $.context
            );
          }
          return new Reference(token.image.slice(1), { type: 'variable' }, $.getLocationInfo(token), $.context);
        }
      }
    ]);
    $.OR2([
      {
        ALT: () => {
          /** This spreads a (list) value within a containing list when evaluated */
          let token = $.CONSUME(T.Ellipsis);
          if (!$.RECORDING_PHASE) {
            node = new Rest(node, undefined, $.getLocationFromNodes([node!, token]), $.context);
          }
        }
      },
      {
        /** Only variables can have accessors */
        GATE: () => {
          if (node?.options?.type !== 'variable') {
            return false;
          }
          let next = $.LA(1).tokenType;
          if (next !== T.LSquare && next !== T.LParen) {
            return false;
          }
          if (!$.noSep()) {
            return false;
          }
          return true;
        },
        ALT: () => {
          $.AT_LEAST_ONE({
            GATE: () => {
              let next = $.LA(1).tokenType;
              if (next !== T.LSquare && next !== T.LParen) {
                return false;
              }
              if (!$.noSep()) {
                return false;
              }
              return true;
            },
            DEF: () => {
              node = $.SUBRULE($.lookupOrCall, { ARGS: [{ ...ctx, node: node! }] });
            }
          });
          $.OPTION(() => {
            $.OPTION2(() => $.CONSUME(T.Gt));
            node = $.SUBRULE($.mixinReference, { ARGS: [{ ...ctx, node: node! }] });
          });
        }
      },
      { ALT: () => undefined }
    ]);

    return $.wrap(node!);
  };
}

export function valueReference(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE2($.mixinReference, { ARGS: [ctx] }) }
    ]);
  };
}

export function functionCall(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const modernColorFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
    const isModernColorCall = (name: string, args?: List<Node>) => {
      if (!modernColorFunctions.has(name.toLowerCase())) {
        return false;
      }
      if (!args || args.value.length !== 1) {
        return false;
      }
      const firstArg = args.value[0];
      return Boolean(isNode(firstArg, N.Sequence) && firstArg.value.length >= 2);
    };

    let funcAlt = (ctx: RuleContext = {}) => [
      {
        // Disambiguate known functions by their dedicated tokens
        GATE: () => {
          let tokenType = $.LA(1).tokenType;
          return tokenType === T.UrlStart
            || tokenType === T.Var
            || tokenType === T.Calc
            || tokenType === T.IfFunction
            || tokenType === T.BooleanFunction;
        },
        ALT: () => $.SUBRULE($.knownFunctions, { ARGS: [ctx] })
      },
      {
        // Generic function via FunctionStart token
        GATE: () => {
          let tokenType = $.LA(1).tokenType;
          return tokenType !== T.UrlStart
            && tokenType !== T.Var
            && tokenType !== T.Calc
            && tokenType !== T.IfFunction
            && tokenType !== T.BooleanFunction;
        },
        ALT: () => {
          $.startRule();
          const fnStart = $.CONSUME(T.FunctionStart);
          const fnNameForCtx = fnStart.image.slice(0, -1);
          let args: List<Node> | undefined;
          $.OPTION(() => args = $.SUBRULE2($.functionCallArgs, { ARGS: [{ ...ctx, currentFunctionName: fnNameForCtx }] }));
          $.CONSUME(T.RParen);
          const location = $.endRule();
          const nameValue = fnNameForCtx;
          if (nameValue === 'unit' && args?.value[1] instanceof Any) {
            const unitArg = args.value[1];
            const quotedUnit = new Quoted(unitArg.valueOf(), { quote: '"' }, undefined, $.context);
            quotedUnit.pre = unitArg.pre;
            quotedUnit.post = unitArg.post;
            const newArgsData = [...args.value];
            newArgsData[1] = quotedUnit;
            args = new List(newArgsData, args.options, $.getLocationFromNodes(newArgsData), $.context);
          }
          const nameNode = new Reference(nameValue, { type: 'function', fallbackValue: true }, $.getLocationInfo(fnStart), $.context);
          /** Less / Sass functions we try to call that throw just get turned into calls. */
          const modernSyntax = isModernColorCall(nameValue, args);
          return new Call(
            { name: nameNode, args },
            { silentFail: true, ...(modernSyntax ? { modernSyntax: true } : {}) },
            location,
            $.context
          );
        }
      }
    ];

    return $.OR(funcAlt(ctx));
  };
}

export function functionCallArgs(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    // Inside function arguments, allow inner tokens like ':'
    const prevInner = ctx.inner;
    ctx.inner = true;
    // Calls intentionally push a `false` paren frame (matches `Call.evalNode`)
    const argCtx: RuleContext = {
      ...ctx,
      allowComma: false,
      parenFrames: [...getParenFrames(ctx), false],
      detachedRulesetUsage: 'function-arg',
      inFunctionArgs: true
    };
    let commaNodes: Node[];
    let semiNodes: Node[] = [];
    let isSemiList = false;
    try {
      let node = $.SUBRULE($.callArgument, { ARGS: [argCtx] });

      commaNodes = [$.wrap(node, true)];

      // First, consume any comma-separated arguments
      $.MANY({
        GATE: () => $.isType(T.Comma),
        DEF: () => {
          $.CONSUME(T.Comma);
          node = $.SUBRULE2($.callArgument, { ARGS: [argCtx] });
          commaNodes!.push($.wrap(node, true));
        }
      });

      // Then, optionally switch to semicolon-separated list and continue with semicolons
      $.OPTION(() => {
        $.CONSUME(T.Semi);
        isSemiList = true;

        // Aggregate the previous set of comma-nodes as the first semi item
        if (commaNodes.length > 1) {
          semiNodes.push(new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), $.context));
        } else {
          semiNodes.push(commaNodes[0]!);
        }

        node = $.SUBRULE3($.callArgument, { ARGS: [{ ...argCtx, allowComma: true }] });
        semiNodes.push($.wrap(node, true));

        $.MANY2({
          GATE: () => $.isType(T.Semi),
          DEF: () => {
            $.CONSUME2(T.Semi);
            node = $.SUBRULE4($.callArgument, { ARGS: [{ ...argCtx, allowComma: true }] });
            semiNodes.push($.wrap(node, true));
          }
        });
      });
    } finally {
      ctx.inner = prevInner;
    }
    $.endRule();
    const nodes = isSemiList ? semiNodes! : commaNodes!;
    return new List(nodes, isSemiList ? { sep: ';' } : undefined);
  };
}

export function value(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    if ($.isType(T.Percent)) {
      // no-op: preserved from original
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    let _isMixinReference = undefined as boolean | undefined;
    const isMixinReference = () => {
      if (_isMixinReference === undefined) {
        let tt1 = $.LA(1).tokenType;
        let tt2 = $.LA(2).tokenType;
        /**
         * We'll allow a few "bare" mixin references without parens
         * or square brackets, but not if they'll conflict with
         * other syntax.
         */
        _isMixinReference =
        tt1 === T.DotName
        || tt1 === T.HashName
        || tt1 === T.InterpolatedSelector
        || (
          (
            tt1 === T.ColorIdentStart
            || tt1 === T.InterpolatedSelector
          ) && (
            tt2 === T.Gt
            || tt2 === T.DotName
            || tt2 === T.HashName
            || tt2 === T.InterpolatedSelector
            || (
              $.noSep(1)
              && (
                tt2 === T.LParen
                || tt2 === T.LSquare
                || tt2 === T.HashName
                || tt2 === T.DotName
              )
            )
          )
        );
      }
      return _isMixinReference;
    };
    let node: Node = $.OR([
      {
        GATE: () => $.check(T.FunctionStart),
        ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] })
      },
      {
        GATE: () => $.isType(T.Star) && $.isTypeAt(2, T.LSquare),
        ALT: () => $.SUBRULE($.selectorCapture, { ARGS: [ctx] })
      },
      {
        GATE: isMixinReference,
        ALT: () => $.SUBRULE($.mixinReference, { ARGS: [ctx] })
      },
      {
        GATE: () => !isMixinReference(),
        ALT: () => $.CONSUME(T.Color)
      },
      {
        GATE: () => !isMixinReference(),
        ALT: () => $.CONSUME2(T.Ident)
      },
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.DefaultGuardFunc) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.Number) },
      {
        GATE: () => ctx.currentFunctionName === 'unit',
        ALT: () => $.CONSUME(T.Percent)
      },
      { ALT: () => $.CONSUME(T.UnicodeRange) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.JavaScript) },
      /** Explicitly not marked as an ident */
      { ALT: () => $.CONSUME(T.When) },
      { ALT: () => $.SUBRULE($.squareValue, { ARGS: [ctx] }) },
      {
        GATE: () => $.looseMode && !!ctx.inner,
        ALT: () => $.CONSUME(T.Colon)
      },
      {
        /** e.g. alpha(opacity=@var) */
        GATE: () => $.looseMode && !!ctx.inFunctionArgs,
        ALT: () => $.CONSUME(T.Eq)
      },
      {
        GATE: () => $.looseMode,
        ALT: () => $.CONSUME(T.Unknown)
      },
      {
        /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
        GATE: () => $.legacyMode,
        ALT: () => $.CONSUME(T.LegacyMSFilter)
      }
    ]);
    if (!$.RECORDING_PHASE) {
      if (!(node instanceof Node)) {
        node = $.processValueToken(node);
      }
      return $.wrap(node);
    }
  };
}

export function string(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let stringAlt = [
      {
        GATE: () => $.isType(T.SingleQuoteStart),
        ALT: () => {
          $.startRule();
          let quote: IToken = $.CONSUME(T.SingleQuoteStart);
          let contents: IToken | undefined;
          $.OPTION2(() => contents = $.CONSUME(T.SingleQuoteStringContents));
          $.CONSUME(T.SingleQuoteEnd);
          let quoteImg: string = quote.image;
          let escaped = false;
          if (quoteImg.startsWith('~')) {
            escaped = true;
            quoteImg = quoteImg.slice(1);
          }
          let location = $.endRule();
          let value = contents?.image;
          if (escaped && value) {
            value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
          }

          const quoteChar = quoteImg as '"' | '\'';
          if (value && (value.includes('@{') || value.includes('${'))) {
            return new Quoted(processStringInterpolation(value, location, $.context), { quote: quoteChar, escaped }, location, $.context);
          }

          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteChar, escaped }, location, $.context);
        }
      },
      {
        GATE: () => $.isType(T.DoubleQuoteStart),
        ALT: () => {
          $.startRule();
          let quote: IToken = $.CONSUME(T.DoubleQuoteStart);
          let contents: IToken | undefined;
          $.OPTION3(() => contents = $.CONSUME(T.DoubleQuoteStringContents));
          $.CONSUME(T.DoubleQuoteEnd);
          let quoteImg: string = quote.image;
          let escaped = false;
          if (quoteImg.startsWith('~')) {
            escaped = true;
            quoteImg = quoteImg.slice(1);
          }
          let location = $.endRule();
          let value = contents?.image;
          if (escaped && value) {
            value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
          }

          const quoteChar = quoteImg as '"' | '\'';
          if (value && (value.includes('@{') || value.includes('${'))) {
            return new Quoted(processStringInterpolation(value, location, $.context), { quote: quoteChar, escaped }, location, $.context);
          }

          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteChar, escaped }, location, $.context);
        }
      }
    ];

    return $.OR(stringAlt);
  };
}

// ── String interpolation helpers ──────────────────────────────────────

/**
 * Find interpolation patterns like @{...} or ${...}, handling nested braces.
 * Returns an array of { start, end, prefix, content } for each match.
 */
function findInterpolations(value: string): Array<{ start: number; end: number; prefix: string; content: string }> {
  const matches: Array<{ start: number; end: number; prefix: string; content: string }> = [];
  let i = 0;

  while (i < value.length) {
    // Look for @{ or ${
    if ((value[i] === '@' || value[i] === '$') && value[i + 1] === '{') {
      const prefix = value[i]!;
      const start = i;
      i += 2; // Skip @{ or ${
      let braceCount = 1;
      const contentStart = i;

      // Find matching closing brace, counting nested braces
      while (i < value.length && braceCount > 0) {
        if (value[i] === '{') {
          braceCount++;
        } else if (value[i] === '}') {
          braceCount--;
        }
        i++;
      }

      if (braceCount === 0) {
        const content = value.slice(contentStart, i - 1);
        matches.push({ start, end: i, prefix, content });
      }
    } else {
      i++;
    }
  }

  return matches;
}

// Helper function to process string interpolation (handles nested @{...} patterns)
function processStringInterpolation(value: string, location: LocationInfo, context: TreeContext): Any | Interpolated {
  const matches = findInterpolations(value);

  if (matches.length === 0) {
    return new Any(value, { role: 'any' }, location, context);
  }

  const replacements: Node[] = [];
  let source = value;
  let offset = 0;

  for (const match of matches) {
    const adjustedStart = match.start - offset;
    const adjustedEnd = match.end - offset;
    const before = source.slice(0, adjustedStart);
    const after = source.slice(adjustedEnd);
    source = before + INTERPOLATION_PLACEHOLDER + after;
    offset += (match.end - match.start) - INTERPOLATION_PLACEHOLDER.length;

    // Recursively process the content in case it has nested interpolation
    const innerResult = processStringInterpolation(match.content, location, context);
    if (innerResult instanceof Interpolated) {
      // Nested interpolation in string contexts still resolves through a reference,
      // but must remain expression-wrapped in Jess output.
      const nestedRef = new Reference({ key: innerResult }, { type: 'variable', role: 'ident' }, location, context);
      replacements.push(new Expression(nestedRef, undefined, location, context));
    } else {
      // Simple interpolation reference
      replacements.push(createInterpolatedReference(match.prefix, match.content, location, context));
    }
  }

  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
}

export function mathValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let valueAlt = (ctx: RuleContext = {}) => [
      { ALT: () => $.CONSUME(T.AtKeyword) },
      { ALT: () => $.CONSUME(T.Number) },
      { ALT: () => $.CONSUME(T.Dimension) },
      // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
      { ALT: () => $.CONSUME(T.Ident) },
      { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
      {
        /** Only allow escaped strings in calc */
        GATE: () => $.LA(1).image.startsWith('~'),
        ALT: () => $.SUBRULE2($.string, { ARGS: [ctx] })
      },
      {
        /** For some reason, e() goes here instead of $.function */
        GATE: () => !$.isTypeAt(2, T.LParen),
        ALT: () => $.CONSUME(T.MathConstant)
      },
      { ALT: () => $.SUBRULE($.mathParen, { ARGS: [ctx] }) }
    ];

    return cssMathValue.call($, T, valueAlt)(ctx);
  };
}

export function mathProduct(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left: Node = $.SUBRULE($.mathValue, { ARGS: [ctx] });

    while ($.isType(T.Star) || $.isType(T.Divide)) {
      const op: IToken = $.isType(T.Star)
        ? $.CONSUME(T.Star)
        : $.CONSUME(T.Divide);
      const right: Node = $.SUBRULE2($.mathValue, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        const opStr = op.image as Operator;
        left = new Operation([left, opStr, right], { inCalc: true }, undefined, $.context);
      }
    }

    if (RECORDING_PHASE) {
      return;
    }
    left._location = $.endRule();
    return left;
  };
}

export function mathSum(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left: Node = $.SUBRULE($.mathProduct, { ARGS: [ctx] });

    $.MANY(() => {
      const op: IToken = $.CONSUME(T.AdditionOperator);
      const right: Node = $.SUBRULE2($.mathProduct, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        const opStr = op.image as Operator;
        left = new Operation([left, opStr, right], { inCalc: true }, undefined, $.context);
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    left._location = $.endRule();
    return left;
  };
}
