// Selector-related production rules for LessRecursiveParser
// Converted from Chevrotain-based productions.ts lines 1145-2060

import type { RuleContext, ExtendTarget, TokenMap } from '../lessRecursiveParser.js';
import type { IToken, IOrAlt } from 'chevrotain';
import {
  Node,
  Ampersand,
  Block,
  Any,
  type LocationInfo,
  type TreeContext,
  BasicSelector,
  Combinator,
  type Combinators,
  List,
  Sequence,
  Call,
  Quoted,
  AtRule,
  Interpolated,
  InterpolatedSelector,
  AttributeSelector,
  Reference,
  Extend,
  Mixin,
  VarDeclaration,
  Declaration,
  Expression,
  SelectorCapture,
  ComplexSelector,
  CompoundSelector,
  Selector,
  SelectorList,
  Url,
  Nil,
  Collection,
  type ComplexSelectorValue,
  type ComplexSelectorComponent,
  type SimpleSelector,
  isNode,
  N,
  StyleImport
} from '@jesscss/core';

import { createInterpolatedReference, getInterpolatedNode, getInterpolatedOrString } from '../utils.js';
import { all } from 'known-css-properties';

/** Use `any` for `this` to avoid structural incompatibility between LessRecursiveParser and CssRecursiveParser */
type P = any;
type Alt = IOrAlt<any>[];
type AltContext = (ctx?: RuleContext) => Alt;
const COMBINATORS = new Set<string>([' ', '>', '+', '~', '|', '||']);

function toCombinator(image: string): Combinators {
  if (COMBINATORS.has(image)) {
    return image;
  }
  throw new Error(`Unexpected selector combinator "${image}".`);
}

function isComplexSelectorComponentNode(node: Node | undefined): node is ComplexSelectorComponent {
  return node instanceof Call
    || (node instanceof Selector
      && !(node instanceof SelectorList)
      && !(node instanceof ComplexSelector));
}

export function attributeSelector(this: P, T: TokenMap, valueAlt?: AltContext) {
  const $ = this;

  valueAlt ??= () => [
    {
      GATE: () => !$.isType(T.InterpolatedIdent),
      ALT: () => {
        const token = $.CONSUME5(T.Ident);
        if ($.RECORDING_PHASE) {
          return;
        }
        return new Any(token.image, { role: 'ident' }, $.getLocationInfo(token), $.context);
      }
    },
    {
      GATE: () => $.isType(T.InterpolatedIdent),
      ALT: () => {
        const token = $.CONSUME(T.InterpolatedIdent);
        if ($.RECORDING_PHASE) {
          return;
        }
        const match = /([$@])\{([^}]+)\}/.exec(token.image);
        if (match && match[0] === token.image) {
          return createInterpolatedReference(
            match[1]!,
            match[2]!,
            $.getLocationInfo(token),
            $.context
          );
        }
        const result = getInterpolatedOrString(token.image, $.getLocationInfo(token), $.context);
        return typeof result === 'string'
          ? new Any(result, { role: 'ident' }, $.getLocationInfo(token), $.context)
          : result;
      }
    },
    { ALT: () => $.SUBRULE($.string) }
  ];

  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    $.CONSUME2(T.LSquare);
    const key: Any = $.SUBRULE2($.attributeName);
    let op: IToken | undefined;
    let value: Node | undefined;
    let mod: IToken | undefined;
    $.OPTION(() => {
      op = $.OR([
        { ALT: () => $.CONSUME4(T.Eq) },
        { ALT: () => $.CONSUME6(T.AttrMatch) }
      ]);
      value = $.OR2(valueAlt!(ctx));
    });
    $.OPTION2(() => mod = $.CONSUME7(T.AttrFlag));
    $.CONSUME8(T.RSquare);

    if (!RECORDING_PHASE) {
      const location = $.endRule();
      return new AttributeSelector({
        name: key.valueOf(),
        op: op?.image,
        value,
        mod: mod?.image
      }, undefined, location, $.context);
    }
  };
}

// ── Helper: getAmpersandTemplateValue ────────────────────────────────

function getAmpersandTemplateValue(image: string): string | Nil | undefined {
  if (image === '&') {
    return undefined;
  }
  if (image.startsWith('&')) {
    return image.slice(1) || undefined;
  }
  if (image.includes('&')) {
    return image;
  }
  return undefined;
}

