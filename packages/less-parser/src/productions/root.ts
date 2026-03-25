// Root production rules for LessRecursiveParser
// Converted from lines 1-1145 of productions.ts (Chevrotain → hand-written recursive-descent)
import type { RuleContext } from '../lessRecursiveParser.js';
import type { IToken } from 'chevrotain';
import { tokenMatcher, type IOrAlt } from 'chevrotain';
import { productions as cssProductions } from '@jesscss/css-parser';

import {
  type TreeContext,
  Node,
  Ampersand,
  Block,
  Any,
  type LocationInfo,
  type Operator,
  type ConditionOperator,
  Ruleset,
  BasicSelector,
  Combinator,
  type Combinators,
  List,
  Sequence,
  QueryCondition,
  Call,
  Paren,
  Operation,
  Quoted,
  AtRule,
  Interpolated,
  InterpolatedSelector,
  Reference,
  Dimension,
  Num,
  Extend,
  type Extend as ExtendType,
  Negative,
  Mixin,
  Condition,
  VarDeclaration,
  Declaration,
  CustomDeclaration,
  DefaultGuard,
  Rest,
  StyleImport,
  Expression,
  Keyword,
  SelectorCapture,
  ComplexSelector,
  CompoundSelector,
  SelectorList,
  Rules,
  Url,
  Nil,
  Collection,
  type ComplexSelectorComponent,
  type Selector,
  INTERPOLATION_PLACEHOLDER,
  type SimpleSelector,
  isNode,
  N,
  shouldOperateWithMathFrames
} from '@jesscss/core';
import { getInterpolatedOrString } from '../utils.js';
import type { ExtendTarget, TokenMap } from '../lessRecursiveParser.js';
import { all } from 'known-css-properties';

/** Use `any` for `this` to avoid structural incompatibility between LessRecursiveParser and CssRecursiveParser */
type P = any;
type Alt = IOrAlt<any>[];
type AltContext = (ctx?: RuleContext) => Alt;

// ── Save references to CSS production factories ────────────────────────
const cssMain = cssProductions.main;
const cssDeclaration = cssProductions.declaration;
const cssMediaTypeQuery = cssProductions.mediaTypeQuery;

// ── Helper functions ──────────────────────────────────────────────────

function getParenFrames(ctx: RuleContext | undefined): boolean[] {
  return (ctx?.parenFrames as boolean[] | undefined) ?? [];
}

function getCalcFrames(ctx: RuleContext | undefined): number {
  return (ctx?.calcFrames as number | undefined) ?? 0;
}

function withCalcFrame(ctx: RuleContext | undefined, delta: number): RuleContext {
  const calcFrames = getCalcFrames(ctx) + delta;
  return { ...(ctx ?? {}), calcFrames };
}

function guardContainsDefaultCall(node: Node | undefined): boolean {
  if (!node) {
    return false;
  }
  const isNodeLike = (value: unknown): value is Node => {
    return Boolean(
      value
      && typeof value === 'object'
      && typeof (value as any).type === 'string'
      && typeof (value as any).valueOf === 'function'
    );
  };
  const queue: unknown[] = [node];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current) || !isNodeLike(current)) {
      continue;
    }
    seen.add(current);
    if (current.type === 'DefaultGuard') {
      return true;
    }
    if (current.type === 'Call') {
      const callName = (current as Call).name;
      const callNameStr = String(
        (callName as any)?.valueOf?.() ?? callName ?? ''
      );
      if (callNameStr === 'default' || callNameStr === '??') {
        return true;
      }
      const key = (callName as any)?.key;
      const keyStr = String((key as any)?.valueOf?.() ?? key ?? '');
      if (keyStr === 'default' || keyStr === '??') {
        return true;
      }
    }
    const value = (current as any).data;
    if (Array.isArray(value)) {
      queue.push(...value);
    } else if (value && typeof value === 'object') {
      queue.push(...Object.values(value));
    }
  }
  return false;
}

function isDefaultGuardCall(node: Node | undefined): node is Call {
  if (!node || node.type !== 'Call') {
    return false;
  }
  const callName = (node as Call).name;
  const callNameStr = String((callName as any)?.valueOf?.() ?? callName ?? '');
  if (callNameStr === 'default' || callNameStr === '??') {
    return true;
  }
  const key = (callName as any)?.key;
  const keyStr = String((key as any)?.valueOf?.() ?? key ?? '');
  return keyStr === 'default' || keyStr === '??';
}

function loc(node: Node): LocationInfo | undefined {
  const location = node.location;
  return location.length === 6 ? (location as LocationInfo) : undefined;
}

export function wrapOuterExpressionIfNeeded(this: P, node: Node, ctx: RuleContext | undefined): Node {
  if (!this.wrapOuterExpressions) {
    return node;
  }
  if (!ctx?.wrapInExpression) {
    return node;
  }
  // Expressions should never contain Expressions; avoid nesting.
  if (node instanceof Expression) {
    return node;
  }

  // Math expressions: only wrap if this operation would actually be performed.
  if (isNode(node, N.Operation)) {
    const { left, operator: op, right } = node;
    const mathMode = this.mathMode ?? 'parens-division';
    const shouldOperate = shouldOperateWithMathFrames(
      {
        mathMode,
        parenFrames: getParenFrames(ctx),
        calcFrames: getCalcFrames(ctx)
      },
      op,
      left,
      right
    );
    if (shouldOperate) {
      return new Expression(node, { parens: true }, loc(node), this.context);
    }
  }

  return node;
}

function isEscapedString($: P, T: TokenMap): boolean {
  const next = $.LA(1);
  return (
    next.image.startsWith('~')
    && (
      tokenMatcher(next, T.QuoteStart)
      || tokenMatcher(next, T.DoubleQuoteStart)
      || tokenMatcher(next, T.SingleQuoteStart)
    )
  );
}

function startsLessMediaQueryReference($: P, T: TokenMap): boolean {
  if (
    $.isType(T.AtName)
    || $.isType(T.PropertyReference)
    || $.isType(T.NestedReference)
    || $.isType(T.DotName)
    || $.isType(T.HashName)
    || $.isType(T.InterpolatedIdent)
    || $.isType(T.InterpolatedSelector)
  ) {
    return true;
  }

  if (!$.isType(T.ColorIdentStart)) {
    return false;
  }

  const tt2 = $.LA(2).tokenType;
  return (
    tt2 === T.Gt
    || tt2 === T.DotName
    || tt2 === T.HashName
    || tt2 === T.InterpolatedSelector
    || (
      $.noSep(1) && (
        tt2 === T.LParen
        || tt2 === T.LSquare
        || tt2 === T.HashName
        || tt2 === T.DotName
      )
    )
  );
}

