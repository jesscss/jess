// Root production rules for LessRecursiveParser
// Converted from lines 1-1145 of productions.ts (Chevrotain → hand-written recursive-descent)
import type { RuleContext } from '../lessRecursiveParser.js';
import type { IToken, OrAlternative } from '@jesscss/parser-runtime';
import { tokenMatches } from '@jesscss/parser-runtime';
import { CssRecursiveParser } from '@jesscss/css-parser';

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
  DefaultGuard,
  Rest,
  StyleImport,
  Expression,
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
import type { ExtendTarget } from '../lessRecursiveParser.js';
import { all } from 'known-css-properties';

/** Use `any` for `this` to avoid structural incompatibility between LessRecursiveParser and CssRecursiveParser */
type P = any;
type Alt = OrAlternative[];
type AltContext = (ctx?: RuleContext) => Alt;

// ── Save references to CSS prototype methods ──────────────────────────
const cssMain = CssRecursiveParser.prototype.main;
const cssDeclaration = CssRecursiveParser.prototype.declaration;
const cssMediaInParens = CssRecursiveParser.prototype.mediaInParens;

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
      const callName = (current as Call).data.name;
      const callNameStr = String(
        (callName as any)?.valueOf?.() ?? callName ?? ''
      );
      if (callNameStr === 'default' || callNameStr === '??') {
        return true;
      }
      const key = (callName as any)?.data?.key;
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
  const callName = (node as Call).data.name;
  const callNameStr = String((callName as any)?.valueOf?.() ?? callName ?? '');
  if (callNameStr === 'default' || callNameStr === '??') {
    return true;
  }
  const key = (callName as any)?.data?.key;
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
    const [left, op, right] = node.data;
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

function isEscapedString(this: P) {
  const next = this.LA(1);
  return tokenMatches(next, this.T.QuoteStart) && next.image.startsWith('~');
}

function isVariableLike(this: P): boolean {
  let token = this.LA(2);
  let isColon = token.tokenType === this.T.Colon;
  let isParen = token.tokenType === this.T.LParen;
  let postToken = this.LA(3);

  if (!this.preSkippedTokenMap) {
    return false;
  }

  if (!isColon && !isParen) {
    return false;
  }
  let isVariable = !this.preSkippedTokenMap.has(token.startOffset)
    || (isColon && this.preSkippedTokenMap.has(postToken.startOffset));
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
    let target = ext.data.target;
    let flag = ext.data.flag ?? 1; // ExtendFlag.Exact = 1
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
export function stylesheet(this: P, options: Record<string, any> = {}) {
  const $ = this;
  let context: TreeContext;
  if (options.context) {
    context = $.context = options.context;
  } else {
    context = $.context;
  }

  let charset: IToken | undefined;

  if (!$.looseMode) {
    $.OPTION(() => {
      charset = $.CONSUME($.T.Charset);
    });
  }

  const ctx: RuleContext = { isRoot: true } as any;
  let root: Node = $.main(ctx);

  let rules = root?.data as any[];

  if (charset) {
    let charsetLoc = $.getLocationInfo(charset);
    let rootLoc = root.location;
    rules.unshift(new Any(charset.image, { role: 'charset' }, charsetLoc, context!));
    rootLoc[0] = charsetLoc[0];
    rootLoc[1] = charsetLoc[1];
    rootLoc[2] = charsetLoc[2];
  }

  return root;
}

/**
 * Starts with a colon, with these conditions
 *  1. It is not preceded by a space or
 *  2. If it is preceded by a space, then it is
 *     followed by a space.
 */

export function main(this: P, ctx: RuleContext = {}) {
  const $ = this;
  const ruleAlt = (ctx: RuleContext = {}): Alt => {
    let isVariable = isVariableLike.call(this);
    return [
      { ALT: () => $.functionCall(ctx) },
      { ALT: () => $.ampersandExtend(ctx) },
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next === $.T.DotName || next === $.T.HashName || next === $.T.ColorIdentStart;
        },
        ALT: () => $.mixinOrQualifiedRule(ctx)
      },
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next !== $.T.DotName
            && next !== $.T.HashName
            && next !== $.T.ColorIdentStart;
        },
        ALT: () => $.qualifiedRule(ctx)
      },
      {
        GATE: () => isVariable,
        ALT: () => $.varDeclarationOrCall(ctx)
      },
      {
        GATE: () => !isVariable,
        ALT: () => $.atRule(ctx)
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
        ALT: () => $.CONSUME($.T.Charset)
      },
      { ALT: () => $.CONSUME($.T.Semi) }
    ];
  };

  let context: TreeContext = $.context;
  let rules: Node[] = [];

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
      if (next.tokenType === $.T.RCurly || next.tokenType.name === 'EOF') {
        return false;
      }
      return !requiredSemi || (requiredSemi && (
        next.tokenType === $.T.Semi
        || $.LA(0).tokenType === $.T.Semi
      ));
    },
    DEF: () => {
      const localAlt = ruleAlt(ctx);
      let value: Node | IToken = $.OR(localAlt);
      /** @todo - When do we not have a value? */
      if (value) {
        if (!(value instanceof Node)) {
          /** This is a semi-colon or charset token */
          let tok = value as IToken;
          if (tok.image.includes('@charset')) {
            rules.push(new Any(tok.image, { role: 'charset' }, $.getLocationInfo(tok), context));
          } else {
            if (lastRule) {
              lastRule.options.semi = true;
            } else {
              rules.push(new Any(';', { role: 'semi' }, $.getLocationInfo($.LA(1)), context));
            }
          }
        } else {
          requiredSemi = !!value.requiredSemi;
          rules.push(value);
          lastRule = value;
        }
      }
    }
  });

  // Process any extendNodes that were set (e.g., by ampersandExtend at root level)
  if (ctx.extendNodes && ctx.extendNodes.length > 0) {
    // Filter out Nil nodes (returned by ampersandExtend to avoid duplication)
    const filteredRules = rules!.filter(r => !(r instanceof Nil));
    rules = [...ctx.extendNodes, ...filteredRules];
    ctx.extendNodes = undefined;
  }
  let returnNode = $.getRulesWithComments(rules!, $.getLocationInfo($.LA(1)));
  // Attaches remaining whitespace at the end of rules
  const wrapped = $.wrap(returnNode!, true);

  return wrapped;
}