// ── Helper: wrapOuterExpressionIfNeeded ──────────────────────────────
// Imported from root.ts where it's defined.
import { wrapOuterExpressionIfNeeded } from './root.js';

// ── Helper: groupExtendsByTargetAndFlag ──────────────────────────────

const { isArray } = Array;
type ExtendSelectorKind = 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound';

function getAllowedExtendSelectors(context: TreeContext): ExtendSelectorKind[] | undefined {
  const val: ExtendSelectorKind[] | undefined = context.opts.allowExtendSelectors;
  return val;
}

function findDisallowedExtendSelector(selector: Selector, allowed?: readonly ExtendSelectorKind[]): { kind: ExtendSelectorKind; selector: Selector } | undefined {
  if (!allowed) {
    return undefined;
  }
  if (isNode(selector, N.SelectorList)) {
    for (const item of selector.value) {
      const disallowed = findDisallowedExtendSelector(item, allowed);
      if (disallowed) {
        return disallowed;
      }
    }
    return undefined;
  }
  const kinds: ExtendSelectorKind[] = isNode(selector, N.BasicSelector)
    ? ['simple', 'basic']
    : isNode(selector, N.PseudoSelector)
      ? ['simple', 'pseudo']
      : isNode(selector, N.CompoundSelector)
        ? ['compound']
        : isNode(selector, N.ComplexSelector)
          ? ['complex']
          : ['simple'];
  if (kinds.some(kind => allowed.includes(kind))) {
    return undefined;
  }
  return {
    kind: kinds[0]!,
    selector
  };
}

function formatAllowedExtendSelectors(allowed: readonly ExtendSelectorKind[]) {
  if (allowed.length === 0) {
    return 'no selector kinds';
  }
  if (allowed.length === 1) {
    return `${allowed[0]} selectors`;
  }
  const head = allowed.slice(0, -1).join(', ');
  return `${head}, or ${allowed[allowed.length - 1]} selectors`;
}

function validateExtendTarget($: P, selector: Selector, source: ':extend()' | '&:extend()') {
  const allowed = getAllowedExtendSelectors($.context);
  const disallowed = findDisallowedExtendSelector(selector, allowed);
  if (!disallowed || !allowed) {
    return;
  }
  throw new Error(
    `${source} only allows ${formatAllowedExtendSelectors(allowed)}, but found ${disallowed.kind} selector "${disallowed.selector.valueOf()}".`
  );
}

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
    const { target, flag = 1 } = ext.value; // ExtendFlag.Exact = 1
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

// ── Helper: mergeExtends ─────────────────────────────────────────────

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
      const { target } = currentNode.value;
      if (!(target instanceof SelectorList)) {
        currentNode.set('target', new SelectorList([target, ext.target], undefined, location, context));
      } else {
        target.set(null, [...target.value, ext.target]);
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

// ── Helper: isSelectorLikeListItem / isLegacySelectorLikeValue ───────

/** True for a node that could be one item in the old unquoted selector list (e.g. .a or #id). */
function isSelectorLikeListItem(node: Node): boolean {
  if (node.type === 'SelectorCapture' || isNode(node, N.Call)) {
    return false;
  }
  if (isNode(node, N.Reference)) {
    return node.options.type === 'mixin-ruleset';
  }
  if (node instanceof List || node instanceof Sequence) {
    return node.value.length > 0 && node.value.every(isSelectorLikeListItem);
  }
  return false;
}

/** True only for the legacy unquoted selector-list form (e.g. @var: .a, .b, .c), not @var: .a; */
function isLegacySelectorLikeValue(node: Node): boolean {
  if (node.type === 'SelectorCapture' || isNode(node, N.Call)) {
    return false;
  }
  if (isNode(node, N.Reference)) {
    return false;
  }
  if (node instanceof List || node instanceof Sequence) {
    return node.value.length > 1 && node.value.every(isSelectorLikeListItem);
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// PRODUCTION RULES
// ══════════════════════════════════════════════════════════════════════

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
          let node: ComplexSelector | Extend = $.SUBRULE2($.complexSelector, { ARGS: [ctx] });
          if ($.RECORDING_PHASE) {
            return node;
          }

          let combinator = new Combinator(toCombinator(co.image), undefined, $.getLocationInfo(co), $.context);
          let targetNode =
            node instanceof Extend
              ? node.value.selector
              : node;
          if (targetNode instanceof ComplexSelector) {
            targetNode.set(null, [combinator, ...targetNode.value]);
            targetNode._location = $.getLocationFromNodes(targetNode.value);
          } else {
            if (!isComplexSelectorComponentNode(targetNode)) {
              throw new Error(`Expected selector component after relative combinator; got ${targetNode?.type ?? 'none'}.`);
            }
            let nodes = [combinator, targetNode];
            let complex = new ComplexSelector(nodes, undefined, $.getLocationFromNodes(nodes), $.context);
            if (node instanceof Extend) {
              node.set('selector', complex);
              let location = node.location;
              location[0] = co.startOffset;
              location[1] = co.startLine;
              location[2] = co.startColumn;
            } else {
              node = complex;
            }
          }
          return node;
        }
      },
      {
        ALT: () => $.SUBRULE3($.complexSelector, { ARGS: [ctx] })
      }
    ]);
  };
}

