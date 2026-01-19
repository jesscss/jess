import { type LessActionsParser as P, type TokenMap, type RuleContext } from './lessActionsParser.js';
import {
  tokenMatcher,
  type IToken,
  EMPTY_ALT,
  NoViableAltException,
  type IOrAlt
} from 'chevrotain';
import {
  main as cssMain,
  declaration as cssDeclaration,
  mediaInParens as cssMediaInParens,
  complexSelector as cssComplexSelector,
  nthValue as cssNthValue,
  knownFunctions as cssKnownFunctions,
  mathValue as cssMathValue,
  innerAtRule as cssInnerAtRule,
  type AltContext
} from '@jesscss/css-parser';

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
  ExtendFlag,
  Negative,
  Mixin,
  Condition,
  VarDeclaration,
  Declaration,
  DefaultGuard,
  Rest,
  StyleImport,
  Expression,
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
  isNode
} from '@jesscss/core';
import { getInterpolatedOrString } from './utils.js';
import type { ExtendTarget } from './lessActionsParser.js';
import { all } from 'known-css-properties';

const isEscapedString = function(this: P, T: TokenMap) {
  const next = this.LA(1);
  return tokenMatcher(next, T.QuoteStart) && next.image.startsWith('~');
};

/** Charset moved within `main` (explained in that rule) */
export function stylesheet(this: P, T: TokenMap) {
  const $ = this;

  // stylesheet
  //   : CHARSET? main EOF
  //   ;
  return (options: Record<string, any> = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let context: TreeContext;
    if (!RECORDING_PHASE) {
      if (options.context) {
        context = this._context = options.context;
      } else {
        context = this.context;
      }
      // Less may set scope in context.opts; TreeContext has no scope
    }

    let charset: IToken | undefined;

    $.OPTION({
      GATE: () => !$.looseMode,
      DEF: () => {
        charset = $.CONSUME(T.Charset);
      }
    });

    const ctx: RuleContext = { isRoot: true } as any;
    let root: Node = $.SUBRULE($.main, { ARGS: [ctx] });

    if (!RECORDING_PHASE) {
      let rules = root?.value as any[];

      if (charset) {
        let loc = $.getLocationInfo(charset);
        let rootLoc = root.location;
        rules.unshift(new Any(charset.image, { role: 'charset' }, loc, context!));
        rootLoc[0] = loc[0];
        rootLoc[1] = loc[1];
        rootLoc[2] = loc[2];
      }

      return root;
    }
  };
}

/**
   * Starts with a colon, with these conditions
   *  1. It is not preceded by a space or
   *  2. If it is preceded by a space, then it is
   *     followed by a space.
   */
function isVariableLike(this: P, T: TokenMap) {
  const $ = this;
  let token = $.LA(2);
  let isColon = token.tokenType === T.Colon;
  let isParen = token.tokenType === T.LParen;
  let postToken = $.LA(3);

  // During recording phase, preSkippedTokenMap might not exist
  if (!$.preSkippedTokenMap) {
    return false;
  }

  if (!isColon && !isParen) {
    return false;
  }
  let isVariable = !$.preSkippedTokenMap.has(token.startOffset)
    || (isColon && $.preSkippedTokenMap.has(postToken.startOffset));
  return isVariable;
};

export function main(this: P, T: TokenMap) {
  const $ = this;

  const ruleAlt = (ctx: RuleContext = {}) => {
    let isVariable = isVariableLike.call(this, T);
    return [
      { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.ampersandExtend, { ARGS: [ctx] }) },
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next === T.DotName || next === T.HashName || next === T.ColorIdentStart;
        },
        ALT: () => $.SUBRULE($.mixinOrQualifiedRule, { ARGS: [ctx] })
      },
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next !== T.DotName
            && next !== T.HashName
            && next !== T.ColorIdentStart;
        },
        ALT: () => $.SUBRULE($.qualifiedRule, { ARGS: [ctx] })
      },
      {
        GATE: () => isVariable,
        ALT: () => $.SUBRULE($.varDeclarationOrCall, { ARGS: [ctx] })
      },
      {
        GATE: () => !isVariable,
        ALT: () => $.SUBRULE($.atRule, { ARGS: [ctx] })
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
      { ALT: () => $.CONSUME2(T.Semi) }
      // { ALT: () => $.SUBRULE($.mixinCall) }
    ];
  };

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;

    const isRoot = !!ctx.isRoot;
    let context: TreeContext;

    if (!RECORDING_PHASE) {
      context = this.context;
    }
    let rules: Node[];

    if (!RECORDING_PHASE) {
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
      GATE: () => !requiredSemi || (requiredSemi && (
        $.LA(1).tokenType === T.Semi
        || $.LA(0).tokenType === T.Semi
      )),
      DEF: () => {
        const localAlt = typeof ruleAlt === 'function' ? ruleAlt(ctx) : ruleAlt;
        let value = $.OR(localAlt);
        if (!RECORDING_PHASE) {
          /** @todo - When do we not have a value? */
          if (value) {
            if (!(value instanceof Node)) {
              /** This is a semi-colon or charset token */
              if (value.image.includes('@charset')) {
                rules.push(new Any(value.image, { role: 'charset' }, $.getLocationInfo(value), context));
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
      }
    });

    if (!RECORDING_PHASE) {
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
  };
}

export function declarationList(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = (ctx: RuleContext = {}) => {
    let isVariable = isVariableLike.call(this, T);
    return [
      {
        ALT: () => {
          return $.SUBRULE($.declaration, { ARGS: [ctx] });
        }
      },
      { ALT: () => $.SUBRULE($.ampersandExtend, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
      {
        GATE: () => isVariable,
        ALT: () => $.SUBRULE($.varDeclarationOrCall, { ARGS: [ctx] })
      },
      {
        GATE: () => !isVariable,
        ALT: () => $.SUBRULE($.innerAtRule, { ARGS: [ctx] })
      },
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next === T.DotName || next === T.HashName || next === T.ColorIdentStart;
        },
        ALT: () => {
          return $.SUBRULE($.mixinOrQualifiedRule, { ARGS: [{ ...ctx, inner: true }] });
        }
      },
      {
        GATE: () => {
          let next = $.LA(1).tokenType;
          return next !== T.DotName
            && next !== T.HashName
            && next !== T.ColorIdentStart;
        },
        ALT: () => {
          return $.SUBRULE($.qualifiedRule, { ARGS: [{ ...ctx, inner: true }] });
        }
      },
      { ALT: () => $.CONSUME2(T.Semi) }
    ];
  };

  return (ctx: RuleContext = {}) => cssMain.call(this, T, ruleAlt)(ctx);
}

// Wrapper to ensure a mixin call in declaration context ends with a semicolon
// export function mixinCallStatement(this: P, T: TokenMap) {
//   const $ = this;
//   return () => {
//     const node = $.SUBRULE($.mixinCall);
//     // If mixinCall did not consume a semicolon, require one now
//     if ($.LA(1).tokenType === T.Semi) {
//       $.CONSUME(T.Semi);
//     }
//     return node;
//   };
// }

let interpolatedRegex = /([$@]){([^}]+)}/g;

const getInterpolated = (name: string, location: LocationInfo, context: TreeContext): Interpolated => {
  const replacements: Node[] = [];
  let result: RegExpExecArray | null;
  let source = name;
  while (result = interpolatedRegex.exec(name)) {
    const [match, propOrVar, value] = result;
    source = source.replace(match, INTERPOLATION_PLACEHOLDER);
    const reference = new Reference({ key: value! }, { type: propOrVar === '$' ? 'property' : 'variable', role: 'ident' });
    replacements.push(reference);
  }
  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
};

export function declaration(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = (ctx: RuleContext = {}) => [
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
        let assign = $.CONSUME(T.Assign);
        let value = $.SUBRULE($.valueList, { ARGS: [ctx] });
        let important: IToken | undefined;

        $.OPTION(() => {
          important = $.CONSUME(T.Important);
        });
        if (!$.RECORDING_PHASE) {
          let nameNode: Node;
          let nameValue = name!.image;
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name!), this.context);
          } else {
            nameNode = $.wrap(new Any(name!.image, { role: 'property' }, $.getLocationInfo(name!), this.context), true);
          }
          return [nameNode, assign, value, important];
        }
      }
    },
    {
      ALT: () => {
        let RECORDING_PHASE = $.RECORDING_PHASE;
        let nodes: Node[];
        if (!RECORDING_PHASE) {
          nodes = [];
        }
        let name = $.OR3([
          { ALT: () => $.CONSUME(T.InterpolatedCustomProperty) },
          { ALT: () => $.CONSUME(T.CustomProperty) }
        ]);
        let assign = $.CONSUME2(T.Assign);
        $.startRule();
        $.MANY(() => {
          let val = $.SUBRULE($.customValue, { ARGS: [{ ...ctx, inCustomPropertyValue: true }] });
          if (!RECORDING_PHASE) {
            nodes!.push(val);
          }
        });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          let nameNode: Node;
          let nameValue = name.image;
          if (nameValue.includes('@') || nameValue.includes('$')) {
            nameNode = getInterpolated(nameValue, $.getLocationInfo(name), this.context);
          } else {
            nameNode = $.wrap(new Any(name.image, { role: 'property' }, $.getLocationInfo(name), this.context), true);
          }
          let value = new Sequence(nodes!, undefined, location, this.context);
          return [nameNode, assign, value];
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => {
    return cssDeclaration.call(this, T, ruleAlt)(ctx);
  };
}

export function mediaInParens(this: P, T: TokenMap) {
  const $ = this;

  let isEscaped = isEscapedString.bind(this, T);

  return (ctx: RuleContext = {}) =>
    $.OR([
      /**
       * It's up to the Less author to validate that this will produce
       * valid media queries.
       */
      {
        /** Allow escaped strings */
        GATE: isEscaped,
        ALT: () => $.SUBRULE($.string, { ARGS: [ctx] })
      },
      /**
       * After Less evaluation, should throw an error
       * if the value of `@myvar` is a ruleset
       */
      {
        ALT: () => {
          return $.SUBRULE($.valueReference, { ARGS: [{ ...ctx, requireAccessorsAfterMixinCall: true }] });
        }
      },
      {
        ALT: cssMediaInParens.call(this, T)
      }
    ]);
}

export function containerInParens(this: P, T: TokenMap, alt?: AltContext) {
  const $ = this;
  // Reuse mediaInParens which already handles variables
  return (ctx: RuleContext = {}) => $.SUBRULE($.mediaInParens, { ARGS: [ctx] });
}

export function mfValue(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) =>
    /**
     * Like the original Less Parser, we're
     * going to allow any value expression,
     * and it's up to the Less author to know
     * if it's valid.
     */
    $.SUBRULE($.expressionSum, { ARGS: [ctx] });
}

