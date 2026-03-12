// Values productions for LessRecursiveParser
// Converted from Chevrotain-based productions.ts (lines 2060-3015)
import type { RuleContext } from '../lessRecursiveParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import { tokenMatches } from '@jesscss/parser-runtime';
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
  this.startRule();

  let left = this.expressionProduct(ctx);

  this.many({
    /**
     * What this GATE does. We need to dis-ambiguate
     * 1 -1 (a value sequence) from 1-1 (a Less expression),
     * so Less is white-space sensitive here.
     */
    GATE: () => {
      const next = this.la(1);
      const nextType = next.tokenType;
      return (
        nextType === this.T.Plus
        || nextType === this.T.Minus
        || (this.noSep() && tokenMatches(next, this.T.Signed))
      );
    },
    DEF: () => {
      let op: string | undefined;
      let right: Node;

      this.or([
        {
          ALT: () => {
            let opToken = this.or([
              { ALT: () => this.consume(this.T.Plus) },
              { ALT: () => this.consume(this.T.Minus) }
            ]);
            op = opToken.image;
            right = this.expressionProduct(ctx);
          }
        },
        /** This will be interpreted by Less as a complete expression */
        {
          ALT: () => {
            // Consume a signed literal and convert it without rewinding
            const tok = this.consume(this.T.Signed);
            let startValue: Node | undefined;
            const str = tok.image;
            op = str[0];
            // Build a literal node from the signed token directly
            // Prefer dimension if payload exists, else number, else ident fallback
            if (tok.payload && tok.payload[1]) {
              const dim = { number: parseFloat(tok.payload[0]), unit: tok.payload[1] };
              startValue = new Dimension(dim, undefined, this.getLocationInfo(tok), this.context);
            } else {
              const num = parseFloat(str);
              if (!Number.isNaN(num)) {
                startValue = new Num(num, undefined, this.getLocationInfo(tok), this.context);
              } else {
                startValue = this.processValueToken(tok);
              }
            }
            // Delegate to expressionProduct for any trailing * / %
            // e.g. 6px-1px*2 -> 6px - (1px * 2)
            right = this.expressionProduct({ ...ctx, startValue });
          }
        }
      ]);

      const operation = new Operation(
        [this.wrap(left, true), op as Operator, this.wrap(right!)],
        undefined,
        this.getLocationFromNodes([left, right!]),
        this.context
      );
      left = operation;

      return left;
    }
  });

  this.endRule();

  return left;
}

export function expressionProduct(this: P, ctx: RuleContext = {}) {
  let opAlt = [
    { ALT: () => this.consume(this.T.Star) },
    { ALT: () => this.consume(this.T.Slash) },
    { ALT: () => this.consume(this.T.Percent) }
  ];

  this.startRule();

  let left = ctx.startValue ?? this.expressionValue(ctx);

  this.many(() => {
    let op = this.or(opAlt);
    // Check for deprecated ./ operator
    if (op.image === './') {
      this.warnDeprecation(
        './ operator is deprecated',
        op,
        'dot-slash-operator'
      );
    }
    let right: Node = this.expressionValue(ctx);

    const operation = new Operation(
      [this.wrap(left, true), op.image as Operator, this.wrap(right)],
      undefined,
      this.getLocationFromNodes([left, right]),
      this.context
    );
    left = operation;
  });

  this.endRule();

  return left;
}

export function expressionValue(this: P, ctx: RuleContext = {}) {
  this.startRule();
  /** Can create a negative expression */
  let minus = this.option(() => this.consume(this.T.Minus));
  let node = this.or([
    {
      ALT: () => {
        this.startRule();
        let escape: IToken | undefined;
        this.option(() => {
          escape = this.consume(this.T.Tilde);
        });

        this.consume(this.T.LParen);
        const innerCtx: RuleContext = {
          ...ctx,
          inner: true,
          allowComma: true,
          // Parentheses in Less enable "math in parens" semantics
          parenFrames: [...getParenFrames(ctx), true]
        };
        let node = this.valueList(innerCtx);

        // ~() paren escapes also support semicolons as separators: ~(1; 2; 3)
        let isSemiList = false;
        if (escape) {
          let semiNodes: Node[] = [];
          this.option(() => {
            this.consume(this.T.Semi);
            isSemiList = true;
            semiNodes.push(this.wrap(node, true));
            node = this.valueList(innerCtx);
            semiNodes.push(this.wrap(node, true));
            this.many(() => {
              this.consume(this.T.Semi);
              node = this.valueList(innerCtx);
              semiNodes.push(this.wrap(node, true));
            });
          });
          if (isSemiList) {
            node = new List(semiNodes, { sep: ';' });
          }
        }

        this.consume(this.T.RParen);

        let location = this.endRule();
        node = this.wrap(node, 'both');
        return new Paren(node, { escaped: !!escape }, location, this.context);
      }
    },
    { ALT: () => this.value(ctx) }
  ]);
  let location = this.endRule();
  if (minus) {
    return new Negative(node, undefined, location, this.context);
  }
  return node;
}

