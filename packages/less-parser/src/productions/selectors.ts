// Selector-related production rules for LessRecursiveParser
// Converted from Chevrotain-based productions.ts lines 1145-2060

import type { RuleContext, ExtendTarget } from '../lessRecursiveParser.js';
import type { IToken, OrAlternative } from '@jesscss/parser-runtime';
import { ParseError } from '@jesscss/parser-runtime';
import { CssRecursiveParser } from '@jesscss/css-parser';

import {
  type TreeContext,
  Node,
  Ampersand,
  Block,
  Any,
  type LocationInfo,
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
  Reference,
  Extend,
  Mixin,
  VarDeclaration,
  Declaration,
  Expression,
  SelectorCapture,
  ComplexSelector,
  CompoundSelector,
  SelectorList,
  Url,
  Nil,
  Collection,
  type ComplexSelectorComponent,
  type Selector,
  INTERPOLATION_PLACEHOLDER,
  type SimpleSelector,
  isNode,
  N,
  StyleImport
} from '@jesscss/core';

import { getInterpolatedOrString } from '../utils.js';
import { all } from 'known-css-properties';

/** Use `any` for `this` to avoid structural incompatibility between LessRecursiveParser and CssRecursiveParser */
type P = any;
type Alt = OrAlternative[];
type AltContext = (ctx?: RuleContext) => Alt;

// Save reference to CSS prototype method for delegation
const cssComplexSelector = CssRecursiveParser.prototype.complexSelector;

// ── Helper: interpolation regex and getInterpolated ──────────────────

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

// ── Helper: getAmpersandTemplateValue ────────────────────────────────