export function mfNonIdentifierValue(this: P, T: TokenMap, alt?: AltContext) {
  const $ = this;

  return (ctx: RuleContext = {}) =>
    $.OR([
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
          if (!$.RECORDING_PHASE) {
            let location = $.endRule();
            let num1Node = $.wrap($.processValueToken(num1), 'both');
            if (!num2) {
              return num1Node;
            }
            let num2Node = $.wrap($.processValueToken(num2), 'both');
            return new List([num1Node, num2Node], { sep: '/' }, location, this.context);
          }
        }
      },
      {
        ALT: () => {
          let dim = $.CONSUME(T.Dimension);
          if (!$.RECORDING_PHASE) {
            return $.wrap($.processValueToken(dim), 'both');
          }
        }
      }
    ]);
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
    let RECORDING_PHASE = $.RECORDING_PHASE;

    let selector!: Selector;
    let isSelectorList: boolean | undefined;
    if (!RECORDING_PHASE) {
      selector = ctx.selector as Selector;
      isSelectorList = (ctx.isSelectorList as boolean | undefined) ?? selector instanceof SelectorList;
    }

    let guard: Condition | undefined;
    $.OPTION4({
      GATE: () => !isSelectorList,
      DEF: () => {
        guard = $.SUBRULE2($.guard, { ARGS: [ctx] });
      }
    });
    $.CONSUME2(T.LCurly);
    // Save extendNodes before parsing declarationList, so nested rulesets don't inherit them
    // Make a copy of the array (not just a reference) so mutations during nested parsing don't affect it
    let savedExtendNodes: Extend[] | undefined = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
    ctx.extendNodes = undefined;
    let rules = $.SUBRULE2($.declarationList, { ARGS: [ctx] });
    let end = $.CONSUME2(T.RCurly);
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
    if (!RECORDING_PHASE) {
      let extend = ctx.extendNodes;
      if (extend?.length) {
        /** If it's not a selector list, then our only extend does not need to be grouped */
        if (!isSelectorList) {
          /** For extends inside rulesets (not bubbled), selector should be undefined
           * so it defaults to ampersand and resolves to the ruleset's selector */
          for (let e of extend) {
            e.value.selector = undefined;
          }
          rules.value = [...extend, ...rules.value];
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
              finalExtend.value.selector = undefined;
              rules.value = [finalExtend, ...rules.value];
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
      let node = new Ruleset({ selector, rules, guard }, undefined, undefined, this.context);
      let [startOffset, startLine, startColumn] = selector.location!;
      let { endOffset, endLine, endColumn } = end;
      node._location = [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!];

      return node;
    }
  };
}

export function qualifiedRule(this: P, T: TokenMap, altContext?: AltContext) {
  const $ = this;

  let selectorAlt = altContext ?? ((ctx: RuleContext) => [
    {
      GATE: () => !ctx.inner,
      ALT: () => {
        let initialQualifiedRule = ctx.qualifiedRule;
        ctx.qualifiedRule = true;
        let rule = $.SUBRULE($.selectorList, { ARGS: [ctx] });
        ctx.qualifiedRule = initialQualifiedRule;
        return rule;
      }
    },
    {
      GATE: () => !!ctx.inner,
      ALT: () => {
        let initialQualifiedRule = ctx.qualifiedRule;
        let initialFirstSelector = ctx.firstSelector;
        ctx.firstSelector = true;
        ctx.qualifiedRule = true;
        let rule = $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] });
        ctx.qualifiedRule = initialQualifiedRule;
        ctx.firstSelector = initialFirstSelector;
        return rule;
      }
    }
  ]);
  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  return (ctx: RuleContext = {}) => {
    // Save parent's extendNodes before parsing selector (which may set extendNodes)
    let savedExtendNodes = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
    // Set extendNodes to a fresh empty array upon entry to this qualifiedRule
    // so nested rulesets don't inherit extends from parent rulesets
    ctx.extendNodes = undefined;
    let selector = $.OR(selectorAlt(ctx));
    // Use the same context object so modifications propagate back
    ctx.selector = selector;
    // Now extendNodes may have been set by extend() during selector parsing
    // Save it for this ruleset, then clear it so nested rulesets don't see it
    let thisExtendNodes = ctx.extendNodes ? [...ctx.extendNodes] : undefined;
    ctx.extendNodes = undefined;
    let rule = $.SUBRULE($.qualifiedRuleBody, { ARGS: [ctx] });
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
        if (extendNode.value.selector === undefined || (extendNode.value.selector as any).type === 'Ampersand') {
          extendNode.value.selector = selector;
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

  // Helper function to convert Any nodes to VarDeclaration nodes for mixin definition parameters
  const convertArgsForDefinition = (args: List<Node> | undefined) => {
    if (!args || !args.value) {
      return;
    }

    for (let i = 0; i < args.value.length; i++) {
      const node = args.value[i]!;
      const location = node.location && node.location.length > 0 ? node.location as LocationInfo : undefined;

      // If it's an Any node with role: 'name', convert it to VarDeclaration for mixin definition parameters
      if (node instanceof Any && node.options?.role === 'name') {
        // Reuse the existing Any node but change its role to 'property' for the name
        node.options.role = 'property';
        args.value[i] = new VarDeclaration({
          name: node,
          value: new Nil(undefined, undefined, location, this.context)
        }, { paramVar: true }, location, this.context);
      }
      // Rest nodes with string values can stay as-is for mixin definitions
    }
  };

  // Helper function to convert Any nodes to Reference nodes for mixin call arguments
  const convertArgsForCall = (args: List<Node> | undefined) => {
    if (!args || !args.value) {
      return;
    }

    for (let i = 0; i < args.value.length; i++) {
      const node = args.value[i]!;
      const location = node.location && node.location.length > 0 ? node.location as LocationInfo : undefined;

      // If it's an Any node with role: 'name', convert it to Reference for mixin call arguments
      if (node instanceof Any && node.options?.role === 'name') {
        args.value[i] = new Reference({ key: node.value }, { type: 'variable' }, location, this.context);
      } else if (node instanceof Rest && typeof node.value === 'string') {
        // If it's a Rest node with a string value, convert it to Rest with Reference for mixin call arguments
        args.value[i] = new Rest(new Reference({ key: node.value }, { type: 'variable' }, location, this.context), undefined, location, this.context);
      }
    }
  };

  // qualifiedRule
  //   : selectorList WS* LCURLY declarationList RCURLY
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let selector = $.OR([
      {
        GATE: () => !ctx.inner,
        ALT: () => {
          let initialQualifiedRule = ctx.qualifiedRule;
          ctx.qualifiedRule = true;
          let rule = $.SUBRULE($.selectorList, { ARGS: [ctx] });
          ctx.qualifiedRule = initialQualifiedRule;
          return rule;
        }
      },
      {
        GATE: () => !!ctx.inner,
        ALT: () => {
          let initialQualifiedRule = ctx.qualifiedRule;
          let initialFirstSelector = ctx.firstSelector;
          ctx.firstSelector = true;
          ctx.qualifiedRule = true;
          let rule = $.SUBRULE($.forgivingSelectorList, { ARGS: [ctx] });
          ctx.qualifiedRule = initialQualifiedRule;
          ctx.firstSelector = initialFirstSelector;
          return rule;
        }
      }
    ]);

    let isSelectorList = selector instanceof SelectorList;
    let guard: Condition | undefined;
    let args: List<Node> | undefined;
    let important: IToken | undefined;

    const createMixinCall = (location: LocationInfo) => {
      /** Okay, treat the call as a recursive reference */
      if (RECORDING_PHASE) {
        return;
      }
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
        leftNode = new Reference({ key: selector }, { type: 'mixin-ruleset', role: 'name' }, undefined, this.context);
      } else {
        // For other cases (like SelectorList or when we need nested references),
        // iterate through selector nodes and create nested references
        for (let s of selector.nodes()) {
          if (s instanceof BasicSelector) {
            leftNode = new Reference({ target: leftNode as Reference, key: s.valueOf() }, { type: 'mixin-ruleset', role: 'name' }, undefined, this.context);
          }
        }
      }

      /** Finally, pass this reference into a call */
      leftNode = new Call({ name: leftNode, args }, { markImportant: !!important }, location, this.context);
      return leftNode;
    };

    let isPossibleMixinDefinition = (selector instanceof BasicSelector && (selector.isClass || selector.isId))
      || (selector instanceof InterpolatedSelector && (selector.isClass || selector.isId));
    let isPossibleMixinCall = true;
    if (!isSelectorList && !isPossibleMixinDefinition && !RECORDING_PHASE) {
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
        GATE: () => isPossibleMixinDefinition || isPossibleMixinCall,
        ALT: () => {
          args = $.SUBRULE($.mixinArgs, { ARGS: [ctx] });
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
                  guard = $.SUBRULE($.guard);
                });
                $.CONSUME(T.LCurly);

                let rules = $.SUBRULE($.declarationList, { ARGS: [ctx] });
                $.CONSUME(T.RCurly);
                if (!RECORDING_PHASE) {
                  // Convert Any nodes to VarDeclaration nodes for mixin definition parameters
                  convertArgsForDefinition(args);
                  const node = new Mixin({ name: selector.valueOf(), params: args, rules, guard }, undefined, $.endRule(), this.context);

                  return node;
                }
              }
            },
            {
              GATE: () => isPossibleMixinCall,
              /** Mixin call */
              ALT: () => {
                $.OPTION2(() => {
                  important = $.CONSUME(T.Important);
                });
                let location: LocationInfo;
                if (!RECORDING_PHASE) {
                  location = $.endRule();
                  // Convert Any nodes to Reference nodes for mixin call arguments
                  convertArgsForCall(args);
                }
                let hasParens = false;
                let parensToken: IToken | undefined;
                let result = $.OPTION3({
                  /** in Less legacy mode, mixin calls can happen without a space. */
                  GATE: () => {
                    let noSpace = $.noSep();
                    let next = $.LA(1).tokenType;
                    return (noSpace && next === T.LSquare) || ((noSpace || $.looseMode) && next === T.LParen);
                  },
                  DEF: () => {
                    hasParens = true;
                    return $.SUBRULE($.lookupOrCall, { ARGS: [{ ...ctx, node: createMixinCall(location) }] });
                  }
                });
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
          if (!RECORDING_PHASE) {
            $.endRule();
          }
          let initialSelector = ctx.selector;
          let initialIsSelectorList = ctx.isSelectorList;
          ctx.selector = selector;
          ctx.isSelectorList = isSelectorList;
          let rule = $.SUBRULE($.qualifiedRuleBody, { ARGS: [ctx] });
          ctx.selector = initialSelector;
          ctx.isSelectorList = initialIsSelectorList;
          if (ctx.extendNodes) {
            /** Prepend a rules block */
            let qRule = rule;
            // Set the Extend nodes' selector to the ruleset's selector (not &)
            // This allows the extends to work correctly when evaluated in the wrapper Rules context
            for (const extendNode of ctx.extendNodes) {
              if (extendNode.value.selector === undefined || (extendNode.value.selector as any).type === 'Ampersand') {
                extendNode.value.selector = selector;
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
          $.CONSUME(T.Semi);
          if (!RECORDING_PHASE) {
            $.endRule();
            // Mixin call without parentheses - deprecated
            $.warnDeprecation(
              'Calling a mixin without parentheses is deprecated',
              undefined,
              'mixin-call-no-parens'
            );
          }
        }
      }
    ]);
  };
}