export function forgivingSelectorList(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let sequences: ComplexSelector[] | undefined;
    let i = 0;

    if (!RECORDING_PHASE) {
      sequences = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        const selector = $.SUBRULE($.relativeSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          i++;
          if (i === 1 && ctx.qualifiedRule) {
            sequences!.push(selector);
          } else {
            sequences!.push(selector);
          }
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    const location = $.endRule();
    if (sequences!.length === 1) {
      return sequences![0];
    }
    return new SelectorList(sequences!, undefined, location, $.context);
  };
}

export function selectorList(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let sequences: ComplexSelector[] | undefined;
    let i = 0;

    if (!RECORDING_PHASE) {
      sequences = [];
    }

    $.AT_LEAST_ONE_SEP({
      SEP: T.Comma,
      DEF: () => {
        const selector = $.SUBRULE2($.complexSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          i++;
          if (i === 1 && ctx.qualifiedRule) {
            sequences!.push(selector);
          } else {
            sequences!.push(selector);
          }
        }
      }
    });

    if (RECORDING_PHASE) {
      return;
    }
    const location = $.endRule();
    if (sequences!.length === 1) {
      return sequences![0];
    }
    return new SelectorList(sequences!, undefined, location, $.context);
  };
}

export function compoundSelector(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    /**
        A sequence of simple selectors that are not separated by
        a combinator.
          .e.g. `a#selected`
      */
    // compoundSelector
    //   : simpleSelector+
    //   ;
    let RECORDING_PHASE = $.RECORDING_PHASE;
    let selectors: SimpleSelector[];
    if (!RECORDING_PHASE) {
      selectors = [];
    }
    let sel: SimpleSelector = $.SUBRULE($.simpleSelector, { ARGS: [ctx] });
    if (!RECORDING_PHASE) {
      selectors!.push(sel);
    }
    $.MANY({
      /** Make sure we don't ignore space combinators */
      GATE: () => !$.hasWS() && !(ctx.inExtend && $.isType(T.All)),
      DEF: () => {
        let sel: SimpleSelector = $.SUBRULE2($.simpleSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          selectors!.push(sel);
        }
      }
    });
    if (RECORDING_PHASE) {
      return;
    }
    if (selectors!.length === 1) {
      return selectors![0]!;
    }
    return new CompoundSelector(selectors!, undefined, $.getLocationFromNodes(selectors!), $.context);
  };
}

/**
 * Extended with :extend
 */