/**
 * Add interpolation
 */
export function nthValue(this: P, ctx: RuleContext = {}) {
  let nthValueAlt = (ctx: RuleContext = {}) => [
    { ALT: () => this.consume(this.T.InterpolatedIdent) },
    { ALT: () => this.consume(this.T.NthOdd) },
    { ALT: () => this.consume(this.T.NthEven) },
    { ALT: () => this.consume(this.T.Integer) },
    {
      ALT: () => {
        this.or([
          { ALT: () => this.consume(this.T.NthSignedDimension) },
          { ALT: () => this.consume(this.T.NthUnsignedDimension) },
          { ALT: () => this.consume(this.T.NthSignedPlus) },
          { ALT: () => this.consume(this.T.NthIdent) }
        ]);
        this.option(() => {
          this.or([
            { ALT: () => this.consume(this.T.SignedInt) },
            {
              ALT: () => {
                this.consume(this.T.Minus);
                this.consume(this.T.UnsignedInt);
              }
            }
          ]);
        });
        this.option(() => {
          this.consume(this.T.Of);
          this.complexSelector(ctx);
        });
      }
    }
  ];

  return cssNthValue.call(this, ctx, nthValueAlt);
}

export function knownFunctions(this: P, ctx: RuleContext = {}) {
  let functions = (ctx: RuleContext = {}) => [
    { ALT: () => this.urlFunction(ctx) },
    { ALT: () => this.varFunction(ctx) },
    { ALT: () => this.calcFunction(ctx) },
    // colorFunction is already in cssKnownFunctions default, so we don't need to add it here
    { ALT: () => this.ifFunction(ctx) },
    { ALT: () => this.booleanFunction(ctx) }
  ];

  return cssKnownFunctions.call(this, ctx, functions);
}

/**
 * Override CSS calc() parsing so we can maintain parse-time `calcFrames`.
 * This is the parse-time analogue of `Call.evalNode`'s calcFrames++/--.
 */
export function calcFunction(this: P, ctx: RuleContext = {}) {
  this.startRule();

  this.consume(this.T.Calc);
  const innerCtx = withCalcFrame(ctx, 1);
  const args = this.mathSum(innerCtx);
  this.consume(this.T.RParen);

  const location = this.endRule();
  return new Call({
    name: 'calc',
    args: new List([args])
  }, undefined, location, this.context);
}

export function ifFunction(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let name = this.consume(this.T.IfFunction);
  let args = new List<Node>([]);
  let isCssBranch = false;

  this.or([
    {
      ALT: () => {
        isCssBranch = true;
        const cssArgs = this.ifFunctionArgs({ ...ctx, inner: true });
        this.consume(this.T.RParen);
        args = new List([cssArgs]);
      }
    },
    {
      ALT: () => {
        isCssBranch = false;

        let node: Node = this.guardInner({ ...ctx, inValueList: true });
        const condNode = node instanceof Paren && node.value instanceof Node ? node.value : node;
        args = new List([condNode]);

        this.or([
          {
            ALT: () => {
              this.consume(this.T.Semi);
              node = this.valueList({ ...ctx, allowAnonymousMixins: true });
              args.value.push(node);
              this.option(() => {
                this.consume(this.T.Semi);
                node = this.valueList({ ...ctx, allowAnonymousMixins: true });
                args.value.push(node);
              });
            }
          },
          {
            ALT: () => {
              this.consume(this.T.Comma);
              node = this.callArgument({ ...ctx, allowAnonymousMixins: true });
              args.value.push(node);
              this.option(() => {
                this.consume(this.T.Comma);
                node = this.callArgument({ ...ctx, allowAnonymousMixins: true });
                args.value.push(node);
              });
            }
          }
        ]);
        this.consume(this.T.RParen);
      }
    }
  ]);

  let location = this.endRule();
  let nameNode = new Reference('if', {
    type: 'function',
    fallbackValue: isCssBranch ? true : undefined
  }, this.getLocationInfo(name), this.context);
  const callNode = new Call({ name: nameNode, args }, undefined, location, this.context);
  return callNode;
}