/**
 * We need to now handle a returned `Extend` node from the complexSelector rule
 */
export function relativeSelector(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        ALT: () => {
          let co = $.CONSUME(T.Combinator);
          let node: ComplexSelector | Extend = $.SUBRULE($.complexSelector, { ARGS: [ctx] });

          if (!$.RECORDING_PHASE) {
            let combinator = new Combinator(co.image as Combinators, undefined, $.getLocationInfo(co), this.context);
            let targetNode =
              node instanceof Extend
                ? node.value.selector
                : node;
            if (targetNode instanceof ComplexSelector) {
              targetNode.value.unshift(combinator);
              targetNode._location = $.getLocationFromNodes(targetNode.value);
            } else {
              let nodes = [combinator, targetNode as ComplexSelectorComponent];
              let complex = new ComplexSelector(nodes, undefined, $.getLocationFromNodes(nodes), this.context);
              if (node instanceof Extend) {
                node.value.selector = complex;
                let location = node.location;
                location[0] = co.startOffset;
                location[1] = co.startLine;
                location[2] = co.startColumn;
              } else {
                node = complex;
              }
            }
          }
          return node;
        }
      },
      {
        ALT: () => $.SUBRULE2($.complexSelector, { ARGS: [ctx] })
      }
    ]);
  };
}

export function compoundSelector(this: P, T: TokenMap) {
  const $ = this;
  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let selectors:  SimpleSelector[];
    if (!RECORDING_PHASE) {
      selectors = [];
    }
    let sel = $.SUBRULE($.simpleSelector, { ARGS: [ctx] });
    if (!RECORDING_PHASE) {
      selectors!.push(sel);
    }
    $.MANY({
      /** Make sure we don't ignore space combinators */
      GATE: () => !$.hasWS() && !(ctx.inExtend && $.LA(1).tokenType === T.All),
      DEF: () => {
        let sel = $.SUBRULE2($.simpleSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          /** Make sure we don't add implicit whitespace */
          sel.pre = 0;
          selectors.push(sel);
        }
      }
    });
    if (!RECORDING_PHASE) {
      if (selectors!.length === 1) {
        return selectors![0]!;
      }
      return new CompoundSelector(selectors!, undefined, $.getLocationFromNodes(selectors!), this.context);
    }
  };
}

/**
 * Extended with :extend
 */
export function complexSelector(this: P, T: TokenMap) {
  const $ = this;
  let originalComplexRule = cssComplexSelector.call(
    this,
    T,
    (ctx: RuleContext) => () => !ctx.inExtend || $.LA(1).tokenType !== T.All
  );

  return (ctx: RuleContext = {}) => {
    let selector: Selector = originalComplexRule(ctx)!;
    let isQualifiedRule = !!ctx.qualifiedRule;
    let flag: IToken | undefined;

    $.OR([
      {
        /** When we're inside the :extend(...), we can capture the "all" keyword */
        GATE: () => !!ctx.inExtend,
        ALT: () => flag = $.CONSUME(T.All)
      },
      {
        GATE: () => isQualifiedRule && !ctx.inExtend,
        ALT: () => {
          ctx.selector = selector;
          $.SUBRULE($.extend, { ARGS: [ctx] });
          ctx.selector = undefined;
        }
      },
      {
        ALT: EMPTY_ALT()
      }
    ]);

    if (!$.RECORDING_PHASE && ctx.inExtend) {
      (ctx.extendTargets ??= []).push({ selector: ctx.selector, target: selector, flag });
    }

    return selector;
  };
}

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
    let target = ext.value.target;
    let flag = ext.value.flag ?? 1; // ExtendFlag.Exact = 1
    let selector = ext.value.selector as ComplexSelector | undefined;
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

function mergeExtends(
  selector: Selector | undefined,
  extendTargets: ExtendTarget[],
  location: LocationInfo,
  context: TreeContext,
  flag: IToken | undefined
): Extend | Extend[] {
  let extendNodes: Extend[] | undefined;
  let currentTarget = extendTargets[0]!.target;
  let currentFlag = (extendTargets[0]!.flag ?? flag) ? 0 : 1; // ExtendFlag.All = 0, ExtendFlag.Exact = 1
  let currentNode = new Extend({
    selector,
    target: currentTarget,
    flag: currentFlag
  }, undefined, location, context);
  for (let i = 1; i < extendTargets.length; i++) {
    let ext = extendTargets[i]!;
    let thisFlag = (ext.flag ?? flag) ? 0 : 1;
    /**
     * Merge extends. We do this instead of merging earlier so that
     * selector lists with different flags are not merged.
     */
    if (thisFlag === currentFlag) {
      let target = currentNode.value.target;
      if (!(target instanceof SelectorList)) {
        currentNode.value.target = new SelectorList([target, ext.target], undefined, location, context);
      } else {
        target.value.push(ext.target);
      }
    } else {
      if (!extendNodes || !extendNodes.includes(currentNode)) {
        (extendNodes ??= []).push(currentNode);
      }
      currentFlag = thisFlag;
      currentTarget = ext.target;
      currentNode = new Extend({
        selector,
        target: currentTarget,
        flag: currentFlag
      }, undefined, location, context);
      extendNodes.push(currentNode);
    }
  };
  if (!extendNodes) {
    return currentNode;
  }
  if (extendNodes.length === 1) {
    return extendNodes[0]!;
  }
  return extendNodes;
}

/**
 * &:extend(...) statement ending with a semicolon.
 * This is the only valid standalone extend statement in Less.
 */
export function ampersandExtend(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;

    $.startRule();

    $.CONSUME(T.AmpersandExtend);
    ctx.inExtend = true;
    $.SUBRULE($.selectorList, { ARGS: [ctx] });
    ctx.inExtend = false;
    let extendTargets = ctx.extendTargets!;
    let flag = $.OPTION(() => $.CONSUME(T.AllFlag));
    $.CONSUME(T.RParen);
    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let result = mergeExtends(undefined, extendTargets, location, this.context, flag);
      /** We've converted these extend targets to nodes, so we can reset extend targets */
      ctx.extendTargets = undefined;
      if (ctx.extendNodes) {
        if (isArray(result)) {
          ctx.extendNodes = [...ctx.extendNodes, ...result];
        } else {
          ctx.extendNodes.push(result);
        }
      } else {
        if (isArray(result)) {
          ctx.extendNodes = result;
        } else {
          ctx.extendNodes = [result];
        }
      }
      // Return Nil instead of the extend node - extends are handled via ctx.extendNodes
      // pathway to avoid duplicates (cssMain collects returned nodes into rules.value).
      // Nil is needed because undefined confuses cssMain (treats it as semicolon).
      return new Nil(undefined, undefined, location, this.context);
    }
  };
}

export function extend(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.Extend);

    ctx.inExtend = true;
    let target = $.SUBRULE($.selectorList, { ARGS: [ctx] });
    let extendTargets = ctx.extendTargets;
    ctx.inExtend = false;

    let selector = ctx.selector;
    let flag = $.OPTION(() => $.CONSUME(T.AllFlag));
    $.CONSUME(T.RParen);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      // When .c:extend(...) is parsed, selector is .c
      // The extend will be processed in qualifiedRuleBody where selector: undefined is set
      // for extends that stay inside the ruleset (not bubbled)
      // Bubbled extends keep their selector and get it set correctly in qualifiedRule
      let merged = mergeExtends(selector, extendTargets!, location, this.context, flag);
      /**
       * If we don't have as many extends as we have selectors, we need a way to signal
       * that these should be bumped above the ruleset.
       */
      /** We've converted these extend targets to nodes, so we can reset extend targets */
      ctx.extendTargets = undefined;
      if (ctx.extendNodes) {
        if (isArray(merged)) {
          ctx.extendNodes = [...ctx.extendNodes, ...merged];
        } else {
          ctx.extendNodes.push(merged);
        }
      } else {
        if (isArray(merged)) {
          ctx.extendNodes = merged;
        } else {
          ctx.extendNodes = [merged];
        }
      }
    }
  };
}