export function complexSelector(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();

    let selectors: ComplexSelectorValue | undefined;
    if (!RECORDING_PHASE) {
      const first: ComplexSelectorComponent = $.SUBRULE($.compoundSelector, { ARGS: [ctx] });
      selectors = [first];
    } else {
      $.SUBRULE($.compoundSelector, { ARGS: [ctx] });
    }

    $.MANY({
      GATE: () => {
        if (ctx.inExtend && $.isType(T.All)) {
          return false;
        }
        return $.hasWS() || $.isType(T.Combinator);
      },
      DEF: () => {
        let co: IToken | undefined;
        let combinator: Combinator | undefined;

        $.OPTION(() => {
          co = $.CONSUME(T.Combinator);
        });

        if (!RECORDING_PHASE) {
          if (co) {
            const coImg = toCombinator(co.image);
            combinator = new Combinator(coImg, undefined, $.getLocationInfo(co), $.context);
          } else {
            const ws = $.claimSpaceCombinator($.LA(1).startOffset);
            combinator = new Combinator(' ', undefined, ws ? $.getLocationInfo(ws) : undefined, $.context);
          }
        }

        const compound: ComplexSelectorComponent = $.SUBRULE2($.compoundSelector, { ARGS: [ctx] });
        if (!RECORDING_PHASE) {
          selectors!.push(combinator!, compound);
        }
      }
    });

    let selector: Selector | undefined;
    if (!RECORDING_PHASE) {
      const location = $.endRule();
      selector = selectors!.length === 1
        ? selectors![0]
        : new ComplexSelector(selectors!, undefined, location, $.context);
    }

    let flag: IToken | undefined;

    /** Inside :extend(...), only consume the optional trailing "all" keyword. */
    $.OPTION2({
      GATE: () => !!ctx.inExtend && $.isType(T.All),
      DEF: () => {
        flag = $.CONSUME(T.All);
      }
    });

    /**
     * Outside :extend(...), only enter the extend production when the next token
     * is actually :extend(. Do not commit based on context alone.
     */
    $.OPTION3({
      GATE: () => !ctx.inExtend && !!ctx.qualifiedRule && $.isType(T.Extend),
      DEF: () => {
        const initialSelector = ctx.selector;
        if (!RECORDING_PHASE) {
          ctx.selector = selector;
        }
        try {
          $.SUBRULE($.extend, { ARGS: [ctx] });
        } finally {
          ctx.selector = initialSelector;
        }
      }
    });

    if (ctx.inExtend) {
      validateExtendTarget($, selector!, ':extend()');
      (ctx.extendTargets ??= []).push({ selector: ctx.selector, target: selector!, flag });
    }

    return selector;
  };
}

/**
 * &:extend(...) statement ending with a semicolon.
 * This is the only valid standalone extend statement in Less.
 */
export function ampersandExtend(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    $.CONSUME(T.Ampersand);
    $.CONSUME(T.Extend);
    ctx.inExtend = true;
    $.SUBRULE($.selectorList, { ARGS: [ctx] });
    ctx.inExtend = false;
    let extendTargets = ctx.extendTargets!;
    let flag = $.OPTION(() => $.CONSUME(T.AllFlag));
    $.CONSUME(T.RParen);
    $.CONSUME(T.Semi);

    let location = $.endRule();
    if (!$.RECORDING_PHASE) {
      let result = mergeExtends(undefined, extendTargets, location, $.context, flag);
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
      return new Nil(undefined, undefined, location, $.context);
    }
  };
}