function startsCustomValue($: P, T: TokenMap): boolean {
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

function isVariableLike($: P, T: TokenMap): boolean {
  let token = $.LA(2);
  let isColon = token.tokenType === T.Colon;
  let isParen = token.tokenType === T.LParen;
  let postToken = $.LA(3);

  if (!$.preSkippedTokenMap) {
    return false;
  }

  if (!isColon && !isParen) {
    return false;
  }
  let isVariable = !$.preSkippedTokenMap.has(token.startOffset)
    || (isColon && $.preSkippedTokenMap.has(postToken.startOffset));
  return isVariable;
}

let interpolatedRegex = /([$@]){([^}]+)}/g;

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
  while (result = interpolatedRegex.exec(name)) {
    const [match, propOrVar, value] = result;
    source = source.replace(match, INTERPOLATION_PLACEHOLDER);
    const reference = createInterpolatedReference(propOrVar!, value!, location, context);
    replacements.push(reference);
  }
  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
};

const { isArray } = Array;

/**
 * Groups extends by target (using valueOf()) and flag.
 * Returns an array of grouped Extend nodes where extends with the same target and flag
 * are combined into a single Extend node with a SelectorList of all matching selectors.
 *
 * @todo Group complex selectors into selector lists
 */
function groupExtendsByTargetAndFlag(
  extendNodes: Extend[]
): Array<Extend | Extend[]> {
  // Group extends by target and flag
  const groups = new Map<string, Extend | Extend[]>();

  for (const ext of extendNodes) {
    let target = ext.target;
    let flag = ext.flag ?? 1; // ExtendFlag.Exact = 1
    // Create a key from target valueOf() and flag
    const key = `${target.valueOf()}|${flag}`;

    let group = groups.get(key);
    if (!group) {
      groups.set(key, ext);
    } else if (isArray(group)) {
      group.push(ext);
    } else {
      groups.set(key, [group, ext]);
    }
  }

  return Array.from(groups.values());
}

// ── Exported production rules ─────────────────────────────────────────

/** Charset moved within `main` (explained in that rule) */
export function stylesheet(this: P, T: TokenMap) {
  const $ = this;
  return (options: Record<string, any> = {}) => {
    let context: TreeContext;
    if (options.context) {
      context = $.context = options.context;
    } else {
      context = $.context;
    }

    let charset: IToken | undefined;

    if (!$.looseMode) {
      $.OPTION(() => {
        charset = $.CONSUME(T.Charset);
      });
    }

    const ctx: RuleContext = { isRoot: true } as any;

    let root: Node = $.SUBRULE($.main, { ARGS: [ctx] });

    let rules = (root as any)?.value as any[];

    if (charset) {
      let charsetLoc = $.getLocationInfo(charset);
      let rootLoc = root.location;
      rules.unshift(new Any(charset.image, { role: 'charset' }, charsetLoc, context!));
      rootLoc[0] = charsetLoc[0];
      rootLoc[1] = charsetLoc[1];
      rootLoc[2] = charsetLoc[2];
    }

    return root;
  };
}

/**
 * Starts with a colon, with these conditions
 *  1. It is not preceded by a space or
 *  2. If it is preceded by a space, then it is
 *     followed by a space.
 */