function getAmpersandTemplateValue(image: string): string | undefined {
  if (image === '&') {
    return undefined;
  }
  if (image.startsWith('&(') && image.endsWith(')')) {
    return image.slice(2, -1);
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

// ── Helper: isSelectorLikeListItem / isLegacySelectorLikeValue ───────

/** True for a node that could be one item in the old unquoted selector list (e.g. .a or #id). */
function isSelectorLikeListItem(node: Node): boolean {
  if (node.type === 'SelectorCapture' || isNode(node, N.Call)) {
    return false;
  }
  if (isNode(node, N.Reference)) {
    return node.options.type === 'mixin-ruleset';
  }
  if (isNode(node, N.List | N.Sequence)) {
    return (node as List).value.length > 0 && (node as List).value.every(isSelectorLikeListItem);
  }
  return false;
}

/** True only for the legacy unquoted selector-list form (e.g. @var: .a, .b, .c), not @var: .a; */
function isLegacySelectorLikeValue(node: Node): boolean {
  if (node.type === 'SelectorCapture' || isNode(node, N.Call)) {
    return false;
  }
  if (isNode(node, N.Reference)) {
    return false; // Single mixin reference is valid.
  }
  if (isNode(node, N.List | N.Sequence)) {
    return (node as List).value.length > 1 && (node as List).value.every(isSelectorLikeListItem);
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// PRODUCTION RULES
// ══════════════════════════════════════════════════════════════════════

/**
 * We need to now handle a returned `Extend` node from the complexSelector rule
 */
export function relativeSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  return $.OR([
    {
      ALT: () => {
        let co = $.CONSUME($.T.Combinator);
        let node: ComplexSelector | Extend = $.complexSelector(ctx);

        let combinator = new Combinator(co.image as Combinators, undefined, $.getLocationInfo(co), $.context);
        let targetNode =
          node instanceof Extend
            ? node.value.selector
            : node;
        if (targetNode instanceof ComplexSelector) {
          targetNode.value.unshift(combinator);
          targetNode._location = $.getLocationFromNodes(targetNode.value);
        } else {
          let nodes = [combinator, targetNode as ComplexSelectorComponent];
          let complex = new ComplexSelector(nodes, undefined, $.getLocationFromNodes(nodes), $.context);
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
        return node;
      }
    },
    {
      ALT: () => $.complexSelector(ctx)
    }
  ]);
}

export function compoundSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  let selectors: SimpleSelector[] = [];
  let sel = $.simpleSelector(ctx);
  selectors.push(sel as SimpleSelector);
  $.MANY({
    /** Make sure we don't ignore space combinators */
    GATE: () => !$.hasWS() && !(ctx.inExtend && $.LA(1).tokenType === $.T.All),
    DEF: () => {
      let sel = $.simpleSelector(ctx);
      /** Make sure we don't add implicit whitespace */
      sel.pre = 0;
      selectors.push(sel as SimpleSelector);
    }
  });
  if (selectors.length === 1) {
    return selectors[0]!;
  }
  return new CompoundSelector(selectors, undefined, $.getLocationFromNodes(selectors), $.context);
}

/**
 * Extended with :extend
 */
export function complexSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let selector: Selector = cssComplexSelector.call(
    this,
    ctx,
    (ctx: RuleContext) => () => !ctx.inExtend || $.LA(1).tokenType !== $.T.All
  )!;
  let isQualifiedRule = !!ctx.qualifiedRule;
  let flag: IToken | undefined;

  $.OR([
    {
      /** When we're inside the :extend(...), we can capture the "all" keyword */
      GATE: () => !!ctx.inExtend,
      ALT: () => flag = $.CONSUME($.T.All)
    },
    {
      GATE: () => isQualifiedRule && !ctx.inExtend,
      ALT: () => {
        ctx.selector = selector;
        $.extend(ctx);
        ctx.selector = undefined;
      }
    },
    {
      ALT: () => undefined
    }
  ]);

  if (ctx.inExtend) {
    (ctx.extendTargets ??= []).push({ selector: ctx.selector, target: selector, flag });
  }

  return selector;
}

/**
 * &:extend(...) statement ending with a semicolon.
 * This is the only valid standalone extend statement in Less.
 */
export function ampersandExtend(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  $.CONSUME($.T.AmpersandExtend);
  ctx.inExtend = true;
  $.selectorList(ctx);
  ctx.inExtend = false;
  let extendTargets = ctx.extendTargets!;
  let flag = $.OPTION(() => $.CONSUME($.T.AllFlag));
  $.CONSUME($.T.RParen);
  $.CONSUME($.T.Semi);

  let location = $.endRule();
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

export function extend(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.Extend);

  ctx.inExtend = true;
  $.selectorList(ctx);
  let extendTargets = ctx.extendTargets;
  ctx.inExtend = false;

  let selector = ctx.selector;
  let flag = $.OPTION(() => $.CONSUME($.T.AllFlag));
  $.CONSUME($.T.RParen);

  let location = $.endRule();
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

export function simpleSelector(this: P, ctx: RuleContext = {}) {
  const $ = this;
  let selectorAlt: Alt = [
    {
      GATE: () => (
        (!ctx.inExtend || $.LA(1).tokenType !== $.T.All)
        && $.LA(1).tokenType !== $.T.InterpolatedIdent
      ),
      /**
       * In Less/Sass (and now CSS), the first inner selector can be an identifier
       */
      ALT: () => $.CONSUME($.T.Ident)
    },
    {
      /**
       * Unlike CSS Nesting, Less allows outer qualified rules
       * to have `&`, and it is just silently absorbed if there
       * is no parent selector.
       */
      ALT: () => {
        let amp = $.CONSUME($.T.Ampersand);
        const value = getAmpersandTemplateValue(amp.image);
        return new Ampersand(value || undefined, undefined, $.getLocationInfo(amp), $.context);
      }
    },
    { ALT: () => $.CONSUME($.T.InterpolatedIdent) },
    { ALT: () => $.CONSUME($.T.InterpolatedSelector) },
    { ALT: () => $.classSelector() },
    { ALT: () => $.idSelector() },
    { ALT: () => $.CONSUME($.T.Star) },
    { ALT: () => {
      let initialIsQualifiedRule = ctx.qualifiedRule;
      ctx.qualifiedRule = false;
      /** Make sure we prevent things like :extend() inside pseudo-selectors */
      try {
        let pseudo = $.pseudoSelector(ctx);
        return pseudo;
      } finally {
        ctx.qualifiedRule = initialIsQualifiedRule;
      }
    } },
    { ALT: () => $.attributeSelector() },
    /** Supports keyframes selectors */
    { ALT: () => $.CONSUME($.T.DimensionInt) },
    { ALT: () => $.CONSUME($.T.DimensionNum) }
  ];

  let selector = $.OR(selectorAlt);

  if ($.isToken(selector)) {
    if (selector.tokenType.name === 'Ampersand') {
      const value = getAmpersandTemplateValue(selector.image);
      return new Ampersand(value || undefined, undefined, $.getLocationInfo(selector), $.context);
    }
    if (
      selector.tokenType.name === 'InterpolatedSelector'
      || selector.tokenType.name === 'InterpolatedIdent'
    ) {
      // Create an InterpolatedSelector wrapper for interpolated selectors
      let nameValue = selector.image;
      let interpolatedNode = getInterpolated(nameValue, $.getLocationInfo(selector), $.context);

      return new InterpolatedSelector(interpolatedNode, undefined, $.getLocationInfo(selector), $.context);
    }
    return new BasicSelector(selector.image, undefined, $.getLocationInfo(selector), $.context);
  }
  return selector as Node;
}

export function anonymousMixinDefinition(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let params: List | undefined;
  let anonToken: IToken | undefined;
  $.OPTION(() => {
    anonToken = $.CONSUME($.T.AnonMixinStart);
    $.OPTION(() => {
      params = $.mixinArgList({ ...ctx, isDefinition: true });
    });
    $.CONSUME($.T.RParen);
  });
  let rules = $.wrappedDeclarationList(ctx);

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
}

/**
 * Mostly copied from css importAtRule, but it maps
 * differently to Jess nodes depending on if it's meant
 * to be a Jess-style import or just an at-rule
 */
export function importAtRule(this: P, ctx: RuleContext = {}) {
  const $ = this;
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

  let name = $.CONSUME($.T.AtImport);

  let options: string[] = [];

  $.OPTION(() => {
    $.CONSUME($.T.LParen);
    $.AT_LEAST_ONE_SEP({
      SEP: $.T.Comma,
      DEF: () => {
        let opt = $.CONSUME($.T.PlainIdent);
        options.push(opt.image);
      }
    });
    $.CONSUME($.T.RParen);
  });

  let urlNode: Quoted | Url = $.OR([
    { ALT: () => $.urlFunction(ctx) },
    { ALT: () => $.string(ctx) }
  ]);

  let isAtRule: boolean | undefined;
  let postludeNode: Node | undefined;

  let url = urlNode.valueOf();
  isAtRule = isCssUrl(url, options);

  let preludeNodes: Node[] = [$.wrap(urlNode)];

  let extraNodes: Node[] | undefined;
  $.OPTION(() => {
    extraNodes = $.importPostlude() as Node[];
  });
  if (extraNodes && extraNodes.length) {
    if (isAtRule) {
      isAtRule = true;
      for (const n of extraNodes) {
        preludeNodes.push(n);
      }
    } else {
      // Less-style imports with media/query/layer postludes should evaluate
      // the target and then wrap output (for both inline and non-inline forms).
      // Keep this on import options so StyleImport.evalNode can apply wrappers.
      const postludeLoc = $.getLocationFromNodes(extraNodes);
      postludeNode = new Sequence(extraNodes, undefined, postludeLoc, $.context);
    }
  }

  $.CONSUME($.T.Semi);

  let location = $.endRule();
  if (isAtRule) {
    const prelude = new Sequence(preludeNodes, undefined, $.getLocationFromNodes(preludeNodes), $.context);
    const atRule = new AtRule({
      name: $.wrap(new Any(name.image, { role: 'atkeyword' }, $.getLocationInfo(name), $.context), true),
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

/** Less variables */
export function varDeclarationOrCall(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();

  let name = $.varName();
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
        $.CONSUME($.T.Colon);
        return $.OR([
          /**
           * This needs to be gated early, even though it is
           * gated again in the valueList production, because
           * chevrotain-allstar needs to pick a path first.
           */
          {
            GATE: () => {
              let type = $.LA(1).tokenType;
              return type === $.T.AnonMixinStart || type === $.T.LCurly;
            },
            ALT: () => {
              value = $.anonymousMixinDefinition(ctx);
              $.OPTION(() => $.CONSUME($.T.Semi));
              return value;
            }
          },
          {
            GATE: () => {
              let type = $.LA(1).tokenType;
              return type !== $.T.AnonMixinStart && type !== $.T.LCurly;
            },
            ALT: () => {
              value = $.valueList({ ...ctx, allowMixinCallWithoutAccessor: true });
              $.OPTION(() => {
                important = $.CONSUME($.T.Important);
              });
              return value;
            }
          }
        ]);
      }
    },
    /** This is a variable call. Allow optional whitespace between name and (. */
    {
      GATE: () => $.LA(1).tokenType === $.T.LParen,
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
        args = $.mixinArgs(ctx);
        return args;
      }
    }
  ]);

  let location = $.endRule();
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
    const nameRef = nameNode instanceof Interpolated
      ? new Reference({ key: nameNode }, { type: 'variable', role: 'name' })
      : new Reference({ key: nameNode as any }, { type: 'variable', role: 'name' });
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
    $.warnings.push(
      new ParseError(
        `Unquoted selector capture in '${varName}' is no longer supported. Use '*[ ... ]' (e.g. ${varName}: *[.a, .b]).`,
        $.LA(1),
        { previousToken: $.LA(0) }
      )
    );
  }

  return new VarDeclaration({
    name: $.wrap(nameNode, true) as any,
    value: $.wrap(value, true),
    important: important ? $.wrap(new Any(important.image, { role: 'flag' }, $.getLocationInfo(important), $.context), true) : undefined
  }, undefined, location, $.context);
}

export function selectorCapture(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.Star);
  // Use $.OR with a gate for a positive assertion
  const selector = $.OR([
    {
      GATE: $.noSep.bind(this),
      ALT: () => {
        $.CONSUME($.T.LSquare);
        const selector = $.forgivingSelectorList({ ...ctx, inner: true });
        $.CONSUME($.T.RSquare);
        return selector;
      }
    }
  ]);

  const location = $.endRule();
  return new SelectorCapture(
    $.wrap(selector, true),
    undefined,
    location,
    $.context
  );
}