export function booleanFunction(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.BooleanFunction);
  let arg: Node = this.guardInner({ ...ctx, inValueList: true });
  this.consume(this.T.RParen);

  let location = this.endRule();
  const conditionNode = arg instanceof Paren && arg.value instanceof Node ? arg.value : arg;
  const exprNode = new Expression(conditionNode, { parens: true }, location, this.context);
  return exprNode;
}

export function varReference(this: P, ctx: RuleContext = {}) {
  let node: Node | undefined = this.or([
    {
      ALT: () => {
        let token = this.consume(this.T.PropertyReference);
        // Warn about $ident in custom property values - it's treated as literal text, not a property reference
        if (ctx.inCustomPropertyValue) {
          const atName = token.image;
          const ident = token.image.slice(1);
          this.warnDeprecation(
            `${atName} in custom property values is treated as literal text, not a property reference. Use \${${ident}} if you want it to be evaluated.`,
            token,
            'property-in-unknown-value'
          );
          return new Reference(
            { key: token.image.slice(1) },
            { type: 'property', role: 'ident' },
            this.getLocationInfo(token),
            this.context
          );
        }
        return new Reference(token.image.slice(1), { type: 'property' }, this.getLocationInfo(token), this.context);
      }
    },
    {
      ALT: () => {
        let token = this.consume(this.T.NestedReference);
        const raw = token.image;
        const type: 'variable' | 'property' = raw.startsWith('@') ? 'variable' : 'property';
        const key = getInterpolatedOrString(raw);
        if (ctx.inCustomPropertyValue && typeof key === 'string') {
          return new Reference({ key }, { type: 'variable', role: 'ident' }, this.getLocationInfo(token), this.context);
        }
        if (typeof key === 'string') {
          return new Reference(key, { type }, this.getLocationInfo(token), this.context);
        }
        return new Reference({ key }, { type }, this.getLocationInfo(token), this.context);
      }
    },
    {
      ALT: () => {
        let token = this.varName(ctx);
        // Warn about @ident in custom property values - it's treated as literal text, not a variable reference
        if (ctx.inCustomPropertyValue) {
          const atName = token.image;
          const ident = token.image.slice(1);
          this.warnDeprecation(
            `${atName} in custom property values is treated as literal text, not a variable reference. Use @{${ident}} if you want it to be evaluated.`,
            token,
            'variable-in-unknown-value'
          );
          return new Reference(
            { key: token.image.slice(1) },
            { type: 'variable', role: 'ident' },
            this.getLocationInfo(token),
            this.context
          );
        }
        return new Reference(token.image.slice(1), { type: 'variable' }, this.getLocationInfo(token), this.context);
      }
    }
  ]);
  this.or([
    {
      ALT: () => {
        /** This spreads a (list) value within a containing list when evaluated */
        let token = this.consume(this.T.Ellipsis);
        node = new Rest(node, undefined, this.getLocationFromNodes([node!, token]), this.context);
      }
    },
    {
      /** Only variables can have accessors */
      GATE: () => {
        if (node?.options?.type !== 'variable') {
          return false;
        }
        let next = this.la(1).tokenType;
        if (next !== this.T.LSquare && next !== this.T.LParen) {
          return false;
        }
        if (!this.noSep()) {
          return false;
        }
        return true;
      },
      ALT: () => {
        this.atLeastOne({
          GATE: () => {
            let next = this.la(1).tokenType;
            if (next !== this.T.LSquare && next !== this.T.LParen) {
              return false;
            }
            if (!this.noSep()) {
              return false;
            }
            return true;
          },
          DEF: () => {
            node = this.lookupOrCall({ ...ctx, node: node! });
          }
        });
        this.option(() => {
          this.option(() => this.consume(this.T.Gt));
          node = this.mixinReference({ ...ctx, node: node! });
        });
      }
    },
    { ALT: () => undefined }
  ]);

  return this.wrap(node!);
}

export function valueReference(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.varReference(ctx) },
    { ALT: () => this.mixinReference(ctx) }
  ]);
}