export function main(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const shouldTryQualifiedRuleInDeclarationList = () => {
      const isSelectorLikeContinuation = (offset: number) => {
        const tok = $.LA(offset);
        return (
          tokenMatcher(tok, T.LCurly)
          || tokenMatcher(tok, T.Comma)
          || tokenMatcher(tok, T.Combinator)
          || tokenMatcher(tok, T.LSquare)
          || tokenMatcher(tok, T.Colon)
          || tokenMatcher(tok, T.NthPseudoClass)
          || tokenMatcher(tok, T.SelectorPseudoClass)
        );
      };
      if (typeof $.shouldTryQualifiedRuleInDeclarationList === 'function') {
        return $.shouldTryQualifiedRuleInDeclarationList();
      }
      if (!$.isTypeAt(1, T.Ident)) {
        return true;
      }
      if (!$.isTypeAt(2, T.Assign)) {
        return true;
      }
      if ($.hasWS(2)) {
        return false;
      }
      const tt3 = $.LA(3).tokenType;
      if (
        tt3 === T.Colon
        || tt3 === T.NthPseudoClass
        || tt3 === T.SelectorPseudoClass
        || tokenMatcher($.LA(3), T.FunctionStart)
      ) {
        return true;
      }
      if (!tokenMatcher($.LA(3), T.Ident)) {
        return false;
      }
      return isSelectorLikeContinuation(4);
    };
    const isMixinOrQualifiedStart = () => {
      const next = $.LA(1).tokenType;
      return next === T.DotName || next === T.HashName || next === T.ColorIdentStart;
    };
    const isCustomPropertyStart = () =>
      $.isType(T.InterpolatedCustomProperty) || $.isType(T.CustomProperty);
    const isAtRuleStart = () => tokenMatcher($.LA(1), T.AtName);
    const shouldTryQualifiedRule = () =>
      !isCustomPropertyStart()
      && !isMixinOrQualifiedStart()
      && !isAtRuleStart()
      && shouldTryQualifiedRuleInDeclarationList();

    const ruleAlt = (ctx: RuleContext = {}): Alt => {
      let isVariable = isVariableLike($, T);
      return [
        { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
        { ALT: () => $.SUBRULE2($.ampersandExtend, { ARGS: [ctx] }) },
        {
          GATE: isMixinOrQualifiedStart,
          ALT: () => $.SUBRULE3($.mixinOrQualifiedRule, { ARGS: [ctx] })
        },
        {
          GATE: () => isVariable,
          ALT: () => $.SUBRULE4($.varDeclarationOrCall, { ARGS: [ctx] })
        },
        {
          GATE: () => !isVariable && isAtRuleStart(),
          ALT: () => $.SUBRULE5($.atRule, { ARGS: [ctx] })
        },
        {
          GATE: isCustomPropertyStart,
          ALT: () => $.SUBRULE7($.declaration, { ARGS: [ctx] })
        },
        {
          GATE: shouldTryQualifiedRule,
          ALT: () => $.SUBRULE6($.qualifiedRule, { ARGS: [ctx] })
        },

        /**
         * Historically, Less allows `@charset` anywhere,
         * to avoid outputting it in the wrong place.
         * Ideally, this would result in an error if, say,
         * the `@charset` was defined at the bottom of the file,
         * but that wasn't the solution made.
         * @see https://github.com/less/less.js/issues/2126
         */
        {
          GATE: () => $.looseMode,
          ALT: () => $.CONSUME(T.Charset)
        },
        { ALT: () => $.CONSUME(T.Semi) }
      ];
    };

    let RECORDING_PHASE = $.RECORDING_PHASE;
    let context: TreeContext;
    let rules: Node[];
    if (!RECORDING_PHASE) {
      context = $.context;
      rules = [];
    }

    let requiredSemi = false;

    let lastRule: Node | undefined;
    /**
     * In this production rule, semi-colons are not required
     * but this is repurposed by declarationList and by Less / Sass,
     * so that's why this gate is here.
     */
    $.MANY({
      GATE: () => {
        const next = $.LA(1);
        // Stop at RCurly (belongs to parent block) or end of input
        if ($.isType(T.RCurly) || next.tokenType.name === 'EOF') {
          return false;
        }
        return !requiredSemi || (requiredSemi && (
          $.isType(T.Semi)
          || $.isTypeAt(0, T.Semi)
        ));
      },
      DEF: () => {
        const localAlt = ruleAlt(ctx);
        let value: Node | IToken = $.OR(localAlt);
        if (!RECORDING_PHASE) {
          /** @todo - When do we not have a value? */
          if (value) {
            if (!(value instanceof Node)) {
              /** This is a semi-colon or charset token */
              let tok = value as IToken;
              if (tok.image.includes('@charset')) {
                rules!.push(new Any(tok.image, { role: 'charset' }, $.getLocationInfo(tok), context!));
              } else {
                if (lastRule) {
                  lastRule.options.semi = true;
                } else {
                  rules!.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), context!));
                }
              }
            } else {
              requiredSemi = !!value.requiredSemi;
              rules!.push(value);
              lastRule = value;
            }
          }
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    // Process any extendNodes that were set (e.g., by ampersandExtend at root level)
    if (ctx.extendNodes && ctx.extendNodes!.length > 0) {
      // Filter out Nil nodes (returned by ampersandExtend to avoid duplication)
      const filteredRules = rules!.filter(r => !(r instanceof Nil));
      rules = [...ctx.extendNodes!, ...filteredRules];
      ctx.extendNodes = undefined;
    }
    let returnNode = $.getRulesWithComments(rules!, $.getLocationInfo($.LA(1)));
    // Attaches remaining whitespace at the end of rules
    return $.wrap(returnNode!, true);
  };
}

export function declarationList(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const shouldTryQualifiedRuleInDeclarationList = () => {
      const isSelectorLikeContinuation = (offset: number) => {
        const tok = $.LA(offset);
        return (
          tokenMatcher(tok, T.LCurly)
          || tokenMatcher(tok, T.Comma)
          || tokenMatcher(tok, T.Combinator)
          || tokenMatcher(tok, T.LSquare)
          || tokenMatcher(tok, T.Colon)
          || tokenMatcher(tok, T.NthPseudoClass)
          || tokenMatcher(tok, T.SelectorPseudoClass)
        );
      };
      if (typeof $.shouldTryQualifiedRuleInDeclarationList === 'function') {
        return $.shouldTryQualifiedRuleInDeclarationList();
      }
      if (!$.isTypeAt(1, T.Ident)) {
        return true;
      }
      if (!$.isTypeAt(2, T.Assign)) {
        return true;
      }
      if ($.hasWS(2)) {
        return false;
      }
      const tt3 = $.LA(3).tokenType;
      if (
        tt3 === T.Colon
        || tt3 === T.NthPseudoClass
        || tt3 === T.SelectorPseudoClass
        || tokenMatcher($.LA(3), T.FunctionStart)
      ) {
        return true;
      }
      if (!tokenMatcher($.LA(3), T.Ident)) {
        return false;
      }
      return isSelectorLikeContinuation(4);
    };
    const isMixinOrQualifiedStart = () => {
      const next = $.LA(1).tokenType;
      return next === T.DotName || next === T.HashName || next === T.ColorIdentStart;
    };
    const isCustomPropertyStart = () =>
      $.isType(T.InterpolatedCustomProperty) || $.isType(T.CustomProperty);
    const isAtRuleStart = () => tokenMatcher($.LA(1), T.AtName);
    const shouldTryQualifiedRule = () =>
      !isCustomPropertyStart()
      && !isMixinOrQualifiedStart()
      && !isAtRuleStart()
      && shouldTryQualifiedRuleInDeclarationList();

    const ruleAlt = (ctx: RuleContext = {}): Alt => {
      const isVariable = isVariableLike($, T);
      return [
        {
          GATE: isMixinOrQualifiedStart,
          ALT: () => {
            return $.SUBRULE($.mixinOrQualifiedRule, { ARGS: [{ ...ctx, inner: true }] });
          }
        },
        {
          GATE: () => isVariable,
          ALT: () => $.SUBRULE2($.varDeclarationOrCall, { ARGS: [ctx] })
        },
        {
          GATE: () => !isVariable && isAtRuleStart(),
          ALT: () => $.SUBRULE3($.innerAtRule, { ARGS: [ctx] })
        },
        { ALT: () => $.SUBRULE4($.ampersandExtend, { ARGS: [ctx] }) },
        {
          GATE: () => $.check(T.FunctionStart),
          ALT: () => {
            const fnCall = $.SUBRULE5($.functionCall, { ARGS: [ctx] });
            if (fnCall instanceof Call) {
              fnCall.requiredSemi = false;
            }
            return fnCall;
          }
        },
        {
          GATE: isCustomPropertyStart,
          ALT: () => $.SUBRULE8($.declaration, { ARGS: [ctx] })
        },
        {
          GATE: shouldTryQualifiedRule,
          ALT: () => {
            return $.SUBRULE6($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] });
          }
        },
        {
          ALT: () => {
            return $.SUBRULE7($.declaration, { ARGS: [ctx] });
          }
        },
        { ALT: () => $.CONSUME(T.Semi) }
      ];
    };

    return cssMain.call($, T, ruleAlt)(ctx);
  };
}

export function declaration(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const customPropertyAlt = (consumeName: () => IToken, occurrence: 2 | 3) => ({
      ALT: () => {
        let nodes: Node[] | undefined;
        if (!$.RECORDING_PHASE) {
          nodes = [];
        }
        const name = consumeName();
        const assign = occurrence === 2
          ? $.CONSUME2(T.Assign)
          : $.CONSUME3(T.Assign);
        $.startRule();
        while (startsCustomValue($, T)) {
          const val = occurrence === 2
            ? $.SUBRULE2($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] })
            : $.SUBRULE3($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] });
          if (!$.RECORDING_PHASE) {
            nodes!.push(val);
          }
        }
        if (!$.RECORDING_PHASE) {
          const location = $.endRule();
          let nameNode: Node;
          const nameValue = name.image;
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name), $.context);
          } else {
            nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
          }
          const value = new Sequence(nodes!, undefined, location, $.context);
          return [nameNode, assign, value];
        }
      }
    });

    const ruleAlt = (ctx: RuleContext = {}): Alt => [
      {
        ALT: () => {
          let name: IToken;
          $.OR2([
            {
              ALT: () => {
                name = $.CONSUME(T.Ident);
              }
            },
            {
              GATE: () => $.legacyMode,
              ALT: () => name = $.CONSUME(T.LegacyPropIdent)
            }
          ]);
          const assign = $.CONSUME(T.Assign);
          let value: Node | undefined;
          if ($.looseMode) {
            $.OPTION2({
              GATE: () => !($.isType(T.Semi) || $.isType(T.RCurly)),
              DEF: () => {
                value = $.SUBRULE($.valueList, { ARGS: [ctx] });
              }
            });
            if (!$.RECORDING_PHASE && !value) {
              value = new Sequence([], undefined, undefined, $.context);
            }
          } else {
            value = $.SUBRULE($.valueList, { ARGS: [ctx] });
          }
          let important: IToken | undefined;

          $.OPTION(() => {
            important = $.CONSUME(T.Important);
          });
          if (!$.RECORDING_PHASE) {
            let nameNode: Node;
            const nameValue = name!.image;
            if (nameValue.includes('@') || nameValue.includes('$')) {
              nameNode = getInterpolated(nameValue, $.getLocationInfo(name!), $.context);
            } else {
              nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), $.context), true);
            }
            return [nameNode, assign, value, important];
          }
        }
      },
      customPropertyAlt(() => $.CONSUME(T.InterpolatedCustomProperty), 2),
      customPropertyAlt(() => $.CONSUME(T.CustomProperty), 3)
    ];

    return cssDeclaration.call($, T, ruleAlt)(ctx);
  };
}

