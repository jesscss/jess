import type { RuleContext } from '../lessRecursiveParser.js';
import type { TokenMap } from '../lessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import { NoViableAltException } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';
import {
  type TreeContext,
  type LocationInfo,
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
  if (!node || !isNode(node, N.Call)) {
    return false;
  }
  const callName = node.name;
  const callNameStr = String(
    (typeof callName === 'object' && callName !== null && 'valueOf' in callName)
      ? callName.valueOf()
      : callName ?? ''
  );
  if (callNameStr === 'default' || callNameStr === '??') {
    return true;
  }
  if (callName instanceof Reference) {
    const key = callName.key;
    const keyStr = String(
      (typeof key === 'object' && key !== null && 'valueOf' in key)
        ? key.valueOf()
        : key ?? ''
    );
    return keyStr === 'default' || keyStr === '??';
  }
  return false;
}

// Save CSS production factory for super calls
const cssUnknownAtRule = cssProductions.unknownAtRule;

function isGuardComparisonToken(tt: unknown, T: TokenMap) {
  return tt === T.CompareOperator
    || tt === T.Eq
    || tt === T.Gt
    || tt === T.GtEq
    || tt === T.GtEqAlias
    || tt === T.Lt
    || tt === T.LtEq
    || tt === T.LtEqAlias;
}

function normalizeComparisonOperator(op: string): ConditionOperator {
  if (op === '=>') {
    return '>=';
  }
  if (op === '=<') {
    return '<=';
  }
  return op as ConditionOperator;
}

export function guard(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.CONSUME(T.When);
    return $.OR([
      {
        GATE: () => !!ctx.inValueList,
        ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] })
      },
      {
        ALT: () => {
          ctx.allowComma = true;
          const node = $.SUBRULE($.guardOr, { ARGS: [ctx] });
          return node;
        }
      }
    ]);
  };
}

/**
 * 'or' expression
 * Allows an (outer) comma like historical media queries
 */
export function guardOr(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let left = $.SUBRULE($.guardAnd, { ARGS: [ctx] });
    let right: Node | undefined;
    $.MANY({
      GATE: () => (ctx.allowComma && $.isType(T.Comma)) || $.isType(T.Or),
      DEF: () => {
        /**
         * Nest expressions within expressions for correct
         * order of operations.
         */
        $.OR([
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Or) }
        ]);
        right = $.SUBRULE2($.guardAnd, { ARGS: [ctx] });
        let location = $.endRule();
        $.startRule();
        left = new Condition(
          [$.wrap(left, true), 'or', $.wrap(right!)],
          undefined,
          location,
          $.context
        );
      }
    });
    $.endRule();
    return left;
  };
}

export function guardDefault(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let guard = $.OR([
      { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
      { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
    ]);
    if ($.RECORDING_PHASE) {
      return;
    }
    ctx.hasDefault = true;
    return new DefaultGuard(guard.image, undefined, $.getLocationInfo(guard), $.context);
  };
}

/**
 * 'and' and 'or' expressions
 *
 *  In Media queries level 4, you cannot have
 *  `([expr]) or ([expr]) and ([expr])` because
 *  of evaluation order ambiguity.
 *  However, Less allows it.
 */
export function guardAnd(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let left: Node;
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => {
        let not: IToken | undefined;
        $.OPTION(() => not = $.CONSUME(T.Not));
        let allowComma = ctx.allowComma;
        ctx.allowComma = false;
        let right: Node;
        try {
          right = $.OR([
            { ALT: () => $.SUBRULE($.guardInParens, { ARGS: [ctx] }) },
            {
              GATE: () => {
                const tokenType = $.LA(1).tokenType;
                return tokenType !== T.Not
                  && tokenType !== T.DefaultGuardFunc
                  && tokenType !== T.DefaultGuardIdent;
              },
              ALT: () => $.SUBRULE($.expressionSum, { ARGS: [ctx] })
            }
          ]);
          $.OPTION2({
            GATE: () => isGuardComparisonToken($.LA(1).tokenType, T),
            DEF: () => {
              const op = $.CONSUME(T.CompareOperator);
              const compareRight = $.SUBRULE2($.expressionSum, { ARGS: [ctx] });
              if (!$.RECORDING_PHASE) {
                right = new Condition(
                  [
                    $.wrap(right, true),
                    normalizeComparisonOperator(op.image),
                    $.wrap(compareRight)
                  ],
                  undefined,
                  $.getLocationFromNodes([right, compareRight]),
                  $.context
                );
              }
            }
          });
        } finally {
          ctx.allowComma = allowComma;
        }
        if (!$.RECORDING_PHASE) {
          if (isDefaultGuardCall(right!)) {
            ctx.hasDefault = true;
            const location = Array.isArray(right!.location) && right!.location.length === 6
              ? right!.location as LocationInfo
              : undefined;
            right = new DefaultGuard('default()', undefined, location, $.context);
          }
          if (not) {
            let [,,, endOffset, endLine, endColumn] = right.location!;
            let [startOffset, startLine, startColumn] = $.getLocationInfo(not);
            right = new Condition(
              [$.wrap(right, true)],
              { negate: true },
              [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!],
              $.context
            );
          }
          if (!left) {
            left = right;
            return;
          }
          left = new Condition(
            [$.wrap(left, true), 'and', $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            $.context
          );
        }
      }
    });
    return left!;
  };
}

