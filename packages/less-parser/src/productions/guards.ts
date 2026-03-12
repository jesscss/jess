import type { RuleContext } from '../lessRecursiveParser.js';
import type { IToken, LocationInfo } from '@jesscss/parser-runtime';
import { ParseError } from '@jesscss/parser-runtime';
import { CssRecursiveParser } from '@jesscss/css-parser';
import {
  type TreeContext,
  Node,
  Any,
  Condition,
  type ConditionOperator,
  DefaultGuard,
  Paren,
  List,
  Sequence,
  Call,
  Reference,
  Interpolated,
  Quoted,
  Rest,
  VarDeclaration,
  StyleImport,
  type Url,
  isNode,
  N,
  INTERPOLATION_PLACEHOLDER
} from '@jesscss/core';
import { getInterpolatedOrString } from '../utils.js';

/** Use `any` for `this` to avoid structural incompatibility between LessRecursiveParser and CssRecursiveParser */
type P = any;

function getParenFrames(ctx: RuleContext | undefined): boolean[] {
  return (ctx?.parenFrames as boolean[] | undefined) ?? [];
}

const interpolatedRegex = /([$@])\{([^}]+)\}/g;

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

const getInterpolated = (name: string, location: LocationInfo, context: TreeContext): Interpolated => {
  const replacements: Node[] = [];
  let result: RegExpExecArray | null;
  let source = name;
  interpolatedRegex.lastIndex = 0;
  while (result = interpolatedRegex.exec(name)) {
    const [match, propOrVar, value] = result;
    source = source.replace(match, INTERPOLATION_PLACEHOLDER);
    const reference = createInterpolatedReference(propOrVar!, value!, location, context);
    replacements.push(reference);
  }
  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
};

function isDefaultGuardCall(node: Node | undefined): node is Call {
  if (!node || node.type !== 'Call') {
    return false;
  }
  const callName = (node as Call).value.name;
  const callNameStr = String((callName as any)?.valueOf?.() ?? callName ?? '');
  if (callNameStr === 'default' || callNameStr === '??') {
    return true;
  }
  const key = (callName as any)?.value?.key;
  const keyStr = String((key as any)?.valueOf?.() ?? key ?? '');
  return keyStr === 'default' || keyStr === '??';
}

// Save CSS prototype methods for super calls
const cssUnknownAtRule = CssRecursiveParser.prototype.unknownAtRule;

export function guard(this: P, ctx: RuleContext = {}) {
  this.consume(this.T.When);
  return this.or([
    {
      GATE: () => !!ctx.inValueList,
      ALT: () => this.comparison(ctx)
    },
    {
      ALT: () => {
        ctx.allowComma = true;
        const node = this.guardOr(ctx);
        return node;
      }
    }
  ]);
}

/**
 * 'or' expression
 * Allows an (outer) comma like historical media queries
 */
export function guardOr(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let left = this.guardAnd(ctx);
  let right: Node | undefined;
  this.many({
    GATE: () => {
      const next = this.la(1).tokenType;
      return (ctx.allowComma && next === this.T.Comma) || next === this.T.Or;
    },
    DEF: () => {
      /**
       * Nest expressions within expressions for correct
       * order of operations.
       */
      this.or([
        { ALT: () => this.consume(this.T.Comma) },
        { ALT: () => this.consume(this.T.Or) }
      ]);
      right = this.guardAnd(ctx);
      let location = this.endRule();
      this.startRule();
      left = new Condition(
        [this.wrap(left, true), 'or', this.wrap(right!)],
        undefined,
        location,
        this.context
      );
    }
  });
  this.endRule();
  return left;
}

export function guardDefault(this: P, ctx: RuleContext = {}) {
  let guard = this.or([
    { ALT: () => this.consume(this.T.DefaultGuardIdent) },
    { ALT: () => this.consume(this.T.DefaultGuardFunc) }
  ]);
  ctx.hasDefault = true;
  return new DefaultGuard(guard.image, undefined, this.getLocationInfo(guard), this.context);
}