export function simpleSelector(this: P, T: TokenMap) {
  const $ = this;

  let selectorAlt = (ctx: RuleContext): IOrAlt<any>[] => [
    {
      GATE: () => !ctx.inExtend || $.LA(1).tokenType !== T.All,
      /**
       * In Less/Sass (and now CSS), the first inner selector can be an identifier
       */
      ALT: () => $.CONSUME(T.Ident)
    },
    {
      /**
       * Unlike CSS Nesting, Less allows outer qualified rules
       * to have `&`, and it is just silently absorbed if there
       * is no parent selector.
       */
      ALT: () => {
        let amp = $.CONSUME(T.Ampersand);
        if (!$.RECORDING_PHASE) {
          let ampImg = amp.image;
          let value = ampImg.slice(1);
          return new Ampersand(value || undefined, undefined, $.getLocationInfo(amp), this.context);
        }
      }
    },
    { ALT: () => $.CONSUME(T.InterpolatedSelector) },
    { ALT: () => $.SUBRULE($.classSelector) },
    { ALT: () => $.SUBRULE($.idSelector) },
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => {
      let initialIsQualifiedRule = ctx.qualifiedRule;
      ctx.qualifiedRule = false;
      /** Make sure we prevent things like :extend() inside pseudo-selectors */
      let pseudo = $.SUBRULE($.pseudoSelector, { ARGS: [ctx] });
      ctx.qualifiedRule = initialIsQualifiedRule;
      return pseudo;
    } },
    { ALT: () => $.SUBRULE($.attributeSelector) },
    /** Supports keyframes selectors */
    { ALT: () => $.CONSUME(T.DimensionInt) },
    { ALT: () => $.CONSUME(T.DimensionNum) }
  ];

  return (ctx: RuleContext = {}) => {
    let selector = $.OR(selectorAlt(ctx));

    if (!$.RECORDING_PHASE) {
      if ($.isToken(selector)) {
        if (selector.tokenType.name === 'Ampersand') {
          let ampImg = selector.image;
          let value = ampImg.slice(1);
          return new Ampersand(value || undefined, undefined, $.getLocationInfo(selector), this.context);
        }
        if (selector.tokenType.name === 'InterpolatedSelector') {
          // Create an InterpolatedSelector wrapper for interpolated selectors
          let nameValue = selector.image;
          let interpolatedNode = getInterpolated(nameValue, $.getLocationInfo(selector), this.context);

          return new InterpolatedSelector(interpolatedNode, undefined, $.getLocationInfo(selector), this.context);
        }
        return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), this.context);
      }
      return selector as Node;
    }
  };
}

export function anonymousMixinDefinition(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let params: List | undefined;
    let anonToken: IToken | undefined;
    $.OPTION(() => {
      anonToken = $.CONSUME(T.AnonMixinStart);
      params = $.SUBRULE($.mixinArgList, { ARGS: [{ ...ctx, isDefinition: true }] });
      $.CONSUME(T.RParen);
    });
    let rules = $.SUBRULE($.wrappedDeclarationList, { ARGS: [ctx] });

    if (!$.RECORDING_PHASE) {
      // Set rulesVisibility for detached rulesets based on leakyRules
      // Less, for whatever reason, has slightly different lookup rules for
      // "detached rulesets".

      // Parse as Anonymous mixin
      if (!rules.options.rulesVisibility) {
        rules.options.rulesVisibility = {};
      }
      if (this.leakyRules) {
        rules.options.rulesVisibility.Mixin = 'public';
        rules.options.rulesVisibility.VarDeclaration = 'private';
      } else {
        rules.options.rulesVisibility.Mixin = 'private';
        rules.options.rulesVisibility.VarDeclaration = 'private';
      }

      if (!anonToken) {
        /** To Less, this is a "detached ruleset" */
        // Check if this should be parsed as Collection or Rules
        const shouldBeCollection = (() => {
          let properties: Declaration[] = [];
          for (const node of rules.value) {
            if (node.type === 'Declaration') {
              properties.push(node);
            } else if (node.type === 'Comment' || node.type === 'VarDeclaration') {
              continue;
            } else {
              /** Not a valid collection, parse as anonymous mixin */
              return false;
            }
          }

          if (properties.length === 0) {
            /** If just var declarations and/or comments, parse as collection */
            return true;
          }

          const validPropertyCount = properties.filter((decl) => {
            const name = decl.value.name;
            const propName = typeof name === 'string' ? name : name.valueOf();
            // Skip custom properties (--*)
            if (propName.startsWith('--')) {
              return true; // Custom properties are always valid
            }
            return all.includes(propName);
          }).length;

          // Majority means more than 50%
          const majorityValid = validPropertyCount > properties.length / 2;
          /** If this looks like mostly CSS properties, parse as mixin instead */
          return !majorityValid;
        })();

        if (shouldBeCollection) {
          return new Collection(rules.value, rules.options, $.endRule(), this.context);
        }
      }

      // If anonToken exists, it's an anonymous mixin with (optional) parameters, return as Mixin
      return new Mixin({ params, rules }, undefined, $.endRule(), this.context);
    }
  };
}

/**
 * Mostly copied from css importAtRule, but it maps
 * differently to Jess nodes depending on if it's meant
 * to be a Jess-style import or just an at-rule
 */
export function importAtRule(this: P, T: TokenMap) {
  const $ = this;

  const isCssUrl = (url: string) =>
    url.endsWith('.css') || url.startsWith('http') || url.startsWith('//');

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let name = $.CONSUME(T.AtImport);

    let options: string[];

    if (!RECORDING_PHASE) {
      options = [];
    }

    $.OPTION(() => {
      $.CONSUME(T.LParen);
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          let opt = $.CONSUME(T.PlainIdent);
          if (!RECORDING_PHASE) {
            options!.push(opt.image);
          }
        }
      });
      $.CONSUME(T.RParen);
    });

    let urlNode: Quoted | Url = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);

    let isAtRule: boolean | undefined;

    if (!RECORDING_PHASE) {
      if (options!.includes('css')) {
        isAtRule = true;
      } else {
        let url = urlNode.valueOf();
        if (isCssUrl(url)) {
          isAtRule = true;
        }
      }
    }

    let preludeNodes: Node[];

    if (!RECORDING_PHASE) {
      preludeNodes = [$.wrap(urlNode)];
    }

    let extraNodes: Node[] | undefined;
    $.OPTION2(() => {
      extraNodes = $.SUBRULE($.importPostlude) as Node[];
    });
    if (!RECORDING_PHASE && extraNodes && extraNodes.length) {
      isAtRule = true;
      for (const n of extraNodes) {
        preludeNodes!.push(n);
      }
    }

    $.CONSUME(T.Semi);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (isAtRule) {
        const prelude = new Sequence(preludeNodes!, undefined, $.getLocationFromNodes(preludeNodes!), this.context);
        const atRule = new AtRule({
          name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), this.context), true),
          prelude: prelude
        }, undefined, location, this.context);
        return atRule;
      }

      return new StyleImport({
        path: urlNode
      }, {
        type: 'import',
        importOptions: {
          reference: options!.includes('reference'),
          once: !options!.includes('multiple')
        }
      }, location, this.context);
    }
  };
}

/** Less variables */
export function varDeclarationOrCall(this: P, T: TokenMap) {
  const $ = this;

  /**
   * Less doesn't allow variable variables anymore? It used to. Not sure
   * when that changed.
   */
  // let nameAlt = [
  //   { ALT: () => $.SUBRULE($.varName) },
  //   { ALT: () => $.CONSUME(T.NestedReference) }
  // ];

  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.SUBRULE($.varName, { ARGS: [ctx] });
    let value: Node | undefined;
    let args: List | undefined;
    let important: IToken | undefined;

    $.OR([
      {
        /**
         * This is a variable declaration
         * Disallows `@atrule :foo;` because it resembles a pseudo-selector
         */
        ALT: () => {
          $.CONSUME(T.Colon);
          return $.OR2([
            /**
             * This needs to be gated early, even though it is
             * gated again in the valueList production, because
             * chevrotain-allstar needs to pick a path first.
             */
            {
              GATE: () => {
                let type = $.LA(1).tokenType;
                return type === T.AnonMixinStart || type === T.LCurly;
              },
              ALT: () => {
                value = $.SUBRULE($.anonymousMixinDefinition, { ARGS: [ctx] });
                $.OPTION2(() => $.CONSUME2(T.Semi));
                return value;
              }
            },
            {
              GATE: () => {
                let type = $.LA(1).tokenType;
                return type !== T.AnonMixinStart && type !== T.LCurly;
              },
              ALT: () => {
                value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, allowMixinCallWithoutAccessor: true }] });
                $.OPTION(() => {
                  important = $.CONSUME(T.Important);
                });
                return value;
              }
            }
          ]);
        }
      },
      /** This is a variable call */
      {
        GATE: () => $.noSep() && $.LA(1).tokenType === T.LParen,
        /**
         * This is a change from Less 1.x-4.x
         * e.g.
         * ```
         * @dr: #(@var1, @var2) {
         *   // ...
         * }
         * @dr(arg1, arg2);
         */
        ALT: () => {
          args = $.SUBRULE($.mixinArgs, { ARGS: [ctx] });
          return args;
        }
      }
    ]);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let nameVal = getInterpolatedOrString(name!.image);
      let nameNode: Node;
      if (!(nameVal instanceof Interpolated)) {
        nameNode = new Any(nameVal, { role: 'ident' }, $.getLocationInfo(name!), this.context);
      } else {
        nameNode = nameVal;
      }

      /** An anonymous mixin call */
      if (!value) {
        // When @variable() is called, look up the variable first
        // The variable's value (which may be a Call node) will be executed
        const nameRef = nameNode instanceof Interpolated
          ? new Reference({ key: nameNode }, { type: 'variable', role: 'name' })
          : new Reference({ key: nameNode as any }, { type: 'variable', role: 'name' });
        // Pass markImportant in options if !important is present
        const callOptions = important ? { markImportant: true } : undefined;
        const callNode = new Call({ name: new Expression(nameRef), args: args! }, callOptions, location, this.context);
        // Clear important since it's now on the Call
        if (important) {
          important = undefined;
        }
        return callNode;
      }

      // If the value is a Call node and we have !important, set markImportant on the Call
      // instead of on the VarDeclaration (mixin call semantics)
      if (important && value instanceof Call) {
        value.options = value.options || {};
        value.options.markImportant = true;
        important = undefined;
      }

      return new VarDeclaration({
        name: $.wrap(nameNode, true) as any,
        value: $.wrap(value, true),
        important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), this.context), true) : undefined
      }, undefined, location, this.context);
    }
  };
}