export function mediaInParens(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    $.CONSUME(T.LParen);

    const node = $.OR([
      {
        GATE: () => $.startsMediaCondition(T),
        ALT: () => $.SUBRULE($.mediaCondition, { ARGS: [ctx] })
      },
      {
        GATE: () => isEscapedString($, T),
        ALT: () => $.SUBRULE($.string, { ARGS: [ctx] })
      },
      {
        /**
         * Less allows media/container conditions to be supplied by variables or
         * namespaced references, but only when the inner token stream actually
         * starts like a Less reference, not a plain CSS media feature.
         */
        GATE: () => (
          $.isType(T.PropertyReference)
          || $.isType(T.NestedReference)
          || $.isType(T.AtName)
          || $.isType(T.HashName)
          || $.isType(T.DotName)
          || $.isType(T.ColorIdentStart)
          || $.isType(T.InterpolatedSelector)
        ),
        ALT: () => $.SUBRULE2($.valueReference, { ARGS: [{ ...ctx, requireAccessorsAfterMixinCall: true }] })
      },
      {
        ALT: () => $.SUBRULE($.mediaFeature, { ARGS: [ctx] })
      }
    ]);

    $.CONSUME(T.RParen);

    if (RECORDING_PHASE) {
      return;
    }
    const location = $.endRule();
    return $.wrap(new Paren($.wrap(node, 'both'), undefined, location, $.context));
  };
}

export function mediaQuery(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR2([
      {
        GATE: () => $.startsMediaCondition(T),
        ALT: () => $.SUBRULE($.mediaConditionWithoutOr, { ARGS: [ctx] })
      },
      {
        GATE: () => isEscapedString($, T),
        ALT: () => $.SUBRULE($.lessMediaQueryFromString, { ARGS: [ctx] })
      },
      {
        GATE: () => startsLessMediaQueryReference($, T),
        ALT: () => $.SUBRULE2($.lessMediaQueryFromReference, { ARGS: [ctx] })
      },
      {
        ALT: () => $.SUBRULE7($.mediaTypeQuery, { ARGS: [ctx] })
      }
    ]);
  };
}

export function mediaCondition(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.SUBRULE($.mediaConditionWithoutOr, { ARGS: [ctx] });
}

export function lessMediaQueryFromString(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const first = $.SUBRULE($.string, { ARGS: [ctx] });
    return $.SUBRULE($.lessMediaQueryTail, { ARGS: [{ ...ctx, startValue: first }] });
  };
}

export function lessMediaQueryFromReference(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const first = $.SUBRULE($.valueReference, { ARGS: [{ ...ctx, requireAccessorsAfterMixinCall: true }] });
    return $.SUBRULE2($.lessMediaQueryTail, { ARGS: [{ ...ctx, startValue: first }] });
  };
}

export function lessMediaQueryTail(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[] | undefined;
    if (!RECORDING_PHASE) {
      nodes = [ctx.startValue!];
    }

    $.MANY({
      GATE: () => $.isType(T.And),
      DEF: () => {
        const andToken = $.CONSUME(T.And);
        const next = $.OR([
          {
            GATE: () => isEscapedString($, T),
            ALT: () => $.SUBRULE2($.string, { ARGS: [ctx] })
          },
          {
            GATE: () => startsLessMediaQueryReference($, T),
            ALT: () => $.SUBRULE2($.valueReference, { ARGS: [{ ...ctx, requireAccessorsAfterMixinCall: true }] })
          },
          {
            GATE: () => $.startsMediaCondition(T),
            ALT: () => $.SUBRULE2($.mediaConditionWithoutOr, { ARGS: [ctx] })
          },
          {
            ALT: () => $.SUBRULE2($.mediaType, { ARGS: [ctx] })
          }
        ]);

        if (!RECORDING_PHASE) {
          nodes!.push($.wrap(new Keyword(andToken.image, undefined, $.getLocationInfo(andToken), $.context), 'both'));
          nodes!.push(next);
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    const location = $.endRule();
    if (nodes!.length === 1) {
      return nodes![0]!;
    }
    return new QueryCondition(nodes!, undefined, location, $.context);
  };
}

export function mediaConditionWithoutOr(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    { ALT: () => $.SUBRULE($.mediaNot, { ARGS: [ctx] }) },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let nodes: Node[] | undefined;
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        const node = $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          nodes!.push(node);
        }
        $.MANY({
          GATE: () => $.isType(T.And),
          DEF: () => {
            const rule = $.SUBRULE($.mediaAnd, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes!.push(...rule);
            }
          }
        });
        if (RECORDING_PHASE) {
          return;
        }
        if (nodes!.length === 1) {
          $.endRule();
          return nodes![0]!;
        }
        return new QueryCondition(nodes!, undefined, $.endRule(), $.context);
      }
    }
  ]);
}

export function supportsAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    const name = $.CONSUME(T.AtSupports);
    const prelude = $.SUBRULE($.lessSupportsCondition, { ARGS: [ctx] });
    $.CONSUME(T.LCurly);
    const rules = $.SUBRULE($.atRuleBody, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);

    if ($.RECORDING_PHASE) {
      return;
    }
    const location = $.endRule();
    return new AtRule({
      name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
      prelude: $.wrap(prelude, 'both'),
      rules
    }, { nestable: true }, location, $.context);
  };
}