export function declarationList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let ruleAlt = (ctx: RuleContext = {}): Alt => {
    let isVariable = isVariableLike.call(this);
    return [
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next === $.T.DotName || next === $.T.HashName || next === $.T.ColorIdentStart;
        },
        ALT: () => {
          return $.mixinOrQualifiedRule({ ...ctx, inner: true });
        }
      },
      {
        /**
         * qualifiedRule must come before declaration so that ALL(*)
         * resolves the ambiguity in favor of qualified rules for
         * inputs like `a:hover { }`. The declaration rule's ATN
         * includes a custom-property path that can reach LCurly
         * (via customValue → customBlock), creating a false ambiguity
         * with qualifiedRule. By placing qualifiedRule first, the
         * parser correctly picks it when both paths appear viable.
         */
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next !== $.T.DotName
            && next !== $.T.HashName
            && next !== $.T.ColorIdentStart;
        },
        ALT: () => {
          return $.qualifiedRule({ ...ctx, inner: true });
        }
      },
      {
        ALT: () => {
          return $.declaration(ctx);
        }
      },
      { ALT: () => $.ampersandExtend(ctx) },
      {
        ALT: () => {
          const fnCall = $.functionCall(ctx);
          if (fnCall instanceof Call) {
            // Less allows function calls like `each(...){...}` in declaration lists
            // without a required trailing semicolon.
            fnCall.requiredSemi = false;
          }
          return fnCall;
        }
      },
      {
        GATE: () => isVariable,
        ALT: () => $.varDeclarationOrCall(ctx)
      },
      {
        GATE: () => !isVariable,
        ALT: () => $.innerAtRule(ctx)
      },
      { ALT: () => $.CONSUME($.T.Semi) }
    ];
  };

  return cssMain.call(this, ctx, ruleAlt);
}

