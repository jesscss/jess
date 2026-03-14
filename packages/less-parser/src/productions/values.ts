// Values productions for LessRecursiveParser
// Converted from Chevrotain-based productions.ts (lines 2060-3015)
import type { RuleContext } from '../lessRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import { tokenMatches, tokenTypeInSet } from '@jesscss/parser-runtime';
import { CssRecursiveParser } from '@jesscss/css-parser';
import {
  type TreeContext,
  type LocationInfo,
  type Operator,
  Node,
  Any,
  List,
  Sequence,
  Call,
  Paren,
  Operation,
  Quoted,
  Interpolated,
  Reference,
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

// ── Save references to CSS prototype methods ──────────────────────────
const cssNthValue = CssRecursiveParser.prototype.nthValue;
const cssKnownFunctions = CssRecursiveParser.prototype.knownFunctions;
const cssMathValue = CssRecursiveParser.prototype.mathValue;

// ── Helpers ───────────────────────────────────────────────────────────

function getParenFrames(ctx: RuleContext | undefined): boolean[] {
  return (ctx?.parenFrames as boolean[] | undefined) ?? [];
}

function withCalcFrame(ctx: RuleContext | undefined, delta: number): RuleContext {
  const calcFrames = ((ctx?.calcFrames as number | undefined) ?? 0) + delta;
  return { ...(ctx ?? {}), calcFrames };
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

export function expressionSum(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let left = $.expressionProduct(ctx);

  $.MANY({
    /**
     * What this GATE does. We need to dis-ambiguate
     * 1 -1 (a value sequence) from 1-1 (a Less expression),
     * so Less is white-space sensitive here.
     */
    GATE: () => {
      const next = $.LA(1);
      const nextType = next.tokenType;
      return (
        $.isType($.T.Plus)
        || $.isType($.T.Minus)
        || ($.noSep() && tokenMatches(next, $.T.Signed))
      );
    },
    DEF: () => {
      let op: string | undefined;
      let right: Node;

      $.OR([
        {
          ALT: () => {
            let opToken = $.OR([
              { ALT: () => $.CONSUME($.T.Plus) },
              { ALT: () => $.CONSUME($.T.Minus) }
            ]);
            op = opToken.image;
            right = $.expressionProduct(ctx);
          }
        },
        /** This will be interpreted by Less as a complete expression */
        {
          ALT: () => {
            // Consume a signed literal and convert it without rewinding
            const tok = $.CONSUME($.T.Signed);
            let startValue: Node | undefined;
            const str = tok.image;
            op = str[0];
            // Build a literal node from the signed token directly
            // Prefer dimension if payload exists, else number, else ident fallback
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
            // Delegate to expressionProduct for any trailing * / %
            // e.g. 6px-1px*2 -> 6px - (1px * 2)
            right = $.expressionProduct({ ...ctx, startValue });
          }
        }
      ]);

      const operation = new Operation(
        [$.wrap(left, true), op as Operator, $.wrap(right!)],
        undefined,
        $.getLocationFromNodes([left, right!]),
        $.context
      );
      left = operation;

      return left;
    }
  });

  $.endRule();

  return left;
}

export function expressionProduct(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let opAlt = [
    { ALT: () => $.CONSUME($.T.Star) },
    { ALT: () => $.CONSUME($.T.Slash) },
    { ALT: () => $.CONSUME($.T.Percent) }
  ];

  $.startRule();

  let left = ctx.startValue ?? $.expressionValue(ctx);

  $.MANY({
    GATE: () => tokenTypeInSet($.LA(1).tokenType, $.EXPRESSION_PRODUCT_OPERATOR_START),
    DEF: () => {
      let op = $.OR(opAlt);
      // Check for deprecated ./ operator
      if (op.image === './') {
        $.warnDeprecation(
          './ operator is deprecated',
          op,
          'dot-slash-operator'
        );
      }
      let right: Node = $.expressionValue(ctx);

      const operation = new Operation(
        [$.wrap(left, true), op.image as Operator, $.wrap(right)],
        undefined,
        $.getLocationFromNodes([left, right]),
        $.context
      );
      left = operation;
    }
  });

  $.endRule();

  return left;
}

export function expressionValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  /** Can create a negative expression */
  let minus = $.OPTION(() => $.CONSUME($.T.Minus));
  let node = $.OR([
    {
      ALT: () => {
        $.startRule();
        let escape: IToken | undefined;
        $.OPTION(() => {
          escape = $.CONSUME($.T.Tilde);
        });

        $.CONSUME($.T.LParen);
        const innerCtx: RuleContext = {
          ...ctx,
          inner: true,
          allowComma: true,
          // Parentheses in Less enable "math in parens" semantics
          parenFrames: [...getParenFrames(ctx), true]
        };
        let node = $.valueList(innerCtx);

        // ~() paren escapes also support semicolons as separators: ~(1; 2; 3)
        let isSemiList = false;
        if (escape) {
          let semiNodes: Node[] = [];
          $.OPTION(() => {
            $.CONSUME($.T.Semi);
            isSemiList = true;
            semiNodes.push($.wrap(node, true));
            node = $.valueList(innerCtx);
            semiNodes.push($.wrap(node, true));
            $.MANY({
              GATE: () => $.isType($.T.Semi),
              DEF: () => {
                $.CONSUME($.T.Semi);
                node = $.valueList(innerCtx);
                semiNodes.push($.wrap(node, true));
              }
            });
          });
          if (isSemiList) {
            node = new List(semiNodes, { sep: ';' });
          }
        }

        $.CONSUME($.T.RParen);

        let location = $.endRule();
        node = $.wrap(node, 'both');
        return new Paren(node, { escaped: !!escape }, location, $.context);
      }
    },
    { ALT: () => $.value(ctx) }
  ]);
  let location = $.endRule();
  if (minus) {
    return new Negative(node, undefined, location, $.context);
  }
  return node;
}

/**
 * Add interpolation
 */
export function nthValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let nthValueAlt = (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME($.T.InterpolatedIdent) },
    { ALT: () => $.CONSUME($.T.NthOdd) },
    { ALT: () => $.CONSUME($.T.NthEven) },
    { ALT: () => $.CONSUME($.T.Integer) },
    {
      ALT: () => {
        $.OR([
          { ALT: () => $.CONSUME($.T.NthSignedDimension) },
          { ALT: () => $.CONSUME($.T.NthUnsignedDimension) },
          { ALT: () => $.CONSUME($.T.NthSignedPlus) },
          { ALT: () => $.CONSUME($.T.NthIdent) }
        ]);
        $.OPTION(() => {
          $.OR([
            { ALT: () => $.CONSUME($.T.SignedInt) },
            {
              ALT: () => {
                $.CONSUME($.T.Minus);
                $.CONSUME($.T.UnsignedInt);
              }
            }
          ]);
        });
        $.OPTION(() => {
          $.CONSUME($.T.Of);
          $.complexSelector(ctx);
        });
      }
    }
  ];

  return cssNthValue.call(this, ctx, nthValueAlt);
}