export function extend(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.Extend);

    ctx.inExtend = true;
    $.SUBRULE($.selectorList, { ARGS: [ctx] });
    let extendTargets = ctx.extendTargets;
    ctx.inExtend = false;

    let selector = ctx.selector;
    let flag = $.OPTION(() => $.CONSUME(T.AllFlag));
    $.CONSUME(T.RParen);

    let location = $.endRule();
    if (!$.RECORDING_PHASE) {
      // When .c:extend(...) is parsed, selector is .c
      // The extend will be processed in qualifiedRuleBody where selector: undefined is set
      // for extends that stay inside the ruleset (not bubbled)
      // Bubbled extends keep their selector and get it set correctly in qualifiedRule
      let merged = mergeExtends(selector, extendTargets!, location, $.context, flag);
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
  return (ctx: RuleContext = {}) => {
    let selectorAlt: Alt = [
      {
        GATE: () => (
          (!ctx.inExtend || $.LA(1).tokenType !== T.All)
          && $.LA(1).tokenType !== T.InterpolatedIdent
        ),
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
          const value = getAmpersandTemplateValue(amp.image);
          return new Ampersand({ appendValue: value }, undefined, $.getLocationInfo(amp), $.context);
        }
      },
      {
        ALT: () => {
          $.startRule();
          $.CONSUME(T.AmpersandLParen);
          const parts: string[] = [];
          let sawQuoted = false;
          $.MANY(() => {
            $.OR2([
              {
                GATE: () => $.isType(T.QuoteStart),
                ALT: () => {
                  const quoted: Quoted = $.SUBRULE($.string, { ARGS: [ctx] });
                  parts.push(quoted.valueOf());
                  sawQuoted = true;
                }
              },
              {
                GATE: () => $.isType(T.WS),
                ALT: () => {
                  parts.push($.CONSUME(T.WS).image);
                }
              },
              {
                ALT: () => {
                  parts.push($.CONSUME(T.AmpersandTemplateContents).image);
                }
              }
            ]);
          });
          $.CONSUME(T.AmpersandTemplateEnd);
          const location = $.endRule();
          const value = parts.join('');
          const appendValue = sawQuoted && value === ''
            ? ''
            : value === 'nil'
              ? ''
              : value;
          return new Ampersand({ appendValue }, undefined, location, $.context);
        }
      },
      { ALT: () => $.CONSUME(T.InterpolatedIdent) },
      { ALT: () => $.CONSUME(T.InterpolatedSelector) },
      { ALT: () => $.SUBRULE($.classSelector, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.idSelector, { ARGS: [ctx] }) },
      { ALT: () => $.CONSUME(T.Star) },
      { ALT: () => {
        let initialIsQualifiedRule = ctx.qualifiedRule;
        ctx.qualifiedRule = false;
        /** Make sure we prevent things like :extend() inside pseudo-selectors */
        try {
          let pseudo = $.SUBRULE($.pseudoSelector, { ARGS: [ctx] });
          return pseudo;
        } finally {
          ctx.qualifiedRule = initialIsQualifiedRule;
        }
      } },
      /** @todo - replicate this fix we made with the Jess parser
       *
       * { ALT: () => $.attributeSelector(ctx, () => [
      {
        ALT: () => {
          let token = $.CONSUME($.T.InterpolatedIdent);
          let location = $.getLocationInfo(token);
          let image = token.image;
          let match = interpolatedRegex.exec(image);
          interpolatedRegex.lastIndex = 0;
          if (match && match[0] === image) {
            return new Reference(
              { key: new Keyword(match[2]!, undefined, location, $.context) },
              { type: 'index' },
              location,
              $.context
            );
          }
          return getInterpolatedNode(image, location, $.context);
        }
      },
      */
      { ALT: () => $.SUBRULE($.attributeSelector, { ARGS: [ctx] }) },
      /** Supports keyframes selectors */
      { ALT: () => $.CONSUME(T.DimensionInt) },
      { ALT: () => $.CONSUME(T.DimensionNum) }
    ];

    let selector = $.OR(selectorAlt);

    if ($.isToken(selector)) {
      if (selector.tokenType.name === 'Ampersand') {
        const value = getAmpersandTemplateValue(selector.image);
        return new Ampersand({ appendValue: value }, undefined, $.getLocationInfo(selector), $.context);
      }
      if (
        selector.tokenType.name === 'InterpolatedSelector'
        || selector.tokenType.name === 'InterpolatedIdent'
      ) {
        // Create an InterpolatedSelector wrapper for interpolated selectors
        let nameValue = selector.image;
        let interpolatedNode = getInterpolatedNode(nameValue, $.getLocationInfo(selector), $.context);

        return new InterpolatedSelector(interpolatedNode, undefined, $.getLocationInfo(selector), $.context);
      }
      return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), $.context);
    }
    const result: Node = selector;
    return result;
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
      $.OPTION2(() => {
        params = $.SUBRULE($.mixinArgList, { ARGS: [{ ...ctx, isDefinition: true }] });
      });
      $.CONSUME(T.RParen);
    });
    let rules = $.SUBRULE($.wrappedDeclarationList, { ARGS: [ctx] });

    if ($.RECORDING_PHASE) {
      return;
    }

    // Set rulesVisibility for detached rulesets based on leakyRules
    // Less, for whatever reason, has slightly different lookup rules for
    // "detached rulesets".

    // Parse as Anonymous mixin
    if (!rules.options.rulesVisibility) {
      rules.options.rulesVisibility = {};
    }
    if ($.leakyRules) {
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
          const { name } = decl.value;
          const propName = typeof name === 'string' ? name : name?.valueOf();
          if (!propName) {
            return false;
          }
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

      const usage = (ctx as RuleContext).detachedRulesetUsage ?? 'none';
      const forceMixinForDynamicUsage =
        usage === 'function-arg'
        || usage === 'mixin-arg'
        || usage === 'default-param';
      const shouldBeCollectionFinal = shouldBeCollection && !forceMixinForDynamicUsage;
      if (shouldBeCollectionFinal) {
        return new Collection(rules.value, rules.options, $.endRule(), $.context);
      }
    }

    // If anonToken exists, it's an anonymous mixin with (optional) parameters, return as Mixin
    return new Mixin({ params, rules }, undefined, $.endRule(), $.context);
  };
}