export function guardInParens(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext) => {
    $.startRule();
    let node = $.OR([
      { ALT: () => $.SUBRULE($.guardDefault, { ARGS: [ctx] }) },
      {
        ALT: () => {
          $.CONSUME(T.LParen);
          let node = $.SUBRULE($.guardInner, { ARGS: [ctx] });
          $.CONSUME(T.RParen);
          return node;
        }
      }
    ]);

    if (isDefaultGuardCall(node)) {
      ctx.hasDefault = true;
      const location = Array.isArray(node.location) && node.location.length === 6
        ? node.location as LocationInfo
        : undefined;
      node = new DefaultGuard('default()', undefined, location, $.context);
    }
    node = $.wrap(node, 'both');
    return new Paren(node, undefined, $.endRule(), $.context);
  };
}

// The inner content of a guard inside parentheses
export function guardInner(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.SUBRULE($.guardOr, { ARGS: [ctx] });
  };
}

export function guardWithConditionValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    if ($.isType(T.DefaultGuardIdent) || $.isType(T.DefaultGuardFunc)) {
      $.OR([
        { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
        { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
      ]);
      return;
    }
    return $.SUBRULE($.guardInParens, { ARGS: [ctx] });
  };
}

export function guardWithCondition(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.SUBRULE($.guardWithConditionValue, { ARGS: [ctx] });
    $.AT_LEAST_ONE(() => {
      $.OR([
        { ALT: () => $.CONSUME(T.Or) },
        { ALT: () => $.CONSUME(T.And) },
        { ALT: () => $.CONSUME(T.Comma) }
      ]);
      $.SUBRULE2($.guardWithConditionValue, { ARGS: [ctx] });
    });
  };
}

/**
 * Currently, Less only allows a single comparison expression,
 * unlike Media Queries Level 4, which allows a left and right
 * comparison.
 */
export function comparison(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let left = $.SUBRULE($.expressionSum, { ARGS: [ctx] });
    const op = $.CONSUME(T.CompareOperator);
    let right = $.SUBRULE2($.expressionSum, { ARGS: [ctx] });
    if (isDefaultGuardCall(right)) {
      ctx.hasDefault = true;
      const location = Array.isArray(right.location) && right.location.length === 6
        ? right.location as LocationInfo
        : undefined;
      right = new DefaultGuard('default()', undefined, location, $.context);
    }
    left = new Condition(
      [$.wrap(left, true), normalizeComparisonOperator(op.image), $.wrap(right)],
      undefined,
      $.getLocationFromNodes([left, right]),
      $.context
    );
    return left;
  };
}

/**
 * Less (perhaps unwisely) allows bubbling of normally document-root
 * at-rules, so we need to override CSS here.
 */