export function knownFunctions(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let functions = (ctx: RuleContext = {}) => [
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.varFunction(ctx) },
    { ALT: () => $.calcFunction(ctx) },
    // colorFunction is already in cssKnownFunctions default, so we don't need to add it here
    { ALT: () => $.ifFunction(ctx) },
    { ALT: () => $.booleanFunction(ctx) }
  ];

  return cssKnownFunctions.call(this, ctx, functions);
}

/**
 * Override CSS calc() parsing so we can maintain parse-time `calcFrames`.
 * This is the parse-time analogue of `Call.evalNode`'s calcFrames++/--.
 */
export function calcFunction(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.Calc);
  const innerCtx = withCalcFrame(ctx, 1);
  const args = $.mathSum(innerCtx);
  $.CONSUME($.T.RParen);

  const location = $.endRule();
  return new Call({
    name: 'calc',
    args: new List([args])
  }, undefined, location, $.context);
}

export function ifFunction(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let name = $.CONSUME($.T.IfFunction);
  let args = new List<Node>([]);
  let isCssBranch = false;

  $.OR([
    {
      ALT: () => {
        isCssBranch = true;
        const cssArgs = $.ifFunctionArgs({ ...ctx, inner: true });
        $.CONSUME($.T.RParen);
        args = new List([cssArgs]);
      }
    },
    {
      ALT: () => {
        isCssBranch = false;

        let node: Node = $.guardInner({ ...ctx, inValueList: true });
        const condNode = node instanceof Paren && node.data instanceof Node ? node.data : node;
        args = new List([condNode]);

        $.OR([
          {
            ALT: () => {
              $.CONSUME($.T.Semi);
              node = $.valueList({ ...ctx, allowAnonymousMixins: true });
              args = new List([...args.data, node], args.options, $.getLocationFromNodes([...args.data, node]), $.context);
              $.OPTION(() => {
                $.CONSUME($.T.Semi);
                node = $.valueList({ ...ctx, allowAnonymousMixins: true });
                args = new List([...args.data, node], args.options, $.getLocationFromNodes([...args.data, node]), $.context);
              });
            }
          },
          {
            ALT: () => {
              $.CONSUME($.T.Comma);
              node = $.callArgument({ ...ctx, allowAnonymousMixins: true });
              args = new List([...args.data, node], args.options, $.getLocationFromNodes([...args.data, node]), $.context);
              $.OPTION(() => {
                $.CONSUME($.T.Comma);
                node = $.callArgument({ ...ctx, allowAnonymousMixins: true });
                args = new List([...args.data, node], args.options, $.getLocationFromNodes([...args.data, node]), $.context);
              });
            }
          }
        ]);
        $.CONSUME($.T.RParen);
      }
    }
  ]);

  let location = $.endRule();
  let nameNode = new Reference('if', {
    type: 'function',
    fallbackValue: isCssBranch ? true : undefined
  }, $.getLocationInfo(name), $.context);
  const callNode = new Call({ name: nameNode, args }, undefined, location, $.context);
  return callNode;
}