export function lessSupportsCondition(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    {
      GATE: () => $.isType(T.Not),
      ALT: () => {
        $.startRule();
        const keyword = $.CONSUME(T.Not);
        const value = $.SUBRULE($.lessSupportsInParens, { ARGS: [ctx] });

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return new QueryCondition([
          $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), $.context)),
          value
        ], undefined, location, $.context);
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let left = $.SUBRULE2($.lessSupportsInParens, { ARGS: [ctx] });

        $.MANY({
          GATE: () => $.isType(T.And) || $.isType(T.Or),
          DEF: () => {
            const keyword = $.OR2([
              { ALT: () => $.CONSUME(T.And) },
              { ALT: () => $.CONSUME(T.Or) }
            ]);
            const right = $.SUBRULE3($.lessSupportsInParens, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              const [startOffset, startLine, startColumn] = left.location;
              const [,,, endOffset, endLine, endColumn] = right.location;
              left = new QueryCondition([
                left,
                $.wrap(new Keyword(keyword.image, undefined, $.getLocationInfo(keyword), $.context)),
                right
              ], undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], $.context);
            }
          }
        });

        if ($.RECORDING_PHASE) {
          return;
        }
        $.endRule();
        return left;
      }
    }
  ]);
}

export function lessSupportsInParens(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    {
      GATE: () => $.isType(T.Ident) && $.isTypeAt(2, T.LParen),
      ALT: () => {
        $.startRule();
        const name = $.CONSUME(T.Ident);
        $.CONSUME(T.LParen);
        const args = $.SUBRULE($.valueList, { ARGS: [ctx] });
        $.CONSUME2(T.RParen);

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return new Call({ name: name.image, args }, undefined, location, $.context);
      }
    },
    {
      GATE: () => $.isType(T.LParen),
      ALT: () => {
        $.startRule();
        $.CONSUME3(T.LParen);
        let value: Node | undefined;
        $.OPTION({
          GATE: () => (
            $.isType(T.Not)
            || $.isType(T.LParen)
            || ($.isType(T.Ident) && $.isTypeAt(2, T.LParen))
          ),
          DEF: () => {
            value = $.SUBRULE($.lessSupportsCondition, { ARGS: [ctx] });
          }
        });
        $.OPTION2({
          GATE: () => (
            !$.isType(T.Not)
            && !$.isType(T.LParen)
            && !($.isType(T.Ident) && $.isTypeAt(2, T.LParen))
          ),
          DEF: () => {
            value = $.SUBRULE($.declaration, { ARGS: [ctx] });
          }
        });
        $.CONSUME4(T.RParen);

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return $.wrap(new Paren($.wrap(value, 'both'), undefined, location, $.context));
      }
    }
  ]);
}

export function supportsInParens(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    {
      GATE: () => $.isType(T.Ident) && $.isTypeAt(2, T.LParen),
      ALT: () => {
        $.startRule();
        const name = $.CONSUME(T.Ident);
        $.CONSUME(T.LParen);
        const args = $.SUBRULE($.valueList, { ARGS: [ctx] });
        $.CONSUME2(T.RParen);

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return new Call({ name: name.image, args }, undefined, location, $.context);
      }
    },
    {
      GATE: () => $.isType(T.LParen),
      ALT: () => {
        $.startRule();
        $.CONSUME3(T.LParen);
        let value: Node | undefined;
        $.OPTION({
          GATE: () => (
            $.isType(T.Not)
            || $.isType(T.LParen)
            || ($.isType(T.Ident) && $.isTypeAt(2, T.LParen))
          ),
          DEF: () => {
            value = $.SUBRULE($.supportsCondition, { ARGS: [ctx] });
          }
        });
        $.OPTION2({
          GATE: () => (
            !$.isType(T.Not)
            && !$.isType(T.LParen)
            && !($.isType(T.Ident) && $.isTypeAt(2, T.LParen))
          ),
          DEF: () => {
            value = $.SUBRULE($.declaration, { ARGS: [ctx] });
          }
        });
        $.CONSUME4(T.RParen);

        if ($.RECORDING_PHASE) {
          return;
        }
        const location = $.endRule();
        return $.wrap(new Paren($.wrap(value, 'both'), undefined, location, $.context));
      }
    }
  ]);
}

export function containerInParens(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    // Reuse mediaInParens which already handles variables
    return $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
  };
}

export function mediaFeature(this: P, T: TokenMap) {
  const $ = this;

  const createFeatureIdentNode = (token: IToken, role: 'ident' | 'property') => {
    const location = $.getLocationInfo(token);
    const resolved = getInterpolatedOrString(token.image, location, $.context);
    if (typeof resolved === 'string') {
      return new Any(resolved, { role }, location, $.context);
    }
    return resolved;
  };

  return (ctx: RuleContext = {}) => $.OR([
    {
      GATE: () => {
        return $.isType(T.InterpolatedIdent) || $.isType(T.Ident);
      },
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        let rule: Node | undefined;
        const ident = $.LA(1).tokenType === T.InterpolatedIdent
          ? $.CONSUME(T.InterpolatedIdent)
          : $.CONSUME(T.Ident);
        $.OPTION(() => {
          rule = $.OR2([
            {
              ALT: () => {
                $.CONSUME(T.Colon);
                const value = $.SUBRULE($.mfValue, { ARGS: [ctx] });
                if (!RECORDING_PHASE) {
                  const location = $.endRule();
                  return $.wrap(
                    new Declaration({
                      name: $.wrap(createFeatureIdentNode(ident, 'property'), true),
                      value: $.wrap(value)
                    }, undefined, location, $.context),
                    'both'
                  );
                }
              }
            },
            {
              GATE: () => ($.isTypeAt(1, T.MfLt) || $.isTypeAt(1, T.MfGt))
                && ($.isTypeAt(2, T.Ident) || $.isTypeAt(2, T.InterpolatedIdent)),
              ALT: () => {
                const seq = $.SUBRULE($.mediaRange, { ARGS: [ctx] });

                if (!RECORDING_PHASE) {
                  const [startOffset, startLine, startColumn] = $.endRule();
                  seq.value.unshift($.wrap(createFeatureIdentNode(ident, 'ident'), true));
                  seq.location[0] = startOffset;
                  seq.location[1] = startLine;
                  seq.location[2] = startColumn;
                  return new QueryCondition(seq.value, undefined, seq.location, $.context);
                }
                return seq;
              }
            },
            {
              GATE: () => $.isTypeAt(1, T.MfLt) || $.isTypeAt(1, T.MfGt) || $.LA(1).tokenType === T.Eq,
              ALT: () => {
                const op = $.SUBRULE($.mfComparison, { ARGS: [ctx] });
                const value = $.SUBRULE($.mfNonIdentifierValue, { ARGS: [ctx] });

                if (!RECORDING_PHASE) {
                  const location = $.endRule();
                  return new QueryCondition([
                    $.wrap(createFeatureIdentNode(ident, 'ident'), true),
                    $.wrap(new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), $.context), 'both'),
                    value
                  ], undefined, location, $.context);
                }
              }
            }
          ]);
        });
        if (!RECORDING_PHASE && !rule) {
          const location = $.endRule();
          const identNode = createFeatureIdentNode(ident, 'ident');
          return $.wrap(new QueryCondition([identNode], undefined, location, $.context), 'both');
        }
        return rule;
      }
    },
    {
      ALT: () => {
        const RECORDING_PHASE = $.RECORDING_PHASE;
        $.startRule();
        const left = $.SUBRULE2($.mfNonIdentifierValue, { ARGS: [{ ...ctx }] });
        return $.OR3([
          {
            GATE: () => {
              const tt2 = $.LA(2).tokenType;
              if (!(($.isTypeAt(1, T.MfLt) || $.isTypeAt(1, T.MfGt) || $.LA(1).tokenType === T.Eq)
                && (tt2 === T.Ident || tt2 === T.InterpolatedIdent))) {
                return false;
              }
              if ($.isTypeAt(3, T.MfLt) || $.isTypeAt(3, T.MfGt)) {
                return false;
              }
              return true;
            },
            ALT: () => {
              const op = $.SUBRULE2($.mfComparison, { ARGS: [{ ...ctx }] });
              const value = $.LA(1).tokenType === T.Ident
                ? $.CONSUME2(T.Ident)
                : $.CONSUME2(T.InterpolatedIdent);
              if (!RECORDING_PHASE) {
                const location = $.endRule();
                return new QueryCondition([
                  left,
                  $.wrap(new Any(op.image, { role: 'operator' }, $.getLocationInfo(op), $.context)),
                  $.wrap(createFeatureIdentNode(value, 'ident'), 'both')
                ], undefined, location, $.context);
              }
            }
          },
          {
            ALT: () => {
              const seq = $.SUBRULE2($.mediaRange, { ARGS: [{ ...ctx }] });
              if (!RECORDING_PHASE) {
                const [startOffset, startLine, startColumn] = $.endRule();
                seq.value.unshift(left);
                seq.location[0] = startOffset;
                seq.location[1] = startLine;
                seq.location[2] = startColumn;
                return new QueryCondition(seq.value, undefined, seq.location, $.context);
              }
              return seq;
            }
          }
        ]);
      }
    }
  ]);
}