/**
 * 'and' and 'or' expressions
 *
 *  In Media queries level 4, you cannot have
 *  `([expr]) or ([expr]) and ([expr])` because
 *  of evaluation order ambiguity.
 *  However, Less allows it.
 */
export function guardAnd(this: P, ctx: RuleContext = {}) {
  let left: Node;
  this.manySep({
    SEP: this.T.And,
    DEF: () => {
      let not: IToken | undefined;
      this.option(() => not = this.consume(this.T.Not));
      let allowComma = ctx.allowComma;
      ctx.allowComma = false;
      let right: Node;
      try {
        right = this.or([
          { ALT: () => this.guardInParens(ctx) },
          {
            GATE: () => {
              const tokenType = this.la(1).tokenType;
              return tokenType !== this.T.Not
                && tokenType !== this.T.DefaultGuardFunc
                && tokenType !== this.T.DefaultGuardIdent;
            },
            ALT: () => this.value(ctx)
          }
        ]);
      } finally {
        ctx.allowComma = allowComma;
      }
      if (isDefaultGuardCall(right!)) {
        ctx.hasDefault = true;
        const location = Array.isArray(right!.location) && right!.location.length === 6
          ? right!.location as LocationInfo
          : undefined;
        right = new DefaultGuard('default()', undefined, location, this.context);
      }
      if (not) {
        let [,,, endOffset, endLine, endColumn] = right.location!;
        let [startOffset, startLine, startColumn] = this.getLocationInfo(not);
        right = new Condition(
          [this.wrap(right, true)],
          { negate: true },
          [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
          this.context
        );
      }
      if (!left) {
        left = right;
        return;
      }
      left = new Condition(
        [this.wrap(left, true), 'and', this.wrap(right)],
        undefined,
        this.getLocationFromNodes([left, right]),
        this.context
      );
    }
  });
  return left!;
}

export function guardInParens(this: P, ctx: RuleContext) {
  this.startRule();
  let node = this.or([
    { ALT: () => this.guardDefault(ctx) },
    {
      ALT: () => {
        this.consume(this.T.LParen);
        let node = this.guardInner(ctx);
        this.consume(this.T.RParen);
        return node;
      }
    }
  ]);

  if (isDefaultGuardCall(node)) {
    ctx.hasDefault = true;
    const location = Array.isArray(node.location) && node.location.length === 6
      ? node.location as LocationInfo
      : undefined;
    node = new DefaultGuard('default()', undefined, location, this.context);
  }
  node = this.wrap(node, 'both');
  return new Paren(node, undefined, this.endRule(), this.context);
}

// The inner content of a guard inside parentheses
export function guardInner(this: P, ctx: RuleContext = {}) {
  return this.or([
    { ALT: () => this.comparison(ctx) },
    {
      ALT: () => this.guardOr(ctx)
    }
  ]);
}

export function guardWithConditionValue(this: P, ctx: RuleContext = {}) {
  return this.or([
    {
      ALT: () => {
        this.or([
          { ALT: () => this.consume(this.T.DefaultGuardIdent) },
          { ALT: () => this.consume(this.T.DefaultGuardFunc) }
        ]);
      }
    },
    { ALT: () => this.guardInParens(ctx) }
  ]);
}

export function guardWithCondition(this: P, ctx: RuleContext = {}) {
  this.guardWithConditionValue(ctx);
  this.atLeastOne(() => {
    this.or([
      { ALT: () => this.consume(this.T.Or) },
      { ALT: () => this.consume(this.T.And) },
      { ALT: () => this.consume(this.T.Comma) }
    ]);
    this.guardWithConditionValue(ctx);
  });
}

/**
 * Currently, Less only allows a single comparison expression,
 * unlike Media Queries Level 4, which allows a left and right
 * comparison.
 */
export function comparison(this: P, ctx: RuleContext = {}) {
  let left = this.valueList(ctx);
  let op = this.or([
    { ALT: () => this.consume(this.T.Eq) },
    { ALT: () => this.consume(this.T.Gt) },
    { ALT: () => this.consume(this.T.GtEq) },
    { ALT: () => this.consume(this.T.GtEqAlias) },
    { ALT: () => this.consume(this.T.Lt) },
    { ALT: () => this.consume(this.T.LtEq) },
    { ALT: () => this.consume(this.T.LtEqAlias) }
  ]);
  let right = this.valueList(ctx);
  let opStr = op.image;
  if (opStr === '=>') {
    opStr = '>=';
  } else if (opStr === '=<') {
    opStr = '<=';
  }
  left = new Condition(
    [this.wrap(left, true), opStr as ConditionOperator, this.wrap(right)],
    undefined,
    this.getLocationFromNodes([left, right]),
    this.context
  );
  return left;
}

/**
 * Less (perhaps unwisely) allows bubbling of normally document-root
 * at-rules, so we need to override CSS here.
 */
export function innerAtRule(this: P, ctx: RuleContext = {}): Node {
  return this.or([
    { ALT: () => this.mediaAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.supportsAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.layerAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.containerAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.keyframesAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.documentAtRule({ ...ctx, inner: true }) },
    { ALT: () => this.importAtRule(ctx) },
    { ALT: () => this.pageAtRule(ctx) },
    { ALT: () => this.fontFaceAtRule(ctx) },
    { ALT: () => this.nestedAtRule(ctx) },
    { ALT: () => this.nonNestedAtRule(ctx) },
    { ALT: () => this.unknownAtRule({ ...ctx, inner: true }) }
  ]);
}

/**
 * Less override: allow variable reference as the first segment of a layer-name
 * CSS: <ident> ('.' <ident>)*
 * Less: (<var-ref> | <ident>) ('.' <ident>)*
 */
export function layerName(this: P, ctx: RuleContext = {}) {
  this.startRule();
  const nodes: Node[] = [];

  // First segment: variable reference or plain ident
  const first = this.or([
    { ALT: () => this.valueReference(ctx) },
    { ALT: () => this.consume(this.T.Ident) }
  ]);

  if (first instanceof Node) {
    nodes.push(this.wrap(first));
  } else {
    nodes.push(this.wrap(this.processValueToken(first)));
  }

  // Remaining segments: dot + ident (same as CSS)
  this.many({
    GATE: this.noSep.bind(this),
    DEF: () => {
      const seg = this.consume(this.T.DotName);
      nodes.push(this.wrap(this.processValueToken(seg)));
    }
  });

  const loc = this.endRule();
  return new Sequence(nodes, undefined, loc, this.context);
}

/**
 * Less override: allow variable reference for @keyframes name
 * CSS: Ident | String
 * Less: valueReference | Ident | String
 */
export function keyframesName(this: P, ctx: RuleContext = {}) {
  let node: Node | undefined;
  this.or([
    { ALT: () => node = this.valueReference(ctx) },
    { ALT: () => {
      const tok = this.consume(this.T.Ident);
      node = this.wrap(this.processValueToken(tok));
    } },
    { ALT: () => node = this.string() }
  ]);
  return node!;
}

/**
 * One of the rare rules that returns a token, because
 * other rules will transform it differently.
 */
export function mixinName(this: P, ctx: RuleContext = {}) {
  /** e.g. .mixin, #mixin */
  let name = this.or([
    { ALT: () => this.consume(this.T.HashName) },
    { ALT: () => this.consume(this.T.ColorIdentStart) },
    { ALT: () => this.consume(this.T.DotName) },
    { ALT: () => this.consume(this.T.InterpolatedIdent) },
    { ALT: () => this.consume(this.T.InterpolatedSelector) }
  ]);
  const asReference = ctx.asReference;
  let nameNode: Node;
  let nameValue = name.image;
  let location = this.getLocationInfo(name);
  if (nameValue.includes('@') || nameValue.includes('$')) {
    nameNode = getInterpolated(nameValue, location, this.context);
    if (asReference) {
      // For interpolated keys, we can't merge into array easily, so keep nested structure
      // But we still check type to ensure consistency
      if (isNode(ctx.node, N.Reference) && ctx.node.options.type === 'mixin-ruleset') {
        // Keep nested structure for interpolated keys
        nameNode = new Reference({ target: ctx.node, key: nameNode as Interpolated }, { type: 'mixin-ruleset', role: 'name' }, location, this.context);
      } else {
        nameNode = new Reference({ target: ctx.node as Call | Reference, key: nameNode as Interpolated }, { type: 'mixin-ruleset', role: 'name' }, location, this.context);
      }
    }
  } else {
    if (asReference) {
      // If target is a Reference with matching type, merge keys instead of nesting
      if (isNode(ctx.node, N.Reference) && ctx.node.options.type === 'mixin-ruleset') {
        const existingKey = ctx.node.value.key;
        let mergedKeys: string[];
        if (Array.isArray(existingKey)) {
          mergedKeys = [...existingKey];
        } else {
          mergedKeys = [existingKey as string];
        }
        mergedKeys.push(nameValue);
        // Create a single Reference with merged keys (no target)
        nameNode = new Reference(
          { key: mergedKeys.length === 1 ? mergedKeys[0]! : mergedKeys },
          { type: 'mixin-ruleset', role: 'name' },
          location,
          this.context
        );
      } else {
        // Target is Call, Reference with different type, or undefined - create Reference with target
        nameNode = new Reference({ target: ctx.node as Call | Reference, key: nameValue }, { type: 'mixin-ruleset', role: 'name' }, location, this.context);
      }
    } else {
      nameNode = this.wrap(new Any(nameValue, { role: 'name' }, this.getLocationInfo(name), this.context), true);
    }
  }
  return nameNode;
}

/**
 * Used within a value. These can be
 * chained more recursively, unlike
 * Less 1.x-4.x
 *   e.g. .mixin1() > .mixin2[@val1].ns() > .sub-mixin[@val2]
 *
 * This production intelligently decides whether to produce a Call or Reference
 * based on whether there are parentheses at the end:
 * - foo: #id; // Reference
 * - foo: .class; // Reference
 * - foo: #id > .scoped; // Reference
 * - foo: #id > .scoped(); // Call
 * - foo: #id[]; // Reference with accessor
 * - foo: #id > .scoped[foo]; // Reference with accessor
 * - foo: #id > .scoped[@ref](); // Call with accessor
 */
export function mixinReference(this: P, ctx: RuleContext = {}) {
  let leftNode = this.mixinName({ ...ctx, asReference: true });

  this.many({
    GATE: () => {
      let next = this.la(1).tokenType;
      return this.noSep() && (next === this.T.LParen || next === this.T.LSquare);
    },
    DEF: () => {
      leftNode = this.lookupOrCall({ ...ctx, node: leftNode });
    }
  });

  this.option(() => {
    this.option(() => this.consume(this.T.Gt));
    leftNode = this.mixinReference({ ...ctx, node: leftNode });
  });

  return leftNode;
}

export function mixinArgs(this: P, ctx: RuleContext = {}) {
  let args: List | undefined;
  // Check for whitespace before the opening paren (before consuming)
  const hasWhitespace = !this.noSep();
  const openingParenToken = hasWhitespace ? this.la(1) : undefined;

  this.consume(this.T.LParen);
  // Clear ctx.node when parsing arguments - arguments should start fresh, not inherit the parent node
  // Calls intentionally push a `false` paren frame (matches `Call.evalNode`)
  const argCtx: RuleContext = {
    ...ctx,
    node: undefined,
    allowComma: false,
    parenFrames: [...getParenFrames(ctx), false],
    detachedRulesetUsage: ctx.isDefinition ? 'default-param' : 'mixin-arg'
  };
  this.option(() => {
    args = this.mixinArgList(argCtx);
  });
  this.consume(this.T.RParen);

  // Check for whitespace warning AFTER consuming closing paren
  // Now we can check what comes next to determine if it's actually a definition
  if (hasWhitespace && openingParenToken) {
    const nextAfterParens = this.la(1).tokenType;
    const isActuallyDefinition = nextAfterParens === this.T.LCurly || nextAfterParens === this.T.When;
    // Only warn if it's NOT a definition (i.e., it's a mixin call)
    if (!isActuallyDefinition) {
      this.warnDeprecation(
        'Whitespace between a mixin name and parentheses for a mixin call is deprecated',
        openingParenToken,
        'mixin-call-whitespace'
      );
    }
  }

  return args;
}

export function lookupOrCall(this: P, ctx: RuleContext = {}) {
  this.startRule();
  return this.or([
    {
      ALT: () => {
        let keyToken: IToken | undefined;
        this.consume(this.T.LSquare);
        this.option(() => keyToken = this.or([
          { ALT: () => this.consume(this.T.NestedReference) },
          { ALT: () => this.consume(this.T.AtKeyword) },
          { ALT: () => this.consume(this.T.PropertyReference) },
          { ALT: () => this.consume(this.T.InterpolatedIdent) },
          { ALT: () => this.consume(this.T.Ident) }
        ]));
        this.consume(this.T.RSquare);
        let ref: Reference;
        let target = ctx.node as Call | Reference;
        if (keyToken) {
          let tokenStr = keyToken.image;
          let type: 'variable' | 'property' = tokenStr.startsWith('@') ? 'variable' : 'property';
          // Handle all token types consistently
          if (keyToken.tokenType === this.T.NestedReference) {
            // For NestedReference, add $ prefix if not present
            let tokenStr = keyToken.image;
            if (!tokenStr.startsWith('$') && !tokenStr.startsWith('@')) {
              tokenStr = '$' + tokenStr;
            }
          }
          let result = getInterpolatedOrString(tokenStr, this.getLocationInfo(keyToken), this.context);

          // Only merge keys for mixin, mixin-ruleset, or ruleset types
          // For variable and property types, keep them nested (target.key structure)
          const targetType = isNode(target, N.Reference) ? target.options.type : undefined;
          const shouldMergeKeys = targetType === 'mixin' || targetType === 'mixin-ruleset' || targetType === 'ruleset';
          if (isNode(target, N.Reference) && target.options.type === type && typeof result === 'string' && shouldMergeKeys) {
            const existingKey = target.value.key;
            let mergedKeys: string[];
            if (Array.isArray(existingKey)) {
              mergedKeys = [...existingKey];
            } else {
              mergedKeys = [existingKey as string];
            }
            mergedKeys.push(result);
            ref = new Reference(
              { key: mergedKeys.length === 1 ? mergedKeys[0]! : mergedKeys },
              { type },
              this.endRule(),
              this.context
            );
          } else {
            ref = new Reference({ target, key: result }, { type }, this.endRule(), this.context);
          }
        } else {
          ref = new Reference({ target, key: -1 }, { type: 'index' }, this.endRule(), this.context);
        }
        /** Reference targets will technically precede the reference, so we need to update the location to the target start location */
        if (target) {
          let [targetStartOffset, targetStartLine, targetStartColumn] = target.location!;
          ref.location[0] = targetStartOffset;
          ref.location[1] = targetStartLine;
          ref.location[2] = targetStartColumn;
        }
        return ref;
      }
    },
    {
      ALT: () => {
        let args = this.mixinArgs(ctx);
        return new Call({ name: ctx.node as Call | Reference, args }, undefined, this.endRule(), this.context);
      }
    }
  ]);
}

/**
 * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
 *
 * This rule is recursive to allow chevrotain-allstar (hopefully) to lookahead
 * and find semi-colon separators vs. commas.
 */
export function mixinArgList(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let node = this.mixinArg(ctx);

  let commaNodes: Node[] = [this.wrap(node, true)];
  let semiNodes: Node[] = [];
  let isSemiList = false;
  let moreArgs = true;

  this.many({
    GATE: () => moreArgs,
    DEF: () => {
      this.or([
        {
          GATE: () => !isSemiList,
          ALT: () => {
            this.consume(this.T.Comma);
            let node = this.mixinArg(ctx);
            commaNodes!.push(this.wrap(node, true));
          }
        },
        {
          ALT: () => {
            let semi = this.consume(this.T.Semi);
            isSemiList = true;

            /**
             * Aggregate the previous set of comma-nodes
             */
            if (commaNodes) {
              if (commaNodes.length > 1) {
                let [first, ...rest] = commaNodes;
                let hasDeclarations = false;
                if (first instanceof VarDeclaration) {
                  const nodes = [first.value.value, ...rest];
                  /**
                   * If we still have declarations, we need to push an error.
                   */
                  hasDeclarations = rest.some(n => n instanceof VarDeclaration);
                  first.value.value = new List(nodes, undefined, this.getLocationFromNodes(nodes), this.context);
                  semiNodes.push(first);
                } else {
                  hasDeclarations = commaNodes.some(n => n instanceof VarDeclaration);
                  let commaList = new List(commaNodes, undefined, this.getLocationFromNodes(commaNodes), this.context);
                  semiNodes.push(commaList);
                }
                if (hasDeclarations) {
                  let indexOfSemi = this.originalInput.indexOf(semi);
                  let previousToken = this.originalInput[indexOfSemi - 1]!;
                  this.errors.push(
                    new ParseError(
                      'Cannot mix ; and , as delimiter types',
                      semi,
                      { previousToken }
                    )
                  );
                }
              } else {
                semiNodes.push(commaNodes[0]!);
              }
              commaNodes = undefined!;
            }
            this.or([
              {
                GATE: () => this.la(1).tokenType !== this.T.RParen,
                ALT: () => {
                  const prevAllow = ctx.allowComma;
                  ctx.allowComma = true;
                  node = this.mixinArg(ctx);
                  ctx.allowComma = prevAllow;
                  semiNodes.push(this.wrap(node, true));
                }
              },
              {
                ALT: () => {
                  moreArgs = false;
                }
              }
            ]);
          }
        }
      ]);
    }
  });

  let location = this.endRule();
  let nodes = isSemiList ? semiNodes! : commaNodes!;
  let sep: ';' | ',' = isSemiList ? ';' : ',';
  return this.wrap(new List(nodes, { sep }, location, this.context), 'both') as List;
}

/**
 * Less is more lenient about at-keywords. See lessTokens.ts for more details.
 */
export function varName(this: P) {
  // AtKeywordLessExtension is categorized as AtName in lessTokens.ts, so consuming
  // AtName alone preserves behavior while avoiding OR ambiguity warnings.
  return this.consume(this.T.AtName);
}

/**
 * Originally, we were creating alternatives for mixin calls and mixin definitions
 * that could mostly overlap, which led to longer parsing. Instead, we parse
 * as if it could be either, and then we disambiguate at the end.
 */
export function mixinArg(this: P, ctx: RuleContext = {}) {
  let firstToken = this.la(1);

  let atStart = (
    firstToken.tokenType === this.T.AtKeyword
    || firstToken.tokenType === this.T.AtKeywordLessExtension
  );

  let isDeclaration = atStart && this.la(2).tokenType === this.T.Colon;

  return this.or([
    {
      GATE: () => !isDeclaration && atStart && this.la(2).tokenType === this.T.Ellipsis,
      ALT: () => {
        this.startRule();
        let name = this.varName();
        let ellipsis;
        /**
         * Mixin definitions can have a spread parameter, which
         * means it will match a variable number of elements
         * at the end.
         *
         * However, mixin calls can have a spread argument,
         * which means it will expand a variable representing
         * a list, which, to my knowledge, is an undocumented
         * feature of Less (and only exists in mixin calls?)
         *
         * @todo - Intuitively, shouldn't this be available
         * elsewhere in the language? Or would there be no
         * reason?
         */
        this.option(() => ellipsis = this.consume(this.T.Ellipsis));
        let varNameStr = name.image.slice(1);
        if (ellipsis) {
          // For rest parameters, use string which can be converted to Reference later if needed
          return new Rest(varNameStr, undefined, this.endRule(), this.context);
        } else {
          return new Any(varNameStr, { role: 'name' }, this.endRule(), this.context);
        }
      }
    },
    {
      GATE: () => !isDeclaration && !atStart && firstToken.tokenType !== this.T.RParen && firstToken.tokenType !== this.T.Ellipsis,
      ALT: () => {
        return this.callArgument(ctx);
      }
    },
    {
      GATE: () => !isDeclaration && atStart && this.la(2).tokenType !== this.T.Ellipsis && this.la(2).tokenType !== this.T.RParen && this.la(2).tokenType !== this.T.Comma && this.la(2).tokenType !== this.T.Semi,
      ALT: () => {
        return this.callArgument(ctx);
      }
    },
    {
      GATE: () => !isDeclaration && atStart && this.la(2).tokenType !== this.T.Ellipsis && (this.la(2).tokenType === this.T.RParen || this.la(2).tokenType === this.T.Comma || this.la(2).tokenType === this.T.Semi),
      ALT: () => {
        this.startRule();
        let name = this.varName();
        let varNameStr = name.image.slice(1);
        return new Any(varNameStr, { role: 'name' }, this.endRule(), this.context);
      }
    },
    {
      GATE: () => isDeclaration,
      ALT: () => {
        this.startRule();
        let name = this.varName();
        this.consume(this.T.Colon);
        /** Default value */
        let value = this.callArgument({ ...ctx, allowComma: false, detachedRulesetUsage: 'default-param' });

        let location = this.endRule();
        return new VarDeclaration({
          name: new Any(name.image.slice(1), { role: 'property' }, this.getLocationInfo(name), this.context),
          value
        }, { paramVar: true }, location, this.context);
      }
    },

    {
      ALT: () => {
        let ellipsis = this.consume(this.T.Ellipsis);
        return new Rest(undefined, undefined, this.getLocationInfo(ellipsis), this.context);
      }
    }
  ]);
}

export function callArgument(this: P, ctx: RuleContext = {}) {
  return this.or([
    {
      GATE: () => this.la(1).tokenType === this.T.AnonMixinStart || this.la(1).tokenType === this.T.LCurly,
      ALT: () => this.anonymousMixinDefinition(ctx)
    },
    {
      GATE: () => !ctx.allowComma,
      ALT: () => this.valueSequence(ctx)
    },
    {
      GATE: () => !!ctx.allowComma,
      ALT: () => this.valueList(ctx)
    }
  ]);
}

/**
 * Override unknownAtRule to handle @-export for stylesheet forwarding.
 * @-export is like @-compose but with forward semantics and no `with` support.
 */
export function unknownAtRule(this: P, ctx: RuleContext = {}) {
  const img = this.la(1).image;
  if (img === '@-export') {
    return this.exportAtRule(ctx);
  }
  return cssUnknownAtRule.call(this, ctx);
}

/**
 * Parse @-export './foo.jess' [as <namespace>]
 *
 * Creates a StyleImport with forward semantics (members not visible locally but transitive).
 * Does NOT support `with` (unlike @-compose).
 * Participates in evaldTrees caching like @-compose.
 */
export function exportAtRule(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.AtKeyword); // '@-export'

  // Parse the path (string or url)
  const pathNode: Quoted | Url = this.or([
    { ALT: () => this.urlFunction(ctx) },
    { ALT: () => this.string(ctx) }
  ]);

  // Optional "as <namespace>"
  let namespace: string | undefined;
  this.option(() => {
    const la = this.la(1);
    if (!((la.tokenType === this.T.PlainIdent || la.tokenType === this.T.Ident) && la.image === 'as')) {
      return;
    }
    // Consume "as"
    if (this.la(1).tokenType === this.T.Ident) {
      this.consume(this.T.Ident);
    } else {
      this.consume(this.T.PlainIdent);
    }
    // Consume namespace identifier
    const nsTok = (this.la(1).tokenType === this.T.Ident)
      ? (this.consume(this.T.Ident) as unknown as IToken)
      : (this.consume(this.T.PlainIdent) as unknown as IToken);
    namespace = nsTok.image;
  });

  this.consume(this.T.Semi);

  const loc = this.endRule();
  return new StyleImport(
    { path: pathNode },
    {
      type: 'compose',
      namespace,
      importOptions: {
        forward: true
      }
    },
    loc,
    this.context
  );
}