export function valueSequence(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[];

    if (!RECORDING_PHASE) {
      nodes = [];
    }

    $.OR([
      {
        GATE: () => $.looseMode,
        ALT: () => {
          $.MANY(() => {
            let value = $.SUBRULE($.expressionSum, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes.push(value);
            }
          });
        }
      },
      {
        GATE: () => !$.looseMode,
        /** @todo - create warning if there isn't a value */
        ALT: () => {
          $.AT_LEAST_ONE(() => {
            let value = $.SUBRULE2($.expressionSum, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              nodes.push(value);
            }
          });
        }
      }
    ]);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (nodes!.length === 1) {
        const single = nodes![0]!;

        return single;
      }
      const seq = new Sequence(nodes!, undefined, location, this.context);

      return seq;
    }
  };
}

export function squareValue(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.CONSUME(T.LSquare);
    let node: Node = $.OR([
      {
        GATE: () => !$.looseMode,
        ALT: () => {
          let ident = $.CONSUME(T.Ident);
          if (!RECORDING_PHASE) {
            return new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), this.context);
          }
        }
      },
      {
        GATE: () => !!$.looseMode,
        ALT: () => {
          let nodes: Node[];
          if (!RECORDING_PHASE) {
            nodes = [];
          }
          $.MANY(() => {
            let node = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
            if (!RECORDING_PHASE) {
              const wrapped = $.wrap(node);
              nodes.push(wrapped);
            }
          });
          if (!RECORDING_PHASE) {
            const seq = new Sequence(nodes!, undefined, $.getLocationFromNodes(nodes!), this.context);

            return seq;
          }
        }
      }
    ]);
    $.CONSUME(T.RSquare);
    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      const blk = new Block(node, { type: 'square' }, location, this.context);
      return blk;
    }
  };
}

/**
 * In CSS, would be a single value.
 * In Less, these are math expressions which
 * represent a single value. During AST construction,
 * these will be grouped by order of operations.
 */
export function expressionSum(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.expressionProduct, { ARGS: [ctx] });

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
          nextType === T.Plus
          || nextType === T.Minus
          || ($.noSep() && tokenMatcher(next, T.Signed))
        );
      },
      DEF: () => {
        let op: string | undefined;
        let signed: IToken | undefined;
        let right: Node;

        $.OR([
          {
            ALT: () => {
              let opToken = $.OR2([
                { ALT: () => $.CONSUME(T.Plus) },
                { ALT: () => $.CONSUME(T.Minus) }
              ]);
              if (!RECORDING_PHASE) {
                op = opToken.image;
              }
              right = $.SUBRULE2($.expressionProduct, { ARGS: [ctx] });
            }
          },
          /** This will be interpreted by Less as a complete expression */
          {
            ALT: () => {
              // Consume a signed literal and convert it without rewinding
              const tok = $.CONSUME(T.Signed);
              if (!RECORDING_PHASE) {
                const str = tok.image;
                op = str[0];
                // Build a literal node from the signed token directly
                // Prefer dimension if payload exists, else number, else ident fallback
                if (tok.payload && tok.payload[1]) {
                  const dim = { number: parseFloat(tok.payload[0]), unit: tok.payload[1] };
                  right = new Dimension(dim, undefined, $.getLocationInfo(tok), this.context);
                } else {
                  const num = parseFloat(str);
                  if (!Number.isNaN(num)) {
                    right = new Num(num, undefined, $.getLocationInfo(tok), this.context);
                  } else {
                    right = $.processValueToken(tok);
                  }
                }
              }
            }
          }
        ]);

        if (!RECORDING_PHASE) {
          const operation = new Operation(
            [$.wrap(left, true), op as Operator, $.wrap(right!)],
            undefined,
            $.getLocationFromNodes([left, right!]),
            this.context
          );
          left = operation;

          return left;
        }
      }
    });

    if (!RECORDING_PHASE) {
      $.endRule();

      return left;
    }
  };
}

export function expressionProduct(this: P, T: TokenMap) {
  const $ = this;

  let opAlt = [
    { ALT: () => $.CONSUME(T.Star) },
    { ALT: () => $.CONSUME(T.Slash) },
    { ALT: () => $.CONSUME(T.Percent) }
  ];

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.expressionValue, { ARGS: [ctx] });

    $.MANY(() => {
      let op = $.OR(opAlt);
      // Check for deprecated ./ operator
      if (!RECORDING_PHASE && op.image === './') {
        $.warnDeprecation(
          './ operator is deprecated',
          op,
          'dot-slash-operator'
        );
      }
      let right: Node = $.SUBRULE2($.expressionValue, { ARGS: [ctx] });

      if (!RECORDING_PHASE) {
        const operation = new Operation(
          [$.wrap(left, true), op.image as Operator, $.wrap(right)],
          undefined,
          $.getLocationFromNodes([left, right]),
          this.context
        );
        left = operation;
      }
    });

    if (!RECORDING_PHASE) {
      $.endRule();

      return left;
    }
  };
}

export function expressionValue(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
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
          let node = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, inner: true }] });
          $.CONSUME(T.RParen);

          if (!RECORDING_PHASE) {
            let location = $.endRule();
            node = $.wrap(node, 'both');
            return new Paren(node, { escaped: !!escape }, location, this.context);
          }
        }
      },
      { ALT: () => $.SUBRULE($.value, { ARGS: [ctx] }) }
    ]);
    if (!RECORDING_PHASE) {
      let location = $.endRule();
      if (minus) {
        return new Negative(node, undefined, location, this.context);
      }
      return node;
    }
  };
}

/**
 * Add interpolation
 */
export function nthValue(this: P, T: TokenMap) {
  const $ = this;

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

  return cssNthValue.call(this, T, nthValueAlt);
}

export function knownFunctions(this: P, T: TokenMap) {
  const $ = this;

  let functions = (ctx: RuleContext = {}) => [
    { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.varFunction, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.calcFunction, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.ifFunction, { ARGS: [ctx] }) },
    { ALT: () => $.SUBRULE($.booleanFunction, { ARGS: [ctx] }) }
  ];

  return cssKnownFunctions.call(this, T, functions);
}

export function ifFunction(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let name = $.CONSUME(T.IfFunction);

    $.startRule();

    let node: Node = $.SUBRULE($.guardInner, { ARGS: [{ ...ctx, inValueList: true }] });
    let args: Node[];

    if (!RECORDING_PHASE) {
      args = [node];
    }

    $.OR([
      {
        ALT: () => {
          $.CONSUME(T.Semi);
          node = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
          if (!RECORDING_PHASE) {
            args.push(node);
          }
          $.OPTION(() => {
            $.CONSUME2(T.Semi);
            node = $.SUBRULE2($.valueList, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
            if (!RECORDING_PHASE) {
              args.push(node);
            }
          });
        }
      },
      {
        ALT: () => {
          $.CONSUME(T.Comma);
          node = $.SUBRULE($.valueSequence, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
          if (!RECORDING_PHASE) {
            args.push(node);
          }
          $.OPTION2(() => {
            $.CONSUME2(T.Comma);
            node = $.SUBRULE2($.valueSequence, { ARGS: [{ ...ctx, allowAnonymousMixins: true }] });
            if (!RECORDING_PHASE) {
              args.push(node);
            }
          });
        }
      }
    ]);
    let argsLocation: LocationInfo | undefined;
    if (!RECORDING_PHASE) {
      argsLocation = $.endRule();
    }

    $.CONSUME(T.RParen);

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let nameNode = new Reference('if', { type: 'function', fallbackValue: true }, $.getLocationInfo(name), this.context);
      return new Call({ name: nameNode, args: new List(args!, undefined, argsLocation, this.context) }, undefined, location, this.context);
    }
  };
}

export function booleanFunction(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let name = $.CONSUME(T.BooleanFunction);
    let arg: Condition = $.SUBRULE($.guardOr, { ARGS: [{ ...ctx, inValueList: true }] });
    $.CONSUME(T.RParen);

    if (!$.RECORDING_PHASE) {
      let location = $.endRule();
      let nameNode = new Reference('boolean', { type: 'function', fallbackValue: true }, $.getLocationInfo(name), this.context);
      return new Call({ name: nameNode, args: new List([arg], undefined, arg.location as LocationInfo, this.context) }, undefined, location, this.context);
    }
  };
}

/** At AST time, join comma-lists together if separated by semis */
// $.RULE('functionValueList', (ctx: RuleContext = {}) => {
//   ctx.allowAnonymousMixins = true
//   $.SUBRULE($.valueSequence, { ARGS: [ctx] })
//   $.MANY(() => {
//     $.OR([
//       { ALT: () => $.CONSUME(T.Comma) },
//       { ALT: () => $.CONSUME(T.Semi) }
//     ])
//     $.SUBRULE2($.valueSequence, { ARGS: [ctx] })
//   })
// })