export function booleanFunction(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.BooleanFunction);
  let arg: Node = $.guardInner({ ...ctx, inValueList: true });
  $.CONSUME($.T.RParen);

  let location = $.endRule();
  const conditionNode = arg instanceof Paren && arg.data instanceof Node ? arg.data : arg;
  const exprNode = new Expression(conditionNode, { parens: true }, location, $.context);
  return exprNode;
}

export function varReference(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let node: Node | undefined = $.OR([
    {
      ALT: () => {
        let token = $.CONSUME($.T.PropertyReference);
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
        let token = $.CONSUME($.T.NestedReference);
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
        let token = $.varName(ctx);
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
  $.OR([
    {
      ALT: () => {
        /** This spreads a (list) value within a containing list when evaluated */
        let token = $.CONSUME($.T.Ellipsis);
        node = new Rest(node, undefined, $.getLocationFromNodes([node!, token]), $.context);
      }
    },
    {
      /** Only variables can have accessors */
      GATE: () => {
        if (node?.options?.type !== 'variable') {
          return false;
        }
        let next = $.LA(1).tokenType;
        if (next !== $.T.LSquare && next !== $.T.LParen) {
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
            if (next !== $.T.LSquare && next !== $.T.LParen) {
              return false;
            }
            if (!$.noSep()) {
              return false;
            }
            return true;
          },
          DEF: () => {
            node = $.lookupOrCall({ ...ctx, node: node! });
          }
        });
        $.OPTION(() => {
          $.OPTION(() => $.CONSUME($.T.Gt));
          node = $.mixinReference({ ...ctx, node: node! });
        });
      }
    },
    { ALT: () => undefined }
  ]);

  return $.wrap(node!);
}

export function valueReference(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    { ALT: () => $.varReference(ctx) },
    { ALT: () => $.mixinReference(ctx) }
  ]);
}