export function valueSequence(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  let nodes: Node[] = [];

  $.OR([
    {
      GATE: () => $.looseMode,
      ALT: () => {
        $.MANY(() => {
          const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
          let value = $.expressionSum(exprCtx);
          value = wrapOuterExpressionIfNeeded.call(this, value, exprCtx);
          nodes.push(value);
        });
      }
    },
    {
      GATE: () => !$.looseMode,
      /** @todo - create warning if there isn't a value */
      ALT: () => {
        $.AT_LEAST_ONE(() => {
          const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
          let value = $.expressionSum(exprCtx);
          value = wrapOuterExpressionIfNeeded.call(this, value, exprCtx);
          nodes.push(value);
        });
      }
    }
  ]);

  let location = $.endRule();
  if (nodes.length === 1) {
    const single = nodes[0]!;
    return single;
  }
  const seq = new Sequence(nodes, undefined, location, $.context);
  return seq;
}

export function squareValue(this: P, ctx: RuleContext = {}) {
  const $ = this;
  $.startRule();
  $.CONSUME($.T.LSquare);
  let node: Node = $.OR([
    {
      GATE: () => !$.looseMode,
      ALT: () => {
        let ident = $.CONSUME($.T.Ident);
        return new Any(ident.image, { role: 'ident' }, $.getLocationInfo(ident), $.context);
      }
    },
    {
      GATE: () => !!$.looseMode,
      ALT: () => {
        let nodes: Node[] = [];
        $.MANY(() => {
          let node = $.anyInnerValue(ctx);
          const wrapped = $.wrap(node);
          nodes.push(wrapped);
        });
        const seq = new Sequence(nodes, undefined, $.getLocationFromNodes(nodes), $.context);
        return seq;
      }
    }
  ]);
  $.CONSUME($.T.RSquare);
  let location = $.endRule();
  const blk = new Block(node, { type: 'square' }, location, $.context);
  return blk;
}