export function mfValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    /**
     * Like the original Less Parser, we're
     * going to allow any value expression,
     * and it's up to the Less author to know
     * if it's valid.
     */
    const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
    const node = $.SUBRULE($.expressionSum, { ARGS: [exprCtx] });
    return wrapOuterExpressionIfNeeded.call($, node, exprCtx);
  };
}

export function mfNonIdentifierValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    return $.OR2([
      {
        GATE: () => {
          const next = $.LA(1);
          return next.tokenType === T.AtKeyword || next.tokenType === T.PropertyReference || next.tokenType === T.NestedReference;
        },
        ALT: () => $.SUBRULE($.valueReference, { ARGS: [{ ...ctx, requireAccessorsAfterMixinCall: true }] })
      },
      {
        ALT: () => {
          $.startRule();
          let num1 = $.CONSUME(T.Number);
          let num2: IToken | undefined;
          $.OPTION(() => {
            $.CONSUME(T.Slash);
            num2 = $.CONSUME2(T.Number);
          });
          let location = $.endRule();
          let num1Node = $.wrap($.processValueToken(num1), 'both');
          if (!num2) {
            return num1Node;
          }
          let num2Node = $.wrap($.processValueToken(num2), 'both');
          return new List([num1Node, num2Node], { sep: '/' }, location, $.context);
        }
      },
      {
        ALT: () => {
          let dim = $.CONSUME(T.Dimension);
          return $.wrap($.processValueToken(dim), 'both');
        }
      }
    ]);
  };
}

export function wrappedDeclarationList(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.CONSUME(T.LCurly);
    let rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
    $.CONSUME(T.RCurly);
    return rules;
  };
}

export function qualifiedRuleBody(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    let selector!: Selector;
    let isSelectorList: boolean | undefined;
    selector = ctx.selector as Selector;
    isSelectorList = (ctx.isSelectorList as boolean | undefined) ?? selector instanceof SelectorList;

    let guard: Condition | undefined;
    if (!isSelectorList) {
      $.OPTION(() => {
        guard = $.SUBRULE($.guard, { ARGS: [ctx] }) as Condition;
      });
    }
    $.CONSUME(T.LCurly);
    let savedExtendNodes: Extend[] | undefined;
    if (!$.RECORDING_PHASE) {
      // Save extendNodes before parsing declarationList, so nested rulesets don't inherit them
      // Make a copy of the array (not just a reference) so mutations during nested parsing don't affect it
      savedExtendNodes = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
      ctx.extendNodes = undefined;
    }
    let rules = $.SUBRULE2($.declarationList, { ARGS: [ctx] });
    let end = $.CONSUME(T.RCurly);
    if (!$.RECORDING_PHASE) {
    // After declarationList, check if new extends were added (e.g., by ampersandExtend)
    // If so, merge them with the saved extends; otherwise restore the saved extends
      const newExtends = ctx.extendNodes as Extend[] | undefined;
      if (newExtends && newExtends.length) {
      // New extends were added during declarationList (e.g., &:extend())
        if (savedExtendNodes && savedExtendNodes.length > 0) {
        // Merge with saved extends
          ctx.extendNodes = [...savedExtendNodes, ...newExtends];
        } else {
        // Keep the new extends
          ctx.extendNodes = newExtends;
        }
      } else {
      // No new extends, restore saved extends
        ctx.extendNodes = savedExtendNodes;
      }
      let extend = ctx.extendNodes;
      if (extend?.length) {
      /** If it's not a selector list, then our only extend does not need to be grouped */
        if (!isSelectorList) {
        /** For extends inside rulesets (not bubbled), selector should be undefined
         * so it defaults to ampersand and resolves to the ruleset's selector */
          for (let e of extend) {
            e.selector = undefined;
          }
          rules.setData([...extend, ...rules.value]);
          ctx.extendNodes = undefined;
        } else {
          const selectorList = selector as SelectorList;
          const selectorCount = selectorList.value.length;
          const extendCount = extend.length;

          // Determine if extends should bubble up:
          // 1. If any selectors in the list have extends (extendCount < selectorCount)
          // 2. If all selectors have extends but their "all" flags don't match
          let shouldBubble = false;

          if (extendCount < selectorCount) {
          // Some selectors have extends, some don't - bubble up
            shouldBubble = true;
          } else if (extendCount === selectorCount) {
          // All selectors have extends - check if flags match
            let finalExtends = groupExtendsByTargetAndFlag(extend);
            if (finalExtends.length === 1) {
            // All extends have same target and flag - can be inside ruleset
              let extendNodes = finalExtends[0]!;
              let finalExtend = isArray(extendNodes) ? extendNodes[0]! : extendNodes;
              finalExtend.selector = undefined;
              rules.setData([finalExtend, ...rules.value]);
              ctx.extendNodes = undefined;
            } else {
            // Multiple extend groups (different targets/flags) - bubble up
              shouldBubble = true;
            }
          } else {
          // extendCount > selectorCount - shouldn't happen, but bubble to be safe
            shouldBubble = true;
          }

          if (shouldBubble) {
          // Keep extends in ctx.extendNodes so they bubble up to qualifiedRule
          // Don't clear ctx.extendNodes - let them bubble
          // The extends will be prepended above the ruleset in qualifiedRule
          }
        }
      }
      let node = new Ruleset({ selector, rules, guard }, undefined, undefined, $.context);
      let [startOffset, startLine, startColumn] = selector.location!;
      let { endOffset, endLine, endColumn } = end;
      node._location = [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!];

      return node;
    }
  };
}