export function declaration(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let ruleAlt = (ctx: RuleContext = {}): Alt => [
    {
      ALT: () => {
        let name: IToken;
        $.OR([
          {
            ALT: () => {
              name = $.CONSUME($.T.Ident);
            }
          },
          {
            GATE: () => $.legacyMode,
            ALT: () => name = $.CONSUME($.T.LegacyPropIdent)
          }
        ]);
        let assign = $.CONSUME($.T.Assign);
        let value = $.valueList(ctx);
        let important: IToken | undefined;

        $.OPTION(() => {
          important = $.CONSUME($.T.Important);
        });
        let nameNode: Node;
        let nameValue = name!.image;
        if (nameValue.includes('@') || nameValue.includes('$')) {
          nameNode = getInterpolated(nameValue, $.getLocationInfo(name!), $.context);
        } else {
          nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), $.context), true);
        }
        return [nameNode, assign, value, important];
      }
    },
    {
      ALT: () => {
        let nodes: Node[] = [];
        let name = $.OR([
          { ALT: () => $.CONSUME($.T.InterpolatedCustomProperty) },
          { ALT: () => $.CONSUME($.T.CustomProperty) }
        ]);
        let assign = $.CONSUME($.T.Assign);
        $.startRule();
        $.MANY(() => {
          let val = $.customValue({ ...ctx, inCustomPropertyValue: true });
          nodes!.push(val);
        });
        let location = $.endRule();
        let nameNode: Node;
        let nameValue = name.image;
        if (nameValue.includes('@') || nameValue.includes('$')) {
          nameNode = getInterpolated(nameValue, $.getLocationInfo(name), $.context);
        } else {
          nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), $.context), true);
        }
        let value = new Sequence(nodes!, undefined, location, $.context);
        return [nameNode, assign, value];
      }
    }
  ];

  return cssDeclaration.call(this, ctx, ruleAlt);
}

export function mediaInParens(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let isEscaped = isEscapedString.bind(this);

  return $.OR([
    /**
     * It's up to the Less author to validate that this will produce
     * valid media queries.
     */
    {
      /** Allow escaped strings */
      GATE: isEscaped,
      ALT: () => $.string(ctx)
    },
    /**
     * After Less evaluation, should throw an error
     * if the value of `@myvar` is a ruleset
     */
    {
      ALT: () => {
        return $.valueReference({ ...ctx, requireAccessorsAfterMixinCall: true });
      }
    },
    {
      ALT: () => cssMediaInParens.call(this, ctx)
    }
  ]);
}

export function containerInParens(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Reuse mediaInParens which already handles variables
  return $.mediaInParens(ctx);
}

export function mfValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  /**
   * Like the original Less Parser, we're
   * going to allow any value expression,
   * and it's up to the Less author to know
   * if it's valid.
   */
  const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
  const node = $.expressionSum(exprCtx);
  return wrapOuterExpressionIfNeeded.call(this, node, exprCtx);
}

export function mfNonIdentifierValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    {
      GATE: () => {
        const next = $.LA(1);
        return next.tokenType === $.T.AtKeyword || next.tokenType === $.T.PropertyReference || next.tokenType === $.T.NestedReference;
      },
      ALT: () => $.valueReference({ ...ctx, requireAccessorsAfterMixinCall: true })
    },
    {
      ALT: () => {
        $.startRule();
        let num1 = $.CONSUME($.T.Number);
        let num2: IToken | undefined;
        $.OPTION(() => {
          $.CONSUME($.T.Slash);
          num2 = $.CONSUME($.T.Number);
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
        let dim = $.CONSUME($.T.Dimension);
        return $.wrap($.processValueToken(dim), 'both');
      }
    }
  ]);
}

export function wrappedDeclarationList(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.CONSUME($.T.LCurly);
  let rules = $.declarationList(ctx);
  $.CONSUME($.T.RCurly);
  return rules;
}