export function innerAtRule(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}): Node => {
    return $.OR([
      { ALT: () => $.SUBRULE($.mediaAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
      { ALT: () => $.SUBRULE($.supportsAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
      { ALT: () => $.SUBRULE($.layerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
      { ALT: () => $.SUBRULE($.containerAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
      { ALT: () => $.SUBRULE($.keyframesAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
      { ALT: () => $.SUBRULE($.documentAtRule, { ARGS: [{ ...ctx, inner: true }] }) },
      { ALT: () => $.SUBRULE($.importAtRule, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.pageAtRule, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.fontFaceAtRule, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.nestedAtRule, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.nonNestedAtRule, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.unknownAtRule, { ARGS: [{ ...ctx, inner: true }] }) }
    ]);
  };
}

/**
 * Less override: allow variable reference as the first segment of a layer-name
 * CSS: <ident> ('.' <ident>)*
 * Less: (<var-ref> | <ident>) ('.' <ident>)*
 */
export function layerName(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let nodes: Node[];
    if (!RECORDING_PHASE) {
      nodes = [];
    }

    // First segment: variable reference or plain ident
    const first = $.OR([
      { ALT: () => $.SUBRULE($.valueReference, { ARGS: [ctx] }) },
      {
        GATE: () => $.isType(T.Ident),
        ALT: () => $.CONSUME(T.Ident)
      }
    ]);

    if (!RECORDING_PHASE) {
      if (first instanceof Node) {
        nodes!.push($.wrap(first));
      } else {
        nodes!.push($.wrap($.processValueToken(first)));
      }
    }

    // Remaining segments: dot + ident (same as CSS)
    $.MANY({
      GATE: $.noSep.bind($),
      DEF: () => {
        const seg = $.CONSUME(T.DotName);
        if (!RECORDING_PHASE) {
          nodes!.push($.wrap($.processValueToken(seg)));
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    const loc = $.endRule();
    return new Sequence(nodes!, undefined, loc, $.context);
  };
}

/**
 * Less override: allow variable reference for @keyframes name
 * CSS: Ident | String
 * Less: valueReference | Ident | String
 */
export function keyframesName(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let node: Node | undefined;
    $.OR([
      { ALT: () => node = $.SUBRULE($.valueReference, { ARGS: [ctx] }) },
      {
        GATE: () => $.isType(T.Ident) && !$.isType(T.InterpolatedIdent),
        ALT: () => {
          const tok = $.CONSUME(T.Ident);
          node = $.wrap($.processValueToken(tok));
        } },
      { ALT: () => node = $.SUBRULE($.string, { ARGS: [] }) }
    ]);
    return node!;
  };
}

/**
 * One of the rare rules that returns a token, because
 * other rules will transform it differently.
 */
export function mixinName(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    /** e.g. .mixin, #mixin */
    let name = $.OR([
      { ALT: () => $.CONSUME(T.HashName) },
      { ALT: () => $.CONSUME(T.ColorIdentStart) },
      { ALT: () => $.CONSUME(T.DotName) },
      { ALT: () => $.CONSUME(T.InterpolatedIdent) },
      { ALT: () => $.CONSUME(T.InterpolatedSelector) }
    ]);
    if ($.RECORDING_PHASE) {
      return;
    }
    const asReference = ctx.asReference;
    let nameNode: Node;
    let nameValue = name.image;
    let location = $.getLocationInfo(name);
    if (nameValue.includes('@') || nameValue.includes('$')) {
      const interpolated = getInterpolated(nameValue, location, $.context);
      nameNode = interpolated;
      if (asReference) {
        if (isNode(ctx.node, N.Reference) && ctx.node.options.type === 'mixin-ruleset') {
          nameNode = new Reference({ target: ctx.node, key: interpolated }, { type: 'mixin-ruleset', role: 'name' }, location, $.context);
        } else {
          const target = ctx.node as Node | undefined;
          nameNode = new Reference({ target: target instanceof Call ? target : target instanceof Reference ? target : undefined, key: interpolated }, { type: 'mixin-ruleset', role: 'name' }, location, $.context);
        }
      }
    } else {
      if (asReference) {
        // If target is a Reference with matching type, merge keys instead of nesting
        if (isNode(ctx.node, N.Reference) && ctx.node.options.type === 'mixin-ruleset') {
          const existingKey = ctx.node.key;
          let mergedKeys: string[];
          if (Array.isArray(existingKey)) {
            mergedKeys = [...existingKey];
          } else {
            mergedKeys = [String(existingKey)];
          }
          mergedKeys.push(nameValue);
          nameNode = new Reference(
            { key: mergedKeys.length === 1 ? mergedKeys[0]! : mergedKeys },
            { type: 'mixin-ruleset', role: 'name' },
            location,
            $.context
          );
        } else {
          const target = ctx.node as Node | undefined;
          nameNode = new Reference({ target: target instanceof Call ? target : target instanceof Reference ? target : undefined, key: nameValue }, { type: 'mixin-ruleset', role: 'name' }, location, $.context);
        }
      } else {
        nameNode = $.wrap(new Any(nameValue, { role: 'name' }, $.getLocationInfo(name), $.context), true);
      }
    }
    return nameNode;
  };
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
export function mixinReference(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let leftNode = $.SUBRULE($.mixinName, { ARGS: [{ ...ctx, asReference: true }] });

    $.MANY({
      GATE: () => {
        let next = $.LA(1).tokenType;
        return $.noSep() && (next === T.LParen || next === T.LSquare);
      },
      DEF: () => {
        leftNode = $.SUBRULE($.lookupOrCall, { ARGS: [{ ...ctx, node: leftNode }] });
      }
    });

    $.OPTION(() => {
      $.OPTION2(() => $.CONSUME(T.Gt));
      leftNode = $.SUBRULE($.mixinReference, { ARGS: [{ ...ctx, node: leftNode }] });
    });

    return leftNode;
  };
}

export function mixinArgs(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let args: List | undefined;
    // Check for whitespace before the opening paren (before consuming)
    const hasWhitespace = !$.noSep();
    const openingParenToken = hasWhitespace ? $.LA(1) : undefined;

    $.CONSUME(T.LParen);
    // Clear ctx.node when parsing arguments - arguments should start fresh, not inherit the parent node
    // Calls intentionally push a `false` paren frame (matches `Call.evalNode`)
    const argCtx: RuleContext = {
      ...ctx,
      node: undefined,
      allowComma: false,
      parenFrames: [...getParenFrames(ctx), false],
      detachedRulesetUsage: ctx.isDefinition ? 'default-param' : 'mixin-arg'
    };
    $.OPTION(() => {
      args = $.SUBRULE($.mixinArgList, { ARGS: [argCtx] });
    });
    $.CONSUME(T.RParen);

    // Check for whitespace warning AFTER consuming closing paren
    // Now we can check what comes next to determine if it's actually a definition
    if (hasWhitespace && openingParenToken) {
      const nextAfterParens = $.LA(1).tokenType;
      const isActuallyDefinition = nextAfterParens === T.LCurly || nextAfterParens === T.When;
      // Only warn if it's NOT a definition (i.e., it's a mixin call)
      if (!isActuallyDefinition) {
        $.warnDeprecation(
          'Whitespace between a mixin name and parentheses for a mixin call is deprecated',
          openingParenToken,
          'mixin-call-whitespace'
        );
      }
    }

    return args;
  };
}

export function lookupOrCall(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    return $.OR([
      {
        ALT: () => {
          let keyToken: IToken | undefined;
          $.CONSUME(T.LSquare);
          $.OPTION(() => keyToken = $.OR2([
            { ALT: () => $.CONSUME(T.NestedReference) },
            { ALT: () => $.CONSUME(T.AtKeyword) },
            { ALT: () => $.CONSUME(T.PropertyReference) },
            { ALT: () => $.CONSUME(T.InterpolatedIdent) },
            {
              GATE: () => !$.isType(T.NestedReference)
                && !$.isType(T.AtKeyword)
                && !$.isType(T.PropertyReference)
                && !$.isType(T.InterpolatedIdent)
                && $.isType(T.Ident),
              ALT: () => $.CONSUME(T.Ident)
            }
          ]));
          $.CONSUME(T.RSquare);
          if ($.RECORDING_PHASE) {
            return;
          }
          let ref: Reference;
          const targetNode = ctx.node;
          const target = targetNode instanceof Call ? targetNode : targetNode instanceof Reference ? targetNode : undefined;
          if (keyToken) {
            let tokenStr = keyToken.image;
            let type: 'variable' | 'property' = tokenStr.startsWith('@') ? 'variable' : 'property';
            if (keyToken.tokenType === T.NestedReference) {
              let tokenStr = keyToken.image;
              if (!tokenStr.startsWith('$') && !tokenStr.startsWith('@')) {
                tokenStr = '$' + tokenStr;
              }
            }
            let result = getInterpolatedOrString(tokenStr, $.getLocationInfo(keyToken), $.context);

            const targetType = isNode(target, N.Reference) ? target.options.type : undefined;
            const shouldMergeKeys = targetType === 'mixin' || targetType === 'mixin-ruleset' || targetType === 'ruleset';
            if (isNode(target, N.Reference) && target.options.type === type && typeof result === 'string' && shouldMergeKeys) {
              const existingKey = target.key;
              let mergedKeys: string[];
              if (Array.isArray(existingKey)) {
                mergedKeys = [...existingKey];
              } else {
                mergedKeys = [String(existingKey)];
              }
              mergedKeys.push(result);
              ref = new Reference(
                { key: mergedKeys.length === 1 ? mergedKeys[0]! : mergedKeys },
                { type },
                $.endRule(),
                $.context
              );
            } else {
              ref = new Reference({ target, key: result }, { type }, $.endRule(), $.context);
            }
          } else {
            ref = new Reference({ target, key: -1 }, { type: 'index' }, $.endRule(), $.context);
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
          let args = $.SUBRULE($.mixinArgs, { ARGS: [ctx] });
          if ($.RECORDING_PHASE) {
            return;
          }
          return new Call({ name: ctx.node!, args }, undefined, $.endRule(), $.context);
        }
      }
    ]);
  };
}

/**
 * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
 *
 * This rule is recursive to allow chevrotain-allstar (hopefully) to lookahead
 * and find semi-colon separators vs. commas.
 */
export function mixinArgList(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    const first = $.SUBRULE($.mixinArg, { ARGS: [ctx] });

    let commaNodes: Node[] | undefined = [$.wrap(first, true)];
    const semiNodes: Node[] = [];
    let isSemiList = false;

    const collapseCommaNodesIntoSemiNodes = (semi: IToken) => {
      if (!commaNodes) {
        return;
      }
      if (commaNodes.length > 1) {
        const [head, ...rest] = commaNodes;
        let hasDeclarations = false;
        if (head instanceof VarDeclaration) {
          const nodes = [head.value, ...rest];
          hasDeclarations = rest.some(n => n instanceof VarDeclaration);
          head.setData('value', new List(nodes, undefined, $.getLocationFromNodes(nodes), $.context));
          semiNodes.push(head);
        } else {
          hasDeclarations = commaNodes.some(n => n instanceof VarDeclaration);
          semiNodes.push(new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), $.context));
        }
        if (hasDeclarations) {
          const indexOfSemi = $.input.indexOf(semi);
          const previousToken = $.input[indexOfSemi - 1]!;
          $.SAVE_ERROR(
            new NoViableAltException(
              'Cannot mix ; and , as delimiter types',
              semi,
              previousToken
            )
          );
        }
      } else {
        semiNodes.push(commaNodes[0]!);
      }
      commaNodes = undefined;
    };

    while ($.isType(T.Comma) || $.isType(T.Semi)) {
      if ($.isType(T.Comma)) {
        const comma = $.CONSUME(T.Comma);
        const node = $.SUBRULE2($.mixinArg, { ARGS: [ctx] });
        if (commaNodes) {
          commaNodes.push($.wrap(node, true));
        } else {
          $.SAVE_ERROR(
            new NoViableAltException(
              'Cannot mix ; and , as delimiter types',
              comma,
              $.LA(0)
            )
          );
          semiNodes.push($.wrap(node, true));
        }
        continue;
      }

      const semi = $.CONSUME(T.Semi);
      isSemiList = true;
      collapseCommaNodesIntoSemiNodes(semi);

      if ($.isType(T.RParen)) {
        break;
      }

      const prevAllow = ctx.allowComma;
      ctx.allowComma = true;
      const node = $.SUBRULE3($.mixinArg, { ARGS: [ctx] });
      ctx.allowComma = prevAllow;
      semiNodes.push($.wrap(node, true));
    }

    let location = $.endRule();
    let nodes = isSemiList ? semiNodes : commaNodes!;
    let sep: ';' | ',' = isSemiList ? ';' : ',';
    const result: List = $.wrap(new List(nodes, { sep }, location, $.context), 'both');
    return result;
  };
}

/**
 * Less is more lenient about at-keywords. See lessTokens.ts for more details.
 */
export function varName(this: P, T: TokenMap) {
  const $ = this;
  return () => {
    // AtKeywordLessExtension is categorized as AtName in lessTokens.ts, so consuming
    // AtName alone preserves behavior while avoiding OR ambiguity warnings.
    return $.CONSUME(T.AtName);
  };
}

/**
 * Originally, we were creating alternatives for mixin calls and mixin definitions
 * that could mostly overlap, which led to longer parsing. Instead, we parse
 * as if it could be either, and then we disambiguate at the end.
 */
export function mixinArg(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const firstToken = $.LA(1);
    const atStart = $.matchToken(firstToken, T.AtName);
    const tt2 = $.LA(2).tokenType;
    const tt3 = $.LA(3).tokenType;
    const hasWsAfterName = tt2 === T.WS;
    const nextTokenType = hasWsAfterName ? tt3 : tt2;

    if (atStart && nextTokenType === T.Ellipsis) {
      $.startRule();
      const name = $.CONSUME(T.AtName);
      if (hasWsAfterName) {
        $.CONSUME(T.WS);
      }
      $.CONSUME(T.Ellipsis);
      if ($.RECORDING_PHASE) {
        return;
      }
      return new Rest(name.image.slice(1), undefined, $.endRule(), $.context);
    }

    if (atStart && nextTokenType === T.Colon) {
      $.startRule();
      const name = $.CONSUME2(T.AtName);
      if (hasWsAfterName) {
        $.CONSUME2(T.WS);
      }
      $.CONSUME(T.Colon);
      const value = $.SUBRULE3($.callArgument, { ARGS: [{ ...ctx, allowComma: !!ctx.allowComma, detachedRulesetUsage: 'default-param' }] });

      const location = $.endRule();
      if ($.RECORDING_PHASE) {
        return;
      }
      return new VarDeclaration({
        name: new Any(name.image.slice(1), { role: 'property' }, $.getLocationInfo(name), $.context),
        value
      }, { paramVar: true }, location, $.context);
    }

    if (atStart && (nextTokenType === T.RParen || nextTokenType === T.Comma || nextTokenType === T.Semi)) {
      $.startRule();
      const name = $.CONSUME3(T.AtName);
      if ($.RECORDING_PHASE) {
        return;
      }
      return new Any(name.image.slice(1), { role: 'name' }, $.endRule(), $.context);
    }

    if ($.isType(T.Ellipsis)) {
      const ellipsis = $.CONSUME2(T.Ellipsis);
      return new Rest(undefined, undefined, $.getLocationInfo(ellipsis), $.context);
    }

    return $.SUBRULE($.callArgument, { ARGS: [ctx] });
  };
}

export function callArgument(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        GATE: () => $.isType(T.AnonMixinStart) || $.isType(T.LCurly),
        ALT: () => $.SUBRULE($.anonymousMixinDefinition, { ARGS: [ctx] })
      },
      {
        GATE: () => !ctx.allowComma,
        ALT: () => $.SUBRULE($.valueSequence, { ARGS: [ctx] })
      },
      {
        GATE: () => !!ctx.allowComma,
        ALT: () => $.SUBRULE($.valueList, { ARGS: [ctx] })
      }
    ]);
  };
}

/**
 * Override unknownAtRule to handle @-export for stylesheet forwarding.
 * @-export is like @-compose but with forward semantics and no `with` support.
 */
export function unknownAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const img = $.LA(1).image;
    if (img === '@-export') {
      return $.SUBRULE($.exportAtRule, { ARGS: [ctx] });
    }
    return cssUnknownAtRule.call($, T)(ctx);
  };
}

/**
 * Parse @-export './foo.jess' [as <namespace>]
 *
 * Creates a StyleImport with forward semantics (members not visible locally but transitive).
 * Does NOT support `with` (unlike @-compose).
 * Participates in evaldTrees caching like @-compose.
 */
export function exportAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.AtKeyword); // '@-export'

    // Parse the path (string or url)
    const pathNode: Quoted | Url = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);

    // Optional "as <namespace>"
    let namespace: string | undefined;
    $.OPTION(() => {
      const la = $.LA(1);
      if (!((la.tokenType === T.PlainIdent || la.tokenType === T.Ident) && la.image === 'as')) {
        return;
      }
      // Consume "as"
      if ($.isType(T.Ident)) {
        $.CONSUME(T.Ident);
      } else {
        $.CONSUME(T.PlainIdent);
      }
      // Consume namespace identifier
      const nsTok: IToken = $.isType(T.Ident)
        ? $.CONSUME(T.Ident)
        : $.CONSUME(T.PlainIdent);
      namespace = nsTok.image;
    });

    $.CONSUME(T.Semi);

    const loc = $.endRule();
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
      $.context
    );
  };
}