export function qualifiedRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}, altContext?: AltContext) => {
    let selectorAlt = altContext ?? ((ctx: RuleContext) => [
      {
        GATE: () => !ctx.inner,
        ALT: () => {
          let initialQualifiedRule = ctx.qualifiedRule;
          ctx.qualifiedRule = true;
          try {
            return $.SUBRULE($.selectorList, { ARGS: [ctx] });
          } finally {
            ctx.qualifiedRule = initialQualifiedRule;
          }
        }
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => {
          let initialQualifiedRule = ctx.qualifiedRule;
          let initialFirstSelector = ctx.firstSelector;
          ctx.firstSelector = true;
          ctx.qualifiedRule = true;
          try {
            return $.SUBRULE2($.forgivingSelectorList, { ARGS: [ctx] });
          } finally {
            ctx.qualifiedRule = initialQualifiedRule;
            ctx.firstSelector = initialFirstSelector;
          }
        }
      }
    ]);
    // qualifiedRule
    //   : selectorList WS* LCURLY declarationList RCURLY
    //   ;
    // Save parent's extendNodes before parsing selector (which may set extendNodes)
    let savedExtendNodes = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
    // Set extendNodes to a fresh empty array upon entry to this qualifiedRule
    // so nested rulesets don't inherit extends from parent rulesets
    ctx.extendNodes = undefined;
    let selector: Selector = $.OR(selectorAlt(ctx));
    // Use the same context object so modifications propagate back
    ctx.selector = selector;
    // Now extendNodes may have been set by extend() during selector parsing
    // Save it for this ruleset, then clear it so nested rulesets don't see it
    let thisExtendNodes = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
    ctx.extendNodes = undefined;
    let rule: Node = $.SUBRULE3($.qualifiedRuleBody, { ARGS: [ctx] });
    // After qualifiedRuleBody returns, ctx.extendNodes may contain:
    // 1. Extends that should bubble up (from nested rulesets or this ruleset that didn't match)
    // 2. Nothing (if all extends were processed)
    // Restore this ruleset's extendNodes (from selector parsing) to process them
    const bubblingExtends = ctx.extendNodes; // Extends that should bubble up
    ctx.extendNodes = thisExtendNodes;
    // Restore parent's extendNodes after processing this ruleset's extends
    let parentExtendNodes = savedExtendNodes;
    if (ctx.extendNodes) {
      let qRuleset = rule;
      // Set the Extend nodes' selector to the ruleset's selector (not &)
      // This allows the extends to work correctly when evaluated in the wrapper Rules context
      for (const extendNode of ctx.extendNodes) {
        if (extendNode.selector === undefined || (extendNode.selector as any)?.type === 'Ampersand') {
          extendNode.selector = selector;
        }
      }
      /** Prepend a rules block */
      rule = new Rules([
        ...ctx.extendNodes,
        qRuleset
      ]);
      // Set location from the ruleset (which has proper location info)
      if (qRuleset._location) {
        rule._location = qRuleset._location;
      }
      ctx.extendNodes = undefined;
    }
    // Restore parent's extendNodes and merge with any bubbling extends
    const hasBubblingExtends = bubblingExtends && (bubblingExtends as ExtendType[]).length > 0;
    if (hasBubblingExtends) {
      // Bubble them up to parent
      if (parentExtendNodes && parentExtendNodes.length > 0) {
        ctx.extendNodes = [...parentExtendNodes, ...(bubblingExtends as ExtendType[])];
      } else {
        ctx.extendNodes = bubblingExtends as ExtendType[];
      }
    } else {
      ctx.extendNodes = parentExtendNodes;
    }
    return rule;
  };
}

/**
 * In order to not do any backtracking, anything with a class or id selector start
 * will end up here, and everything else will be shunted to the qualified rule.
 */