export function functionCall(this: P, ctx: RuleContext = {}) {
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
        let tokenType = this.la(1).tokenType;
        return tokenType === this.T.UrlStart
          || tokenType === this.T.Var
          || tokenType === this.T.Calc
          || tokenType === this.T.IfFunction
          || tokenType === this.T.BooleanFunction;
      },
      ALT: () => this.knownFunctions(ctx)
    },
    {
      // Generic function via FunctionStart token
      GATE: () => {
        let tokenType = this.la(1).tokenType;
        return tokenType !== this.T.UrlStart
          && tokenType !== this.T.Var
          && tokenType !== this.T.Calc
          && tokenType !== this.T.IfFunction
          && tokenType !== this.T.BooleanFunction;
      },
      ALT: () => {
        this.startRule();
        const fnStart = this.consume(this.T.FunctionStart);
        const fnNameForCtx = fnStart.image.slice(0, -1);
        let args: List<Node> | undefined;
        this.option(() => args = this.functionCallArgs({ ...ctx, currentFunctionName: fnNameForCtx }));
        this.consume(this.T.RParen);
        const location = this.endRule();
        const nameValue = fnNameForCtx;
        if (nameValue === 'unit' && args?.value[1] instanceof Any) {
          const unitArg = args.value[1];
          const quotedUnit = new Quoted(unitArg.valueOf(), { quote: '"' }, undefined, this.context);
          quotedUnit.pre = unitArg.pre;
          quotedUnit.post = unitArg.post;
          args.value[1] = quotedUnit;
        }
        const nameNode = new Reference(nameValue, { type: 'function', fallbackValue: true }, this.getLocationInfo(fnStart), this.context);
        /** Less / Sass functions we try to call that throw just get turned into calls. */
        const modernSyntax = isModernColorCall(nameValue, args);
        return new Call(
          { name: nameNode, args },
          { silentFail: true, ...(modernSyntax ? { modernSyntax: true } : {}) },
          location,
          this.context
        );
      }
    }
  ];

  return this.or(funcAlt(ctx));
}

export function functionCallArgs(this: P, ctx: RuleContext = {}) {
  this.startRule();

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
    let node = this.callArgument(argCtx);

    commaNodes = [this.wrap(node, true)];

    // First, consume any comma-separated arguments
    this.many(() => {
      this.consume(this.T.Comma);
      node = this.callArgument(argCtx);
      commaNodes!.push(this.wrap(node, true));
    });

    // Then, optionally switch to semicolon-separated list and continue with semicolons
    this.option(() => {
      this.consume(this.T.Semi);
      isSemiList = true;

      // Aggregate the previous set of comma-nodes as the first semi item
      if (commaNodes.length > 1) {
        semiNodes.push(new List(commaNodes, undefined, this.getLocationFromNodes(commaNodes), this.context));
      } else {
        semiNodes.push(commaNodes[0]!);
      }

      node = this.callArgument({ ...argCtx, allowComma: true });
      semiNodes.push(this.wrap(node, true));

      this.many(() => {
        this.consume(this.T.Semi);
        node = this.callArgument({ ...argCtx, allowComma: true });
        semiNodes.push(this.wrap(node, true));
      });
    });
  } finally {
    ctx.inner = prevInner;
  }
  this.endRule();
  const nodes = isSemiList ? semiNodes! : commaNodes!;
  return new List(nodes, isSemiList ? { sep: ';' } : undefined);
}