export function qualifiedRuleBody(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let selector!: Selector;
  let isSelectorList: boolean | undefined;
  selector = ctx.selector as Selector;
  isSelectorList = (ctx.isSelectorList as boolean | undefined) ?? selector instanceof SelectorList;

  let guard: Condition | undefined;
  if (!isSelectorList) {
    $.OPTION(() => {
      guard = $.guard(ctx) as Condition;
    });
  }
  $.CONSUME($.T.LCurly);
  // Save extendNodes before parsing declarationList, so nested rulesets don't inherit them
  // Make a copy of the array (not just a reference) so mutations during nested parsing don't affect it
  let savedExtendNodes: Extend[] | undefined = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
  ctx.extendNodes = undefined;
  let rules = $.declarationList(ctx);
  let end = $.CONSUME($.T.RCurly);
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
      rules.setData([...extend, ...rules.data]);
      ctx.extendNodes = undefined;
    } else {
      const selectorList = selector as SelectorList;
      const selectorCount = selectorList.data.length;
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
          rules.setData([finalExtend, ...rules.data]);
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

export function qualifiedRule(this: P, ctx: RuleContext = {}, altContext?: AltContext) {
  const $ = this;
  let selectorAlt = altContext ?? ((ctx: RuleContext) => [
    {
      GATE: () => !ctx.inner,
      ALT: () => {
        let initialQualifiedRule = ctx.qualifiedRule;
        ctx.qualifiedRule = true;
        try {
          return $.selectorList(ctx);
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
          return $.forgivingSelectorList(ctx);
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
  let rule: Node = $.qualifiedRuleBody(ctx);
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
      if (extendNode.data.selector === undefined || (extendNode.data.selector as any).type === 'Ampersand') {
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
}

/**
 * In order to not do any backtracking, anything with a class or id selector start
 * will end up here, and everything else will be shunted to the qualified rule.
 */
export function mixinOrQualifiedRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
  // Helper function to convert Any nodes to VarDeclaration nodes for mixin definition parameters
  const convertArgsForDefinition = (args: List<Node> | undefined) => {
    if (!args || !args.data.length) {
      return;
    }

    for (let i = 0; i < args.data.length; i++) {
      const node = args.data[i]!;
      const location = node.location && node.location.length > 0 ? node.location as LocationInfo : undefined;

      // If it's an Any node with role: 'name', convert it to VarDeclaration for mixin definition parameters
      if (node instanceof Any && node.options?.role === 'name') {
        // Reuse the existing Any node but change its role to 'property' for the name
        node.options.role = 'property';
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
    if (!args || !args.data.length) {
      return;
    }

    for (let i = 0; i < args.data.length; i++) {
      const node = args.data[i]!;
      const location = node.location && node.location.length > 0 ? node.location as LocationInfo : undefined;

      // If it's an Any node with role: 'name', convert it to Reference for mixin call arguments
      if (node instanceof Any && node.options?.role === 'name') {
        args.setData(i, new Reference({ key: node.valueOf() }, { type: 'variable' }, location, $.context));
      } else if (node instanceof Rest && typeof node.data === 'string') {
        // If it's a Rest node with a string value, convert it to Rest with Reference for mixin call arguments
        args.setData(i, new Rest(new Reference({ key: node.data }, { type: 'variable' }, location, $.context), undefined, location, $.context));
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
          return $.selectorList(ctx);
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
          return $.forgivingSelectorList(ctx);
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
  if (!isSelectorList && !isPossibleMixinDefinition) {
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
  return $.OR([
    {
      GATE: () => isPossibleMixinDefinition || isPossibleMixinCall,
      ALT: () => {
        args = $.mixinArgs(ctx);
        let next = $.LA(1).tokenType;
        if (next === $.T.LCurly || next === $.T.When) {
          isPossibleMixinCall = false;
        }
        return $.OR([
          {
            GATE: () => isPossibleMixinDefinition,
            /** Mixin definition */
            ALT: () => {
              $.OPTION(() => {
                guard = $.guard(ctx) as Condition;
              });
              $.CONSUME($.T.LCurly);

              let rules = $.declarationList(ctx);
              $.CONSUME($.T.RCurly);
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
          },
          {
            GATE: () => isPossibleMixinCall,
            /** Mixin call */
            ALT: () => {
              $.OPTION(() => {
                important = $.CONSUME($.T.Important);
              });
              let location: LocationInfo = $.endRule();
              // Convert Any nodes to Reference nodes for mixin call arguments
              convertArgsForCall(args);
              let result: Node | undefined;
              {
                /** in Less legacy mode, mixin calls can happen without a space. */
                let noSpace = $.noSep();
                let next = $.LA(1).tokenType;
                if ((noSpace && next === $.T.LSquare) || ((noSpace || $.looseMode) && next === $.T.LParen)) {
                  result = $.OPTION(() => $.lookupOrCall({ ...ctx, node: createMixinCall(location) }));
                }
              }
              // Note: Mixin calls without parentheses are handled in the semicolon-terminated ALT below
              return result ?? createMixinCall(location!);
            }
          }
        ]);
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
          rule = $.qualifiedRuleBody(ctx);
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
            if (extendNode.data.selector === undefined || (extendNode.data.selector as any).type === 'Ampersand') {
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
    },
    {
      GATE: () => isPossibleMixinCall,
      ALT: () => {
        // Call terminated by a semi-colon and not parens, deprecated
        const semi = $.CONSUME($.T.Semi);
        const location = $.endRule();
        // Mixin call without parentheses - deprecated
        $.warnDeprecation(
          'Calling a mixin without parentheses is deprecated',
          semi,
          'mixin-call-no-parens'
        );
        return createMixinCall(location);
      }
    }
  ]);
}