export function varReference(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node | undefined = $.OR([
      {
        ALT: () => {
          let token = $.CONSUME(T.PropertyReference);
          if (!RECORDING_PHASE) {
            // Warn about $ident in custom property values - it's treated as literal text, not a property reference
            if (ctx.inCustomPropertyValue) {
              $.warnDeprecation(
                '$[ident] in custom property values is treated as literal text, not a property reference. Use ${[ident]} if you want it to be evaluated.',
                token,
                'property-in-unknown-value'
              );
            }
            return new Reference(token.image.slice(1), { type: 'property' }, $.getLocationInfo(token), this.context);
          }
        }
      },
      {
        ALT: () => {
          let token = $.CONSUME(T.NestedReference);
          if (!RECORDING_PHASE) {
            const raw = token.image;
            const type: 'variable' | 'property' = raw.startsWith('@') ? 'variable' : 'property';
            const key = getInterpolatedOrString(raw);
            if (typeof key === 'string') {
              return new Reference(key, { type }, $.getLocationInfo(token), this.context);
            }
            return new Reference({ key }, { type }, $.getLocationInfo(token), this.context);
          }
        }
      },
      {
        ALT: () => {
          let token = $.SUBRULE($.varName, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            // Warn about @ident in custom property values - it's treated as literal text, not a variable reference
            if (ctx.inCustomPropertyValue) {
              $.warnDeprecation(
                '@[ident] in custom property values is treated as literal text, not a variable reference. Use @{[ident]} if you want it to be evaluated.',
                token,
                'variable-in-unknown-value'
              );
            }
            return new Reference(token.image.slice(1), { type: 'variable' }, $.getLocationInfo(token), this.context);
          }
        }
      }
    ]);
    $.OR2([
      {
        ALT: () => {
          /** This spreads a (list) value within a containing list when evaluated */
          let token = $.CONSUME(T.Ellipsis);
          if (!RECORDING_PHASE) {
            node = new Rest(node, undefined, $.getLocationFromNodes([node!, token]), this.context);
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
              node = $.SUBRULE(
                $.lookupOrCall,
                { ARGS: [{ ...ctx, node: node! }] }
              );
            }
          });
          $.OPTION(() => {
            $.OPTION2(() => $.CONSUME(T.Gt));
            node = $.SUBRULE($.mixinReference, { ARGS: [{ ...ctx, node: node! }] });
          });
        }
      },
      { ALT: EMPTY_ALT() }
    ]);

    if (!RECORDING_PHASE) {
      return $.wrap(node!);
    }
  };
}

export function valueReference(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.mixinReference, { ARGS: [ctx] }) }
    ]);
  };
}

export function functionCall(this: P, T: TokenMap) {
  const $ = this;

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
        let args: List | undefined;
        $.OPTION(() => args = $.SUBRULE($.functionCallArgs, { ARGS: [ctx] }));
        $.CONSUME(T.RParen);
        if (!$.RECORDING_PHASE) {
          const location = $.endRule();
          const nameValue = fnStart.image.slice(0, -1);
          const nameNode = new Reference(nameValue, { type: 'function', fallbackValue: true }, $.getLocationInfo(fnStart), this.context);
          /** Less / Sass functions we try to call that throw just get turned into calls. */
          return new Call({ name: nameNode, args }, { silentFail: true }, location, this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(funcAlt(ctx));
}

export function functionCallArgs(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    // Inside function arguments, allow inner tokens like ':'
    const prevInner = ctx.inner;
    ctx.inner = true;
    let node = $.SUBRULE($.callArgument, { ARGS: [ctx] });

    let commaNodes: Node[];
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }
    let isSemiList = false;

    // First, consume any comma-separated arguments
    $.MANY(() => {
      $.CONSUME(T.Comma);
      node = $.SUBRULE2($.callArgument, { ARGS: [ctx] });
      if (!RECORDING_PHASE) {
        commaNodes!.push($.wrap(node, true));
      }
    });

    // Then, optionally switch to semicolon-separated list and continue with semicolons
    $.OPTION(() => {
      isSemiList = true;

      $.CONSUME(T.Semi);

      if (!RECORDING_PHASE) {
        // Aggregate the previous set of comma-nodes as the first semi item
        if (commaNodes.length > 1) {
          semiNodes.push(new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context));
        } else {
          semiNodes.push(commaNodes[0]!);
        }
      }

      node = $.SUBRULE3($.callArgument, { ARGS: [{ ...ctx, allowComma: true }] });
      if (!RECORDING_PHASE) {
        semiNodes.push($.wrap(node, true));
      }

      $.MANY2(() => {
        $.CONSUME2(T.Semi);
        node = $.SUBRULE4($.callArgument, { ARGS: [{ ...ctx, allowComma: true }] });
        if (!RECORDING_PHASE) {
          semiNodes.push($.wrap(node, true));
        }
      });
    });

    if (!RECORDING_PHASE) {
      ctx.inner = prevInner;
      let location = $.endRule();
      let nodes = isSemiList ? semiNodes! : commaNodes!;
      let sep: ';' | ',' = isSemiList ? ';' : ',';
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both');
    }
  };
}

export function value(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
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
      { ALT: () => $.SUBRULE($.functionCall, { ARGS: [ctx] }) },
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
        ALT: () => $.CONSUME(T.Ident)
      },
      { ALT: () => $.SUBRULE($.varReference, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.DefaultGuardFunc) },
      { ALT: () => $.CONSUME(T.Dimension) },
      { ALT: () => $.CONSUME(T.Number) },
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

  let stringAlt = [
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.SingleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION(() => contents = $.CONSUME(T.SingleQuoteStringContents));
        $.CONSUME(T.SingleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let quoteImg = quote.image;
          let escaped = false;
          if (quoteImg.startsWith('~')) {
            escaped = true;
            quoteImg = quoteImg.slice(1);
          }
          let location = $.endRule();
          let value = contents?.image;

          // Handle interpolation in string contents
          if (value && (value.includes('@{') || value.includes('${'))) {
            return new Quoted(processStringInterpolation(value, location, this.context), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
          }

          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
        }
      }
    },
    {
      ALT: () => {
        $.startRule();
        let quote = $.CONSUME(T.DoubleQuoteStart);
        let contents: IToken | undefined;
        $.OPTION2(() => contents = $.CONSUME(T.DoubleQuoteStringContents));
        $.CONSUME(T.DoubleQuoteEnd);
        if (!$.RECORDING_PHASE) {
          let quoteImg = quote.image;
          let escaped = false;
          if (quoteImg.startsWith('~')) {
            escaped = true;
            quoteImg = quoteImg.slice(1);
          }
          let location = $.endRule();
          let value = contents?.image;

          // Handle interpolation in string contents
          if (value && (value.includes('@{') || value.includes('${'))) {
            return new Quoted(processStringInterpolation(value, location, this.context), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
          }

          return new Quoted(new Any(value ?? '', { role: 'any' }), { quote: quoteImg as '"' | '\'', escaped }, location, this.context);
        }
      }
    }
  ];

  return (ctx: RuleContext = {}) => $.OR(stringAlt);
}

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

    const type = match.prefix === '@' ? 'variable' : 'property';

    // Recursively process the content in case it has nested interpolation
    const innerResult = processStringInterpolation(match.content, location, context);
    if (innerResult instanceof Interpolated) {
      // The content itself has interpolation - create an Interpolated reference
      replacements.push(new Reference({ key: innerResult }, { type, role: 'ident' }, location, context));
    } else {
      // Simple variable reference
      replacements.push(new Reference(match.content, { type, role: 'ident' }, location, context));
    }
  }

  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
}

export function mathValue(this: P, T: TokenMap) {
  const $ = this;

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
      ALT: () => $.SUBRULE($.string, { ARGS: [ctx] })
    },
    {
      /** For some reason, e() goes here instead of $.function */
      GATE: () => $.LA(2).tokenType !== T.LParen,
      ALT: () => $.CONSUME(T.MathConstant)
    },
    { ALT: () => $.SUBRULE($.mathParen, { ARGS: [ctx] }) }
  ];

  return cssMathValue.call(this, T, valueAlt);
}

/** @todo - add interpolation */
// $.OVERRIDE_RULE('string', () => {
//   $.OR([
//     {
//       ALT: () => {
//         $.CONSUME(T.SingleQuoteStart)
//         $.OPTION(() => $.CONSUME(T.SingleQuoteStringContents))
//         $.CONSUME(T.SingleQuoteEnd)
//       }
//     },
//     {
//       ALT: () => {
//         $.CONSUME(T.DoubleQuoteStart)
//         $.OPTION2(() => $.CONSUME(T.DoubleQuoteStringContents))
//         $.CONSUME(T.DoubleQuoteEnd)
//       }
//     }
//   ])
// })

export function guard(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    $.CONSUME(T.When);
    return $.OR2([
      {
        GATE: () => !!ctx.inValueList,
        ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] })
      },
      {
        ALT: () => {
          ctx.allowComma = true;
          const node = $.SUBRULE($.guardOr, { ARGS: [ctx] });
          if (!$.RECORDING_PHASE) {

          }
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
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let left = $.SUBRULE($.guardAnd, { ARGS: [ctx] });
    let right: Node | undefined;
    $.MANY({
      GATE: () => {
        const next = $.LA(1).tokenType;
        return (ctx.allowComma && next === T.Comma) || next === T.Or;
      },
      DEF: () => {
        /**
               * Nest expressions within expressions for correct
               * order of operations.
               */
        $.OR3([
          { ALT: () => $.CONSUME(T.Comma) },
          { ALT: () => $.CONSUME(T.Or) }
        ]);
        right = $.SUBRULE2($.guardAnd, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          let location = $.endRule();
          $.startRule();
          left = new Condition(
            [$.wrap(left, true), 'or', $.wrap(right!)],
            undefined,
            location,
            this.context
          );
        }
      }
    });
    if (!RECORDING_PHASE) {
      $.endRule();
    }
    return left;
  };
}