/**
 * Mostly copied from css importAtRule, but it maps
 * differently to Jess nodes depending on if it's meant
 * to be a Jess-style import or just an at-rule
 */
export function importAtRule(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const isCssUrl = (url: string, options: string[]) => {
      if (options.includes('inline')) {
        return false;
      }
      const lower = url.toLowerCase();
      const forcedLess = options.includes('less');
      if (forcedLess) {
        return false;
      }
      if (options.includes('css')) {
        return true;
      }
      if (/\.css([?#].*)?$/.test(lower)) {
        return true;
      }
      if (/\.less([?#].*)?$/.test(lower)) {
        return false;
      }
      // Remote imports default to CSS.
      if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//')) {
        return true;
      }
      return false;
    };

    $.startRule();

    let name = $.CONSUME(T.AtImport);

    let options: string[] = [];

    $.OPTION(() => {
      $.CONSUME(T.LParen);
      $.AT_LEAST_ONE_SEP({
        SEP: T.Comma,
        DEF: () => {
          let opt = $.CONSUME(T.PlainIdent);
          options.push(opt.image);
        }
      });
      $.CONSUME(T.RParen);
    });

    let urlNode: Quoted | Url = $.OR([
      { ALT: () => $.SUBRULE($.urlFunction, { ARGS: [ctx] }) },
      { ALT: () => $.SUBRULE($.string, { ARGS: [ctx] }) }
    ]);

    let extraNodes: Node[] | undefined;
    $.OPTION2(() => {
      extraNodes = $.SUBRULE($.importPostlude, { ARGS: [{}] });
    });

    $.CONSUME(T.Semi);

    if (!$.RECORDING_PHASE) {
      let isAtRule: boolean | undefined;
      let postludeNode: Node | undefined;

      let url = urlNode.valueOf();
      isAtRule = isCssUrl(url, options);

      let preludeNodes: Node[] = [urlNode];

      if (extraNodes && extraNodes.length) {
        if (isAtRule) {
          isAtRule = true;
          for (const n of extraNodes) {
            preludeNodes.push(n);
          }
        } else {
          const postludeLoc = $.getLocationFromNodes(extraNodes);
          postludeNode = new Sequence(extraNodes, undefined, postludeLoc, $.context);
        }
      }

      let location = $.endRule();
      if (isAtRule) {
        const prelude = new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context);
        const atRule = new AtRule({
          name: new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context),
          prelude: prelude
        }, undefined, location, $.context);
        return atRule;
      }

      return new StyleImport({
        path: urlNode
      }, {
        type: 'import',
        importOptions: {
          type: options.includes('less') ? 'less' : undefined,
          reference: options.includes('reference'),
          once: !options.includes('multiple'),
          multiple: options.includes('multiple'),
          optional: options.includes('optional'),
          inline: options.includes('inline'),
          postlude: postludeNode
        }
      }, location, $.context);
    }
  };
}