export function functionCall(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const modernColorFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
  const isModernColorCall = (name: string, args?: List<Node>) => {
    if (!modernColorFunctions.has(name.toLowerCase())) {
      return false;
    }
    if (!args || args.data.length !== 1) {
      return false;
    }
    const firstArg = args.data[0];
    return Boolean(isNode(firstArg, N.Sequence) && firstArg.data.length >= 2);
  };

  let funcAlt = (ctx: RuleContext = {}) => [
    {
      // Disambiguate known functions by their dedicated tokens
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType === $.T.UrlStart
          || tokenType === $.T.Var
          || tokenType === $.T.Calc
          || tokenType === $.T.IfFunction
          || tokenType === $.T.BooleanFunction;
      },
      ALT: () => $.knownFunctions(ctx)
    },
    {
      // Generic function via FunctionStart token
      GATE: () => {
        let tokenType = $.LA(1).tokenType;
        return tokenType !== $.T.UrlStart
          && tokenType !== $.T.Var
          && tokenType !== $.T.Calc
          && tokenType !== $.T.IfFunction
          && tokenType !== $.T.BooleanFunction;
      },
      ALT: () => {
        $.startRule();
        const fnStart = $.CONSUME($.T.FunctionStart);
        const fnNameForCtx = fnStart.image.slice(0, -1);
        let args: List<Node> | undefined;
        $.OPTION(() => args = $.functionCallArgs({ ...ctx, currentFunctionName: fnNameForCtx }));
        $.CONSUME($.T.RParen);
        const location = $.endRule();
        const nameValue = fnNameForCtx;
        if (nameValue === 'unit' && args?.data[1] instanceof Any) {
          const unitArg = args.data[1];
          const quotedUnit = new Quoted(unitArg.valueOf(), { quote: '"' }, undefined, $.context);
          quotedUnit.pre = unitArg.pre;
          quotedUnit.post = unitArg.post;
          const newArgsData = [...args.data];
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
}

export function functionCallArgs(this: P, ctx: RuleContext = {}) {
  const $ = this;
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
    let node = $.callArgument(argCtx);

    commaNodes = [$.wrap(node, true)];

    // First, consume any comma-separated arguments
    $.MANY({
      GATE: () => $.isType($.T.Comma),
      DEF: () => {
        $.CONSUME($.T.Comma);
        node = $.callArgument(argCtx);
        commaNodes!.push($.wrap(node, true));
      }
    });

    // Then, optionally switch to semicolon-separated list and continue with semicolons
    $.OPTION(() => {
      $.CONSUME($.T.Semi);
      isSemiList = true;

      // Aggregate the previous set of comma-nodes as the first semi item
      if (commaNodes.length > 1) {
        semiNodes.push(new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), $.context));
      } else {
        semiNodes.push(commaNodes[0]!);
      }

      node = $.callArgument({ ...argCtx, allowComma: true });
      semiNodes.push($.wrap(node, true));

      $.MANY({
        GATE: () => $.isType($.T.Semi),
        DEF: () => {
          $.CONSUME($.T.Semi);
          node = $.callArgument({ ...argCtx, allowComma: true });
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
}

export function value(this: P, ctx: RuleContext = {}) {
  const $ = this;
  if ($.isType($.T.Percent)) {
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
      tt1 === $.T.DotName
      || tt1 === $.T.HashName
      || tt1 === $.T.InterpolatedSelector
      || (
        (
          tt1 === $.T.ColorIdentStart
          || tt1 === $.T.InterpolatedSelector
        ) && (
          tt2 === $.T.Gt
          || tt2 === $.T.DotName
          || tt2 === $.T.HashName
          || tt2 === $.T.InterpolatedSelector
          || (
            $.noSep(1)
            && (
              tt2 === $.T.LParen
              || tt2 === $.T.LSquare
              || tt2 === $.T.HashName
              || tt2 === $.T.DotName
            )
          )
        )
      );
    }
    return _isMixinReference;
  };
  let node: Node = $.OR([
    {
      GATE: () => $.check($.T.FunctionStart),
      ALT: () => $.functionCall(ctx)
    },
    {
      GATE: () => $.isType($.T.Star) && $.isTypeAt(2, $.T.LSquare),
      ALT: () => $.selectorCapture(ctx)
    },
    {
      GATE: isMixinReference,
      ALT: () => $.mixinReference(ctx)
    },
    {
      GATE: () => !isMixinReference(),
      ALT: () => $.CONSUME($.T.Color)
    },
    {
      GATE: () => !isMixinReference(),
      ALT: () => $.CONSUME($.T.Ident)
    },
    { ALT: () => $.varReference(ctx) },
    { ALT: () => $.CONSUME($.T.DefaultGuardFunc) },
    { ALT: () => $.CONSUME($.T.Dimension) },
    { ALT: () => $.CONSUME($.T.Number) },
    {
      GATE: () => (ctx as any).currentFunctionName === 'unit',
      ALT: () => $.CONSUME($.T.Percent)
    },
    { ALT: () => $.CONSUME($.T.UnicodeRange) },
    { ALT: () => $.string(ctx) },
    { ALT: () => $.CONSUME($.T.JavaScript) },
    /** Explicitly not marked as an ident */
    { ALT: () => $.CONSUME($.T.When) },
    { ALT: () => $.squareValue(ctx) },
    {
      GATE: () => $.looseMode && !!ctx.inner,
      ALT: () => $.CONSUME($.T.Colon)
    },
    {
      /** e.g. alpha(opacity=@var) */
      GATE: () => $.looseMode && !!ctx.inFunctionArgs,
      ALT: () => $.CONSUME($.T.Eq)
    },
    {
      GATE: () => $.looseMode,
      ALT: () => $.CONSUME($.T.Unknown)
    },
    {
      /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
      GATE: () => $.legacyMode,
      ALT: () => $.CONSUME($.T.LegacyMSFilter)
    }
  ]);
  if (!(node instanceof Node)) {
    node = $.processValueToken(node);
  }
  return $.wrap(node);
}

export function string(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let stringAlt = [
    {
      GATE: () => $.isType($.T.SingleQuoteStart),
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME($.T.SingleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME($.T.SingleQuoteStringContents));
        $.CONSUME($.T.SingleQuoteEnd);
        let quoteImg = quote.image;
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

        // Handle interpolation in string contents
        if (value && (value.includes('@{') || value.includes('${'))) {
          return new Quoted(processStringInterpolation(value, location, $.context), { quote: quoteImg as '"' | '\'', escaped }, location, $.context);
        }

        return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, $.context);
      }
    },
    {
      GATE: () => $.isType($.T.DoubleQuoteStart),
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME($.T.DoubleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME($.T.DoubleQuoteStringContents));
        $.CONSUME($.T.DoubleQuoteEnd);
        let quoteImg = quote.image;
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

        // Handle interpolation in string contents
        if (value && (value.includes('@{') || value.includes('${'))) {
          return new Quoted(processStringInterpolation(value, location, $.context), { quote: quoteImg as '"' | '\'', escaped }, location, $.context);
        }

        return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, $.context);
      }
    }
  ];

  return $.OR(stringAlt);
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

export function mathValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let valueAlt = (ctx: RuleContext = {}) => [
    { ALT: () => $.CONSUME($.T.AtKeyword) },
    { ALT: () => $.CONSUME($.T.Number) },
    { ALT: () => $.CONSUME($.T.Dimension) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    { ALT: () => $.CONSUME($.T.Ident) },
    { ALT: () => $.functionCall(ctx) },
    {
      /** Only allow escaped strings in calc */
      GATE: () => $.LA(1).image.startsWith('~'),
      ALT: () => $.string(ctx)
    },
    {
      /** For some reason, e() goes here instead of $.function */
      GATE: () => !$.isTypeAt(2, $.T.LParen),
      ALT: () => $.CONSUME($.T.MathConstant)
    },
    { ALT: () => $.mathParen(ctx) }
  ];

  return cssMathValue.call(this, ctx, valueAlt);
}