export function guardDefault(this: P, T: TokenMap) {
  const $ = this;

  let guardAlt = [
    { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
    { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
  ];

  return (ctx: RuleContext = {}) => {
    let guard = $.OR(guardAlt);
    ctx.hasDefault = true;
    if (!$.RECORDING_PHASE) {
      return new DefaultGuard(guard.image, undefined, $.getLocationInfo(guard), this.context);
    }
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
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.MANY_SEP({
      SEP: T.And,
      DEF: () => {
        let not: IToken | undefined;
        $.OPTION(() => not = $.CONSUME(T.Not));
        let allowComma = ctx.allowComma;
        ctx.allowComma = false;
        let right = $.SUBRULE($.guardInParens, { ARGS: [ctx] });
        ctx.allowComma = allowComma;
        if (!RECORDING_PHASE && not) {
          let [,,, endOffset, endLine, endColumn] = right.location!;
          let [startOffset, startLine, startColumn] = $.getLocationInfo(not);
          right = new Condition(
            right,
            { negate: true },
            [startOffset, startLine, startColumn, endOffset, endLine, endColumn],
            this.context
          );
        }
        if (!left) {
          left = right;
          return;
        }
        if (!RECORDING_PHASE) {
          left = new Condition(
            [$.wrap(left, true), 'and', $.wrap(right)],
            undefined,
            $.getLocationFromNodes([left, right]),
            this.context
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

    if (!$.RECORDING_PHASE) {
      node = $.wrap(node, 'both');
      return new Paren(node, undefined, $.endRule(), this.context);
    }
  };
}

// The inner content of a guard inside parentheses
export function guardInner(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) =>
    $.OR([
      { ALT: () => $.SUBRULE($.comparison, { ARGS: [ctx] }) },
      {
        GATE: () => {
          let tokenType = $.LA(1).tokenType;
          return tokenType !== T.Not
            && tokenType !== T.DefaultGuardFunc
            && tokenType !== T.DefaultGuardIdent;
        },
        ALT: () => $.SUBRULE($.value, { ARGS: [ctx] })
      },
      {
        ALT: () => $.SUBRULE($.guardOr, { ARGS: [ctx] })
      }
    ]);
}

export function guardWithConditionValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => $.OR([
    {
      ALT: () => {
        $.OR2([
          { ALT: () => $.CONSUME(T.DefaultGuardIdent) },
          { ALT: () => $.CONSUME(T.DefaultGuardFunc) }
        ]);
      }
    },
    { ALT: () => $.SUBRULE($.guardInParens, { ARGS: [ctx] }) }
  ]);
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

  let opAlt = [
    { ALT: () => $.CONSUME(T.Eq) },
    { ALT: () => $.CONSUME(T.Gt) },
    { ALT: () => $.CONSUME(T.GtEq) },
    { ALT: () => $.CONSUME(T.GtEqAlias) },
    { ALT: () => $.CONSUME(T.Lt) },
    { ALT: () => $.CONSUME(T.LtEq) },
    { ALT: () => $.CONSUME(T.LtEqAlias) }
  ];

  return (ctx: RuleContext = {}) => {
    let left = $.SUBRULE($.valueList, { ARGS: [ctx] });
    // $.OPTION(() => {
    let op = $.OR(opAlt);
    let right = $.SUBRULE2($.valueList, { ARGS: [ctx] });
    if (!$.RECORDING_PHASE) {
      let opStr = op.image;
      if (opStr === '=>') {
        opStr = '>=';
      } else if (opStr === '=<') {
        opStr = '<=';
      }
      left = new Condition(
        [$.wrap(left, true), opStr as ConditionOperator, $.wrap(right)],
        undefined,
        $.getLocationFromNodes([left, right]),
        this.context
      );
    }
    // })
    return left;
  };
}

/**
 * Less (perhaps unwisely) allows bubling of normally document-root
 * at-rules, so we need to override CSS here.
 */
export function innerAtRule(this: P, T: TokenMap) {
  const $ = this;

  let ruleAlt = (ctx: RuleContext = {}) => [
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
  ];

  return cssInnerAtRule.call(this, T, ruleAlt);
}

/**
 * Less override: allow variable reference as the first segment of a layer-name
 * CSS: <ident> ('.' <ident>)*
 * Less: (<var-ref> | <ident>) ('.' <ident>)*
 */
export function layerName(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    const nodes: Node[] = RECORDING_PHASE ? ([] as unknown as Node[]) : [];

    // First segment: variable reference or plain ident
    const first = $.OR([
      { ALT: () => $.SUBRULE($.valueReference, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.Ident) }
    ]);

    if (!RECORDING_PHASE) {
      if (first instanceof Node) {
        nodes.push($.wrap(first));
      } else {
        nodes.push($.wrap($.processValueToken(first)));
      }
    }

    // Remaining segments: dot + ident (same as CSS)
    $.MANY({
      GATE: $.noSep,
      DEF: () => {
        const seg = $.CONSUME(T.DotName);
        if (!RECORDING_PHASE) {
          nodes.push($.wrap($.processValueToken(seg)));
        }
      }
    });

    if (!RECORDING_PHASE) {
      const loc = $.endRule();
      return new Sequence(nodes, undefined, loc, this.context);
    }
  };
}

/**
 * Less override: allow variable reference for @keyframes name
 * CSS: Ident | String
 * Less: valueReference | Ident | String
 */
// Less override: allow variable reference in keyframes name by overriding keyframesName only
export function keyframesName(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    let node: Node | undefined;
    $.OR({
      DEF: [
        { ALT: () => node = $.SUBRULE($.valueReference, { ARGS: [ctx] }) },
        { ALT: () => {
          const tok = $.CONSUME(T.Ident);
          if (!RECORDING_PHASE) {
            node = $.wrap($.processValueToken(tok));
          }
        } },
        { ALT: () => node = $.SUBRULE($.string) }
      ]
    });
    return node!;
  };
}

/**
 * One of the rare rules that returns a token, because
 * other rules will transform it differently.
 */
export function mixinName(this: P, T: TokenMap) {
  const $ = this;

  let nameAlt = [
    { ALT: () => $.CONSUME(T.HashName) },
    { ALT: () => $.CONSUME(T.ColorIdentStart) },
    { ALT: () => $.CONSUME(T.DotName) },
    { ALT: () => $.CONSUME(T.InterpolatedIdent) },
    { ALT: () => $.CONSUME(T.InterpolatedSelector) }
  ];

  /** e.g. .mixin, #mixin */
  return (ctx: RuleContext = {}) => {
    let name = $.OR(nameAlt);
    if (!$.RECORDING_PHASE) {
      const asReference = ctx.asReference;
      let nameNode: Node;
      let nameValue = name.image;
      let location = $.getLocationInfo(name);
      if (nameValue.includes('@') || nameValue.includes('$')) {
        nameNode = getInterpolated(nameValue, location, this.context);
        if (asReference) {
          // For interpolated keys, we can't merge into array easily, so keep nested structure
          // But we still check type to ensure consistency
          if (isNode(ctx.node, 'Reference') && ctx.node.options.type === 'mixin-ruleset') {
            // Keep nested structure for interpolated keys
            nameNode = new Reference({ target: ctx.node, key: nameNode as Interpolated }, { type: 'mixin-ruleset', role: 'name' }, location, this.context);
          } else {
            nameNode = new Reference({ target: ctx.node as Call | Reference, key: nameNode as Interpolated }, { type: 'mixin-ruleset', role: 'name' }, location, this.context);
          }
        }
      } else {
        if (asReference) {
          // If target is a Reference with matching type, merge keys instead of nesting
          if (isNode(ctx.node, 'Reference') && ctx.node.options.type === 'mixin-ruleset') {
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
          nameNode = $.wrap(new Any(nameValue, { role: 'name' }, $.getLocationInfo(name), this.context), true);
        }
      }
      return nameNode;
    }
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
      leftNode = $.SUBRULE2($.mixinReference, { ARGS: [{ ...ctx, node: leftNode }] });
    });

    return leftNode;
  };
}

export function mixinArgs(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let args: List | undefined;
    // Check for whitespace before the opening paren (before consuming)
    const hasWhitespace = !$.RECORDING_PHASE && !$.noSep();
    const openingParenToken = hasWhitespace ? $.LA(1) : undefined;

    $.CONSUME(T.LParen);
    // Clear ctx.node when parsing arguments - arguments should start fresh, not inherit the parent node
    $.OPTION(() => args = $.SUBRULE($.mixinArgList, { ARGS: [{ ...ctx, node: undefined }] }));
    $.CONSUME(T.RParen);

    // Check for whitespace warning AFTER consuming closing paren
    // Now we can check what comes next to determine if it's actually a definition
    if (!$.RECORDING_PHASE && hasWhitespace && openingParenToken) {
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

  let keyAlt = [
    { ALT: () => $.CONSUME(T.NestedReference) },
    { ALT: () => $.CONSUME(T.AtKeyword) },
    { ALT: () => $.CONSUME(T.PropertyReference) },
    { ALT: () => $.CONSUME(T.InterpolatedIdent) },
    { ALT: () => $.CONSUME(T.Ident) }
  ];

  return (ctx: RuleContext = {}) => {
    $.startRule();
    let RECORDING_PHASE = $.RECORDING_PHASE;
    return $.OR([
      {
        ALT: () => {
          let keyToken: IToken | undefined;
          $.CONSUME(T.LSquare);
          $.OPTION(() => keyToken = $.OR2(keyAlt));
          $.CONSUME(T.RSquare);
          if (!RECORDING_PHASE) {
            let ref: Reference;
            let target = ctx.node as Call | Reference;
            if (keyToken) {
              let tokenStr = keyToken.image;
              let type: 'variable' | 'property' = tokenStr.startsWith('@') ? 'variable' : 'property';
              // Handle all token types consistently
              if (keyToken.tokenType === T.NestedReference) {
                // For NestedReference, add $ prefix if not present
                let tokenStr = keyToken.image;
                if (!tokenStr.startsWith('$') && !tokenStr.startsWith('@')) {
                  tokenStr = '$' + tokenStr;
                }
              }
              let result = getInterpolatedOrString(tokenStr, $.getLocationInfo(keyToken), this.context);

              // Only merge keys for mixin, mixin-ruleset, or ruleset types
              // For variable and property types, keep them nested (target.key structure)
              const targetType = isNode(target, 'Reference') ? target.options.type : undefined;
              const shouldMergeKeys = targetType === 'mixin' || targetType === 'mixin-ruleset' || targetType === 'ruleset';
              if (isNode(target, 'Reference') && target.options.type === type && typeof result === 'string' && shouldMergeKeys) {
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
                  $.endRule(),
                  this.context
                );
              } else {
                ref = new Reference({ target, key: result }, { type }, $.endRule(), this.context);
              }
            } else {
              ref = new Reference({ target, key: -1 }, { type: 'index' }, $.endRule(), this.context);
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
        }
      },
      {
        ALT: () => {
          let args = $.SUBRULE($.mixinArgs, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            return new Call({ name: ctx.node as Call | Reference, args }, undefined, $.endRule(), this.context);
          }
        }
      }
    ]);
  };
}

// export function accessors(this: P, T: TokenMap) {
//   const $ = this;

//   let keyAlt = [
//     { ALT: () => $.CONSUME(T.NestedReference) },
//     { ALT: () => $.CONSUME(T.AtKeyword) },
//     { ALT: () => $.CONSUME(T.PropertyReference) },
//     { ALT: () => $.CONSUME(T.InterpolatedIdent) },
//     { ALT: () => $.CONSUME(T.Ident) }
//   ];

//   /** The node passed in is what we're looking up on */
//   return (ctx: RuleContext = {}) => {
//     let nodeContext = ctx.node! as Reference;
//     let RECORDING_PHASE = $.RECORDING_PHASE;
//     $.startRule();
//     let keyToken: IToken | undefined;
//     let key: string | number | Reference | Interpolated;
//     let returnNode: Node;

//     $.CONSUME(T.LSquare);
//     $.OPTION(() => keyToken = $.OR(keyAlt));
//     $.CONSUME(T.RSquare);

//     if (!RECORDING_PHASE) {
//       const location = $.endRule();
//       if (keyToken) {
//         let tokenStr = keyToken.image;
//         let type: 'variable' | 'property' = tokenStr.startsWith('@') ? 'variable' : 'property';
//         // Handle all token types consistently
//         if (keyToken.tokenType === T.NestedReference) {
//           // For NestedReference, add $ prefix if not present
//           let tokenStr = keyToken.image;
//           if (!tokenStr.startsWith('$') && !tokenStr.startsWith('@')) {
//             tokenStr = '$' + tokenStr;
//           }
//         }
//         let result = getInterpolatedOrString(tokenStr, $.getLocationInfo(keyToken), this.context);
//         returnNode = new Reference({ target: nodeContext, key: result }, { type }, location, this.context);
//       } else {
//         key = -1;
//         returnNode = new Reference({ target: nodeContext, key }, { type: 'index' }, location, this.context);
//       }
//     }
//     /**
//      * Allows chaining of lookups / calls
//      * @note - In Less, an additional call or accessor implies
//      * that the previous accessor is a mixin call, therefore
//      * it should be returned as a Call node.
//      */
//     $.OPTION2(() => {
//       $.OR2([
//         {
//           ALT: () => {
//             let args = $.SUBRULE($.mixinArgs, { ARGS: [ctx] });
//             if (!RECORDING_PHASE) {
//               let [startOffset, startLine, startColumn] = returnNode.location;
//               let { endOffset, endLine, endColumn } = $.LA(0);
//               returnNode = new Call({ name: returnNode, args }, undefined, [startOffset!, startLine!, startColumn!, endOffset!, endLine!, endColumn!], this.context);
//             }
//           }
//         },
//         {
//           ALT: () => {
//             returnNode = $.SUBRULE($.inlineMixinCall, { ARGS: [{ ...ctx, node: returnNode }] });
//             return returnNode;
//           }
//         },
//         {
//           ALT: () => {
//             returnNode = $.SUBRULE($.accessors, { ARGS: [{ ...ctx, node: returnNode }] });
//             return returnNode;
//           }
//         }
//       ]);
//     });
//     return returnNode!;
//   };
// }

/**
 * @see https://lesscss.org/features/#mixins-feature-mixins-parametric-feature
 *
 * This rule is recursive to allow chevrotain-allstar (hopefully) to lookahead
 * and find semi-colon separators vs. commas.
 */
export function mixinArgList(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    let RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let node = $.SUBRULE($.mixinArg, { ARGS: [ctx] });

    let commaNodes: Node[] | undefined;
    let semiNodes: Node[];
    if (!RECORDING_PHASE) {
      commaNodes = [$.wrap(node, true)];
      semiNodes = [];
    }
    let isSemiList = false;
    let moreArgs = true;

    $.MANY({
      GATE: () => moreArgs,
      DEF: () => {
        $.OR([
          {
            GATE: () => !isSemiList,
            ALT: () => {
              $.CONSUME(T.Comma);
              let node = $.SUBRULE2($.mixinArg, { ARGS: [ctx] });
              if (!RECORDING_PHASE) {
                commaNodes!.push($.wrap(node, true));
              }
            }
          },
          {
            ALT: () => {
              isSemiList = true;

              let semi = $.CONSUME(T.Semi);

              if (!RECORDING_PHASE) {
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
                      first.value.value = new List(nodes, undefined, $.getLocationFromNodes(nodes), this.context);
                      semiNodes.push(first);
                    } else {
                      hasDeclarations = commaNodes.some(n => n instanceof VarDeclaration);
                      let commaList = new List(commaNodes, undefined, $.getLocationFromNodes(commaNodes), this.context);
                      semiNodes.push(commaList);
                    }
                    if (hasDeclarations) {
                      let indexOfSemi = $.originalInput.indexOf(semi);
                      let previousToken = $.originalInput[indexOfSemi - 1]!;
                      $._errors.push(
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
                }
              }
              $.OR2([
                {
                  GATE: () => $.LA(1).tokenType !== T.RParen,
                  ALT: () => {
                    const prevAllow = ctx.allowComma;
                    ctx.allowComma = true;
                    node = $.SUBRULE3($.mixinArg, { ARGS: [ctx] });
                    ctx.allowComma = prevAllow;
                    if (!RECORDING_PHASE) {
                      semiNodes.push($.wrap(node, true));
                    }
                  }
                },
                {
                  ALT: () => {
                    moreArgs = false;
                    EMPTY_ALT();
                  }
                }
              ]);
            }
          }
        ]);
      }
    });

    if (!RECORDING_PHASE) {
      let location = $.endRule();
      let nodes = isSemiList ? semiNodes! : commaNodes!;
      let sep: ';' | ',' = isSemiList ? ';' : ',';
      return $.wrap(new List(nodes, { sep }, location, this.context), 'both');
    }
  };
}

/**
 * Less is more lenient about at-keywords. See lessTokens.ts for more details.
 */
export function varName(this: P, T: TokenMap) {
  const $ = this;
  let nameAlt = [
    { ALT: () => $.CONSUME(T.AtName) },
    { ALT: () => $.CONSUME(T.AtKeywordLessExtension) }
  ];
  return () => $.OR(nameAlt);
}

/**
 * Originally, we were creating alternatives for mixin calls and mixin definitions
 * that could mostly overlap, which led to longer parsing. Instead, we parse
 * as if it could be either, and then we disambiguate at the end.
 */
export function mixinArg(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    const isDefinition = !!ctx.isDefinition;
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let firstToken = $.LA(1);

    let atStart = (
      firstToken.tokenType === T.AtKeyword
      || firstToken.tokenType === T.AtKeywordLessExtension
    );

    let isDeclaration = atStart && $.LA(2).tokenType === T.Colon;

    return $.OR([
      {
        GATE: () => !isDeclaration && atStart && $.LA(2).tokenType === T.Ellipsis,
        ALT: () => {
          $.startRule();
          let name = $.SUBRULE2($.varName, { ARGS: [ctx] });
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
          $.OPTION(() => ellipsis = $.CONSUME(T.Ellipsis));
          if (!RECORDING_PHASE) {
            let varName = name.image.slice(1);
            if (ellipsis) {
              // For rest parameters, use string which can be converted to Reference later if needed
              return new Rest(varName, undefined, $.endRule(), this.context);
            } else {
              return new Any(varName, { role: 'name' }, $.endRule(), this.context);
            }
          }
        }
      },
      {
        GATE: () => !isDeclaration && !atStart,
        ALT: () => $.SUBRULE($.callArgument, { ARGS: [ctx] })
      },
      {
        GATE: () => !isDeclaration && atStart && $.LA(2).tokenType !== T.Ellipsis && $.LA(2).tokenType !== T.RParen && $.LA(2).tokenType !== T.Comma && $.LA(2).tokenType !== T.Semi,
        ALT: () => $.SUBRULE3($.callArgument, { ARGS: [ctx] })
      },
      {
        GATE: () => !isDeclaration && atStart && $.LA(2).tokenType !== T.Ellipsis && ($.LA(2).tokenType === T.RParen || $.LA(2).tokenType === T.Comma || $.LA(2).tokenType === T.Semi),
        ALT: () => {
          $.startRule();
          let name = $.SUBRULE3($.varName, { ARGS: [ctx] });
          if (!RECORDING_PHASE) {
            let varName = name.image.slice(1);
            return new Any(varName, { role: 'name' }, $.endRule(), this.context);
          }
        }
      },
      {
        GATE: () => isDeclaration,
        ALT: () => {
          $.startRule();
          let name = $.SUBRULE4($.varName, { ARGS: [ctx] });
          $.CONSUME(T.Colon);
          /** Default value */
          let value = $.SUBRULE2($.callArgument, { ARGS: [ctx] });

          if (!RECORDING_PHASE) {
            let location = $.endRule();
            return new VarDeclaration({
              name: new Any(name.image.slice(1), { role: 'property' }, $.getLocationInfo(name), this.context),
              value
            }, { paramVar: true }, location, this.context);
          }
        }
      },

      {
        ALT: () => {
          let ellipsis = $.CONSUME2(T.Ellipsis);
          return new Rest(undefined, undefined, $.getLocationInfo(ellipsis), this.context);
        }
      }
    ]);
  };
}

export function callArgument(this: P, T: TokenMap) {
  const $ = this;

  return (ctx: RuleContext = {}) => {
    return $.OR([
      {
        GATE: () => $.LA(1).tokenType === T.AnonMixinStart || $.LA(1).tokenType === T.LCurly,
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