/** Less variables */
export function varDeclarationOrCall(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();

    let name = $.SUBRULE($.varName, { ARGS: [{}] });
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
            {
              GATE: () => {
                const type = $.LA(1).tokenType;
                return type === T.AnonMixinStart || type === T.LCurly;
              },
              ALT: () => {
                value = $.SUBRULE($.anonymousMixinDefinition, { ARGS: [ctx] });
                $.OPTION(() => $.CONSUME(T.Semi));
                return value;
              }
            },
            {
              GATE: () => {
                const type = $.LA(1).tokenType;
                return type !== T.AnonMixinStart && type !== T.LCurly;
              },
              ALT: () => {
                value = $.SUBRULE($.valueList, { ARGS: [{ ...ctx, allowMixinCallWithoutAccessor: true }] });
                $.OPTION2(() => {
                  important = $.CONSUME(T.Important);
                });
                return value;
              }
            }
          ]);
        }
      },
      /** This is a variable call. Allow optional whitespace between name and (. */
      {
        GATE: () => $.isType(T.LParen),
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

    let location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    let nameVal = getInterpolatedOrString(name!.image);
    let nameNode: Node;
    if (!(nameVal instanceof Interpolated)) {
      nameNode = new Any(nameVal, { role: 'ident' }, $.getLocationInfo(name!), $.context);
    } else {
      nameNode = nameVal;
    }
    /** An anonymous mixin call */
    if (!value) {
      // When @variable() is called, look up the variable first
      // The variable's value (which may be a Call node) will be executed
      const nameRef = new Reference({ key: nameNode }, { type: 'variable', role: 'name' });
      // Pass markImportant in options if !important is present
      const callOptions = important ? { markImportant: true } : undefined;
      const callNode = new Call({ name: nameRef, args }, callOptions, location, $.context);
      // Clear important since it's now on the Call
      if (important) {
        important = undefined;
      }
      // Variable calls are expressions at the outermost level (but not parenthesized).
      // e.g. `$media()`, NOT `$(media())`
      return new Expression(callNode, undefined, location, $.context);
    }

    // If the value is a Call node and we have !important, set markImportant on the Call
    // instead of on the VarDeclaration (mixin call semantics)
    if (important && value instanceof Call) {
      value.options = value.options || {};
      value.options.markImportant = true;
      important = undefined;
    }

    if (value && isLegacySelectorLikeValue(value)) {
      const varName = String(nameNode.valueOf());
      $.warnDeprecation(
        `Unquoted selector capture in '${varName}' is no longer supported. Use '*[ ... ]' (e.g. ${varName}: *[.a, .b]).`,
        $.LA(1),
        'unquoted-selector-capture'
      );
    }

    return new VarDeclaration({
      name: nameNode,
      value: value,
      important: important ? new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context) : undefined
    }, undefined, location, $.context);
  };
}

export function selectorCapture(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.Star);
    // Use $.OR with a gate for a positive assertion
    const selector = $.OR([
      {
        GATE: $.noSep.bind($),
        ALT: () => {
          $.CONSUME(T.LSquare);
          const selector = $.SUBRULE($.forgivingSelectorList, { ARGS: [{ ...ctx, inner: true }] });
          $.CONSUME(T.RSquare);
          return selector;
        }
      }
    ]);

    const location = $.endRule();
    if ($.RECORDING_PHASE) {
      return;
    }
    return new SelectorCapture(
      selector,
      undefined,
      location,
      $.context
    );
  };
}

export function valueSequence(this: P, _T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    const RECORDING_PHASE = $.RECORDING_PHASE;
    $.startRule();
    let nodes: Node[] | undefined;
    if (!RECORDING_PHASE) {
      nodes = [];
    }

    {
      const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
      let value = $.SUBRULE2($.expressionSum, { ARGS: [exprCtx] });
      if (!RECORDING_PHASE) {
        value = wrapOuterExpressionIfNeeded.call($, value, exprCtx);
        nodes!.push(value);
      }
    }

    $.MANY(() => {
      const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
      let value = $.SUBRULE3($.expressionSum, { ARGS: [exprCtx] });
      if (!RECORDING_PHASE) {
        value = wrapOuterExpressionIfNeeded.call($, value, exprCtx);
        nodes!.push(value);
      }
    });

    if (RECORDING_PHASE) {
      return;
    }

    let location = $.endRule();
    if (nodes!.length === 1) {
      const single = nodes![0]!;
      return single;
    }
    const seq = new Sequence(nodes!, undefined, location, $.context);
    return seq;
  };
}

export function squareValue(this: P, T: TokenMap) {
  const $ = this;
  return (ctx: RuleContext = {}) => {
    $.startRule();
    $.CONSUME(T.LSquare);
    let node: Node = $.OR([
      {
        GATE: () => !$.looseMode,
        ALT: () => {
          let ident = $.CONSUME(T.Ident);
          return new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context);
        }
      },
      {
        GATE: () => !!$.looseMode,
        ALT: () => {
          let nodes: Node[] = [];
          $.MANY(() => {
            let node = $.SUBRULE($.anyInnerValue, { ARGS: [ctx] });
            const wrapped = node;
            nodes.push(wrapped);
          });
          const seq = new Sequence(nodes, undefined, $.getLocationFromNodes(nodes), $.context);
          return seq;
        }
      }
    ]);
    $.CONSUME(T.RSquare);
    let location = $.endRule();
    const blk = new Block(node, { type: 'square' }, location, $.context);
    return blk;
  };
}