export function mixinOrQualifiedRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    // Helper function to convert Any nodes to VarDeclaration nodes for mixin definition parameters
    const convertArgsForDefinition = (args: List<Node> | undefined) => {
      if (!args || !args.value.length) {
        return;
      }

      for (let i = 0; i < args.value.length; i++) {
        const node = args.value[i]!;
        const location = node.location && node.location.length > 0 ? node.location as LocationInfo : undefined;

        // If it's an Any node with role: 'name', convert it to VarDeclaration for mixin definition parameters
        if (node instanceof Any && node.role === 'name') {
          // Reuse the existing Any node but change its role to 'property' for the name
          node.role = 'property';
          args.setData(i, new VarDeclaration({
            name: node,
            value: new Nil(undefined, undefined, location, $.context)
          }, { paramVar: true }, location, $.context));
        }
        // Rest nodes with string values can stay as-is for mixin definitions
      }
    };

    // Helper function to convert Any nodes to Reference nodes for mixin call arguments
    const convertArgsForCall = (args: List<Node> | undefined) => {
      if (!args || !args.value.length) {
        return;
      }

      for (let i = 0; i < args.value.length; i++) {
        const node = args.value[i]!;
        const location = node.location && node.location.length > 0 ? node.location as LocationInfo : undefined;

        // If it's an Any node with role: 'name', convert it to Reference for mixin call arguments
        if (node instanceof Any && node.role === 'name') {
          args.setData(i, new Reference({ key: node.valueOf() }, { type: 'variable' }, location, $.context));
        } else if (node instanceof Rest && typeof node.value === 'string') {
          // If it's a Rest node with a string value, convert it to Rest with Reference for mixin call arguments
          args.setData(i, new Rest(new Reference({ key: node.value }, { type: 'variable' }, location, $.context), undefined, location, $.context));
        }
      }
    };

    // qualifiedRule
    //   : selectorList WS* LCURLY declarationList RCURLY
    //   ;
    $.startRule();

    let selector = $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => {
          let initialQualifiedRule = ctx.qualifiedRule;
          ctx.qualifiedRule = true;
          try {
            return $.SUBRULE($.selectorList, { ARGS: [ctx] });
          } finally {
            ctx.qualifiedRule = initialQualifiedRule;
          }
        }
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => {
          let initialQualifiedRule = ctx.qualifiedRule;
          let initialFirstSelector = ctx.firstSelector;
          ctx.firstSelector = true;
          ctx.qualifiedRule = true;
          try {
            return $.SUBRULE2($.forgivingSelectorList, { ARGS: [ctx] });
          } finally {
            ctx.qualifiedRule = initialQualifiedRule;
            ctx.firstSelector = initialFirstSelector;
          }
        }
      }
    ]) as Selector;

    let isSelectorList = selector instanceof SelectorList;
    let guard: Condition | undefined;
    let args: List<Node> | undefined;
    let important: IToken | undefined;

    const createMixinCall = (location: LocationInfo) => {
      let leftNode!: Node;

      // If selector is a CompoundSelector, ComplexSelector, or single BasicSelector (but not SelectorList),
      // create a single Reference with the selector instance as the key instead of nested references.
      // This handles cases like .foo.bar() or .foo > .bar() as a single call.
      // Note: .foo().bar() still creates nested calls because .foo() is parsed separately.
      if (!isSelectorList && (
        selector instanceof CompoundSelector
        || selector instanceof ComplexSelector
        || selector instanceof BasicSelector
      )) {
        // Create a single Reference with the selector instance as the key
        leftNode = new Reference({ key: selector }, { type: 'mixin-ruleset', role: 'name' }, undefined, $.context);
      } else {
        // For other cases (like SelectorList or when we need nested references),
        // iterate through selector nodes and create nested references
        for (let s of selector.nodes()) {
          if (s instanceof BasicSelector) {
            leftNode = new Reference({ target: leftNode as Reference, key: s.valueOf() }, { type: 'mixin-ruleset', role: 'name' }, undefined, $.context);
          }
        }
      }

      /** Finally, pass this reference into a call */
      leftNode = new Call({ name: leftNode, args }, { markImportant: !!important }, location, $.context);
      return leftNode;
    };

    let isPossibleMixinDefinition = (selector instanceof BasicSelector && (selector.isClass || selector.isId))
      || (selector instanceof InterpolatedSelector && (selector.isClass || selector.isId));
    let isPossibleMixinCall = true;
    if (!$.RECORDING_PHASE && !isSelectorList && !isPossibleMixinDefinition) {
      for (let s of selector.nodes()) {
        /** Keep going until we get to basic selectors. */
        if (s instanceof ComplexSelector || s instanceof CompoundSelector) {
          continue;
        }
        if (
          (s instanceof BasicSelector && (s.isClass || s.isId))
          || (s instanceof InterpolatedSelector && (s.isClass || s.isId))
          || (s instanceof Combinator && (s.value === '>' || s.value === ' '))
        ) {
          continue;
        }
        isPossibleMixinCall = false;
        break;
      }
    }
    return $.OR2([
      {
        GATE: () => (isPossibleMixinDefinition || isPossibleMixinCall) && $.isType(T.LParen),
        ALT: () => {
          args = $.SUBRULE3($.mixinArgs, { ARGS: [ctx] });
          let next = $.LA(1).tokenType;
          if (next === T.LCurly || next === T.When) {
            isPossibleMixinCall = false;
          }
          return $.OR3([
            {
              GATE: () => isPossibleMixinDefinition,
              /** Mixin definition */
              ALT: () => {
                $.OPTION(() => {
                  guard = $.SUBRULE4($.guard, { ARGS: [ctx] }) as Condition;
                });
                $.CONSUME(T.LCurly);

                let rules = $.SUBRULE5($.declarationList, { ARGS: [ctx] });
                $.CONSUME(T.RCurly);
                if (!$.RECORDING_PHASE) {
                  // Convert Any nodes to VarDeclaration nodes for mixin definition parameters
                  convertArgsForDefinition(args);
                  const guardText = String(guard?.toString?.() ?? '');
                  const hasDefault = Boolean(ctx.hasDefault) || guardContainsDefaultCall(guard) || guardText.includes('??()');
                  const node = new Mixin(
                    { name: selector.valueOf() as any, params: args, rules, guard },
                    hasDefault ? { hasDefault: true } : undefined,
                    $.endRule(),
                    $.context
                  );
                  ctx.hasDefault = false;
                  return node;
                }
                $.endRule();
              }
            },
            {
              GATE: () => isPossibleMixinCall,
              /** Mixin call */
              ALT: () => {
                $.OPTION2(() => {
                  important = $.CONSUME(T.Important);
                });
                let location: LocationInfo = $.endRule();
                if (!$.RECORDING_PHASE) {
                  // Convert Any nodes to Reference nodes for mixin call arguments
                  convertArgsForCall(args);
                }
                let result: Node | undefined;
                {
                  /** in Less legacy mode, mixin calls can happen without a space. */
                  let noSpace = $.noSep();
                  let next = $.LA(1).tokenType;
                  if ((noSpace && next === T.LSquare) || ((noSpace || $.looseMode) && next === T.LParen)) {
                    result = $.OPTION3(() => $.SUBRULE6($.lookupOrCall, { ARGS: [{ ...ctx, node: $.RECORDING_PHASE ? undefined! : createMixinCall(location) }] }));
                  }
                }
                // Note: Mixin calls without parentheses are handled in the semicolon-terminated ALT below
                return $.RECORDING_PHASE ? undefined : (result ?? createMixinCall(location!));
              }
            }
          ]);
        }
      },
      {
        GATE: () => isPossibleMixinCall && $.isType(T.Semi),
        ALT: () => {
          // Call terminated by a semi-colon and not parens, deprecated
          const semi = $.CONSUME(T.Semi);
          const location = $.endRule();
          if (!$.RECORDING_PHASE) {
            // Mixin call without parentheses - deprecated
            $.warnDeprecation(
              'Calling a mixin without parentheses is deprecated',
              semi,
              'mixin-call-no-parens'
            );
            return createMixinCall(location);
          }
        }
      },
      {
        /** Parse as qualified rule */
        ALT: () => {
          $.endRule();
          let initialSelector = ctx.selector;
          let initialIsSelectorList = ctx.isSelectorList;
          ctx.selector = selector;
          ctx.isSelectorList = isSelectorList;
          let rule: Node;
          try {
            rule = $.SUBRULE7($.qualifiedRuleBody, { ARGS: [ctx] });
          } finally {
            ctx.selector = initialSelector;
            ctx.isSelectorList = initialIsSelectorList;
          }
          if (ctx.extendNodes) {
            /** Prepend a rules block */
            let qRule = rule;
            // Set the Extend nodes' selector to the ruleset's selector (not &)
            // This allows the extends to work correctly when evaluated in the wrapper Rules context
            for (const extendNode of ctx.extendNodes) {
              if (extendNode.selector === undefined || (extendNode.selector as any)?.type === 'Ampersand') {
                extendNode.selector = selector;
              }
            }
            rule = new Rules([
              ...ctx.extendNodes,
              qRule
            ]);
            rule._location = qRule._location;
            ctx.extendNodes = undefined;
          }
          return rule;
        }
      }
    ]);
  };
}