export function value(this: P, ctx: RuleContext = {}) {
  if (this.la(1).tokenType === this.T.Percent) {
    // no-op: preserved from original
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention
  let _isMixinReference = undefined as boolean | undefined;
  const isMixinReference = () => {
    if (_isMixinReference === undefined) {
      let tt1 = this.la(1).tokenType;
      let tt2 = this.la(2).tokenType;
      /**
       * We'll allow a few "bare" mixin references without parens
       * or square brackets, but not if they'll conflict with
       * other syntax.
       */
      _isMixinReference =
      tt1 === this.T.DotName
      || tt1 === this.T.HashName
      || tt1 === this.T.InterpolatedSelector
      || (
        (
          tt1 === this.T.ColorIdentStart
          || tt1 === this.T.InterpolatedSelector
        ) && (
          tt2 === this.T.Gt
          || tt2 === this.T.DotName
          || tt2 === this.T.HashName
          || tt2 === this.T.InterpolatedSelector
          || (
            this.noSep(1)
            && (
              tt2 === this.T.LParen
              || tt2 === this.T.LSquare
              || tt2 === this.T.HashName
              || tt2 === this.T.DotName
            )
          )
        )
      );
    }
    return _isMixinReference;
  };
  let node: Node = this.or([
    { ALT: () => this.functionCall(ctx) },
    {
      GATE: () => this.la(1).tokenType === this.T.Star && this.la(2).tokenType === this.T.LSquare,
      ALT: () => this.selectorCapture(ctx)
    },
    {
      GATE: isMixinReference,
      ALT: () => this.mixinReference(ctx)
    },
    {
      GATE: () => !isMixinReference(),
      ALT: () => this.consume(this.T.Color)
    },
    {
      GATE: () => !isMixinReference(),
      ALT: () => this.consume(this.T.Ident)
    },
    { ALT: () => this.varReference(ctx) },
    { ALT: () => this.consume(this.T.DefaultGuardFunc) },
    { ALT: () => this.consume(this.T.Dimension) },
    { ALT: () => this.consume(this.T.Number) },
    {
      GATE: () => (ctx as any).currentFunctionName === 'unit',
      ALT: () => this.consume(this.T.Percent)
    },
    { ALT: () => this.consume(this.T.UnicodeRange) },
    { ALT: () => this.string(ctx) },
    { ALT: () => this.consume(this.T.JavaScript) },
    /** Explicitly not marked as an ident */
    { ALT: () => this.consume(this.T.When) },
    { ALT: () => this.squareValue(ctx) },
    {
      GATE: () => this.looseMode && !!ctx.inner,
      ALT: () => this.consume(this.T.Colon)
    },
    {
      /** e.g. alpha(opacity=@var) */
      GATE: () => this.looseMode && !!ctx.inFunctionArgs,
      ALT: () => this.consume(this.T.Eq)
    },
    {
      GATE: () => this.looseMode,
      ALT: () => this.consume(this.T.Unknown)
    },
    {
      /** e.g. progid:DXImageTransform.Microsoft.Blur(pixelradius=2) */
      GATE: () => this.legacyMode,
      ALT: () => this.consume(this.T.LegacyMSFilter)
    }
  ]);
  if (!(node instanceof Node)) {
    node = this.processValueToken(node);
  }
  return this.wrap(node);
}

export function string(this: P, ctx: RuleContext = {}) {
  let stringAlt = [
    {
      ALT: () => {
        this.startRule();
        let quote = this.consume(this.T.SingleQuoteStart);
        let contents: IToken | undefined;
        this.option(() => contents = this.consume(this.T.SingleQuoteStringContents));
        this.consume(this.T.SingleQuoteEnd);
        let quoteImg = quote.image;
        let escaped = false;
        if (quoteImg.startsWith('~')) {
          escaped = true;
          quoteImg = quoteImg.slice(1);
        }
        let location = this.endRule();
        let value = contents?.image;
        if (escaped && value) {
          value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
        }

        // Handle interpolation in string contents
        if (value && (value.includes('@{') || value.includes('${'))) {
          return new Quoted(processStringInterpolation(value, location, this.context), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
        }

        return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
      }
    },
    {
      ALT: () => {
        this.startRule();
        let quote = this.consume(this.T.DoubleQuoteStart);
        let contents: IToken | undefined;
        this.option(() => contents = this.consume(this.T.DoubleQuoteStringContents));
        this.consume(this.T.DoubleQuoteEnd);
        let quoteImg = quote.image;
        let escaped = false;
        if (quoteImg.startsWith('~')) {
          escaped = true;
          quoteImg = quoteImg.slice(1);
        }
        let location = this.endRule();
        let value = contents?.image;
        if (escaped && value) {
          value = value.replace(/\\(?:\r\n?|\n|\f)/g, '\n');
        }

        // Handle interpolation in string contents
        if (value && (value.includes('@{') || value.includes('${'))) {
          return new Quoted(processStringInterpolation(value, location, this.context), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
        }

        return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
      }
    }
  ];

  return this.or(stringAlt);
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
  let valueAlt = (ctx: RuleContext = {}) => [
    { ALT: () => this.consume(this.T.AtKeyword) },
    { ALT: () => this.consume(this.T.Number) },
    { ALT: () => this.consume(this.T.Dimension) },
    // Allow identifiers like channel names in color space calcs (e.g., calc(l - 0.1))
    { ALT: () => this.consume(this.T.Ident) },
    { ALT: () => this.functionCall(ctx) },
    {
      /** Only allow escaped strings in calc */
      GATE: () => this.la(1).image.startsWith('~'),
      ALT: () => this.string(ctx)
    },
    {
      /** For some reason, e() goes here instead of $.function */
      GATE: () => this.la(2).tokenType !== this.T.LParen,
      ALT: () => this.consume(this.T.MathConstant)
    },
    { ALT: () => this.mathParen(ctx) }
  ];

  return cssMathValue.call(this, ctx, valueAlt);
}
