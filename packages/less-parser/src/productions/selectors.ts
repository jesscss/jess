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
  return this.or([
    {
      ALT: () => {
        let co = this.consume(this.T.Combinator);
        let node: ComplexSelector | Extend = this.complexSelector(ctx);

        let combinator = new Combinator(co.image as Combinators, undefined, this.getLocationInfo(co), this.context);
        let targetNode =
          node instanceof Extend
            ? node.value.selector
            : node;
        if (targetNode instanceof ComplexSelector) {
          targetNode.value.unshift(combinator);
          targetNode._location = this.getLocationFromNodes(targetNode.value);
        } else {
          let nodes = [combinator, targetNode as ComplexSelectorComponent];
          let complex = new ComplexSelector(nodes, undefined, this.getLocationFromNodes(nodes), this.context);
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
      ALT: () => this.complexSelector(ctx)
    }
  ]);
}

export function compoundSelector(this: P, ctx: RuleContext = {}) {
  /**
      A sequence of simple selectors that are not separated by
      a combinator.
        .e.g. `a#selected`
    */
  // compoundSelector
  //   : simpleSelector+
  //   ;
  let selectors: SimpleSelector[] = [];
  let sel = this.simpleSelector(ctx);
  selectors.push(sel as SimpleSelector);
  this.many({
    /** Make sure we don't ignore space combinators */
    GATE: () => !this.hasWS() && !(ctx.inExtend && this.la(1).tokenType === this.T.All),
    DEF: () => {
      let sel = this.simpleSelector(ctx);
      /** Make sure we don't add implicit whitespace */
      sel.pre = 0;
      selectors.push(sel as SimpleSelector);
    }
  });
  if (selectors.length === 1) {
    return selectors[0]!;
  }
  return new CompoundSelector(selectors, undefined, this.getLocationFromNodes(selectors), this.context);
}

/**
 * Extended with :extend
 */
export function complexSelector(this: P, ctx: RuleContext = {}) {
  let selector: Selector = cssComplexSelector.call(
    this,
    ctx,
    (ctx: RuleContext) => () => !ctx.inExtend || this.la(1).tokenType !== this.T.All
  )!;
  let isQualifiedRule = !!ctx.qualifiedRule;
  let flag: IToken | undefined;

  this.or([
    {
      /** When we're inside the :extend(...), we can capture the "all" keyword */
      GATE: () => !!ctx.inExtend,
      ALT: () => flag = this.consume(this.T.All)
    },
    {
      GATE: () => isQualifiedRule && !ctx.inExtend,
      ALT: () => {
        ctx.selector = selector;
        this.extend(ctx);
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
  this.startRule();

  this.consume(this.T.AmpersandExtend);
  ctx.inExtend = true;
  this.selectorList(ctx);
  ctx.inExtend = false;
  let extendTargets = ctx.extendTargets!;
  let flag = this.option(() => this.consume(this.T.AllFlag));
  this.consume(this.T.RParen);
  this.consume(this.T.Semi);

  let location = this.endRule();
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

export function extend(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.Extend);

  ctx.inExtend = true;
  this.selectorList(ctx);
  let extendTargets = ctx.extendTargets;
  ctx.inExtend = false;

  let selector = ctx.selector;
  let flag = this.option(() => this.consume(this.T.AllFlag));
  this.consume(this.T.RParen);

  let location = this.endRule();
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

export function simpleSelector(this: P, ctx: RuleContext = {}) {
  let selectorAlt: Alt = [
    {
      GATE: () => (
        (!ctx.inExtend || this.la(1).tokenType !== this.T.All)
        && this.la(1).tokenType !== this.T.InterpolatedIdent
      ),
      /**
       * In Less/Sass (and now CSS), the first inner selector can be an identifier
       */
      ALT: () => this.consume(this.T.Ident)
    },
    {
      /**
       * Unlike CSS Nesting, Less allows outer qualified rules
       * to have `&`, and it is just silently absorbed if there
       * is no parent selector.
       */
      ALT: () => {
        let amp = this.consume(this.T.Ampersand);
        const value = getAmpersandTemplateValue(amp.image);
        return new Ampersand(value || undefined, undefined, this.getLocationInfo(amp), this.context);
      }
    },
    { ALT: () => this.consume(this.T.InterpolatedIdent) },
    { ALT: () => this.consume(this.T.InterpolatedSelector) },
    { ALT: () => this.classSelector() },
    { ALT: () => this.idSelector() },
    { ALT: () => this.consume(this.T.Star) },
    { ALT: () => {
      let initialIsQualifiedRule = ctx.qualifiedRule;
      ctx.qualifiedRule = false;
      /** Make sure we prevent things like :extend() inside pseudo-selectors */
      try {
        let pseudo = this.pseudoSelector(ctx);
        return pseudo;
      } finally {
        ctx.qualifiedRule = initialIsQualifiedRule;
      }
    } },
    { ALT: () => this.attributeSelector() },
    /** Supports keyframes selectors */
    { ALT: () => this.consume(this.T.DimensionInt) },
    { ALT: () => this.consume(this.T.DimensionNum) }
  ];

  let selector = this.or(selectorAlt);

  if (this.isToken(selector)) {
    if (selector.tokenType.name === 'Ampersand') {
      const value = getAmpersandTemplateValue(selector.image);
      return new Ampersand(value || undefined, undefined, this.getLocationInfo(selector), this.context);
    }
    if (
      selector.tokenType.name === 'InterpolatedSelector'
      || selector.tokenType.name === 'InterpolatedIdent'
    ) {
      // Create an InterpolatedSelector wrapper for interpolated selectors
      let nameValue = selector.image;
      let interpolatedNode = getInterpolated(nameValue, this.getLocationInfo(selector), this.context);

      return new InterpolatedSelector(interpolatedNode, undefined, this.getLocationInfo(selector), this.context);
    }
    return new BasicSelector(selector.image, undefined, this.getLocationInfo(selector), this.context);
  }
  return selector as Node;
}

export function anonymousMixinDefinition(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let params: List | undefined;
  let anonToken: IToken | undefined;
  this.option(() => {
    anonToken = this.consume(this.T.AnonMixinStart);
    this.option(() => {
      params = this.mixinArgList({ ...ctx, isDefinition: true });
    });
    this.consume(this.T.RParen);
  });
  let rules = this.wrappedDeclarationList(ctx);

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

    const usage = (ctx as RuleContext).detachedRulesetUsage ?? 'none';
    const forceMixinForDynamicUsage =
      usage === 'function-arg'
      || usage === 'mixin-arg'
      || usage === 'default-param';
    const shouldBeCollectionFinal = shouldBeCollection && !forceMixinForDynamicUsage;
    if (shouldBeCollectionFinal) {
      return new Collection(rules.value, rules.options, this.endRule(), this.context);
    }
  }

  // If anonToken exists, it's an anonymous mixin with (optional) parameters, return as Mixin
  return new Mixin({ params, rules }, undefined, this.endRule(), this.context);
}

/**
 * Mostly copied from css importAtRule, but it maps
 * differently to Jess nodes depending on if it's meant
 * to be a Jess-style import or just an at-rule
 */
export function importAtRule(this: P, ctx: RuleContext = {}) {
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

  this.startRule();

  let name = this.consume(this.T.AtImport);

  let options: string[] = [];

  this.option(() => {
    this.consume(this.T.LParen);
    this.atLeastOneSep({
      SEP: this.T.Comma,
      DEF: () => {
        let opt = this.consume(this.T.PlainIdent);
        options.push(opt.image);
      }
    });
    this.consume(this.T.RParen);
  });

  let urlNode: Quoted | Url = this.or([
    { ALT: () => this.urlFunction(ctx) },
    { ALT: () => this.string(ctx) }
  ]);

  let isAtRule: boolean | undefined;
  let postludeNode: Node | undefined;

  let url = urlNode.valueOf();
  isAtRule = isCssUrl(url, options);

  let preludeNodes: Node[] = [this.wrap(urlNode)];

  let extraNodes: Node[] | undefined;
  this.option(() => {
    extraNodes = this.importPostlude() as Node[];
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
      const postludeLoc = this.getLocationFromNodes(extraNodes);
      postludeNode = new Sequence(extraNodes, undefined, postludeLoc, this.context);
    }
  }

  this.consume(this.T.Semi);

  let location = this.endRule();
  if (isAtRule) {
    const prelude = new Sequence(preludeNodes, undefined, this.getLocationFromNodes(preludeNodes), this.context);
    const atRule = new AtRule({
      name: this.wrap(new Any(name.image, { role: 'atkeyword' }, this.getLocationInfo(name), this.context), true),
      prelude: prelude
    }, undefined, location, this.context);
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
  }, location, this.context);
}

/** Less variables */
export function varDeclarationOrCall(this: P, ctx: RuleContext = {}) {
  this.startRule();

  let name = this.varName();
  let value: Node | undefined;
  let args: List | undefined;
  let important: IToken | undefined;

  this.or([
    {
      /**
       * This is a variable declaration
       * Disallows `@atrule :foo;` because it resembles a pseudo-selector
       */
      ALT: () => {
        this.consume(this.T.Colon);
        return this.or([
          /**
           * This needs to be gated early, even though it is
           * gated again in the valueList production, because
           * chevrotain-allstar needs to pick a path first.
           */
          {
            GATE: () => {
              let type = this.la(1).tokenType;
              return type === this.T.AnonMixinStart || type === this.T.LCurly;
            },
            ALT: () => {
              value = this.anonymousMixinDefinition(ctx);
              this.option(() => this.consume(this.T.Semi));
              return value;
            }
          },
          {
            GATE: () => {
              let type = this.la(1).tokenType;
              return type !== this.T.AnonMixinStart && type !== this.T.LCurly;
            },
            ALT: () => {
              value = this.valueList({ ...ctx, allowMixinCallWithoutAccessor: true });
              this.option(() => {
                important = this.consume(this.T.Important);
              });
              return value;
            }
          }
        ]);
      }
    },
    /** This is a variable call. Allow optional whitespace between name and (. */
    {
      GATE: () => this.la(1).tokenType === this.T.LParen,
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
        args = this.mixinArgs(ctx);
        return args;
      }
    }
  ]);

  let location = this.endRule();
  let nameVal = getInterpolatedOrString(name!.image);
  let nameNode: Node;
  if (!(nameVal instanceof Interpolated)) {
    nameNode = new Any(nameVal, { role: 'ident' }, this.getLocationInfo(name!), this.context);
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
    const callNode = new Call({ name: nameRef, args }, callOptions, location, this.context);
    // Clear important since it's now on the Call
    if (important) {
      important = undefined;
    }
    // Variable calls are expressions at the outermost level (but not parenthesized).
    // e.g. `$media()`, NOT `$(media())`
    return new Expression(callNode, undefined, location, this.context);
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
    this.warnings.push(
      new ParseError(
        `Unquoted selector capture in '${varName}' is no longer supported. Use '*[ ... ]' (e.g. ${varName}: *[.a, .b]).`,
        this.la(1),
        { previousToken: this.la(0) }
      )
    );
  }

  return new VarDeclaration({
    name: this.wrap(nameNode, true) as any,
    value: this.wrap(value, true),
    important: important ? this.wrap(new Any(important.image, { role: 'flag' }, this.getLocationInfo(important), this.context), true) : undefined
  }, undefined, location, this.context);
}

export function selectorCapture(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.Star);
  // Use this.or with a gate for a positive assertion
  const selector = this.or([
    {
      GATE: this.noSep.bind(this),
      ALT: () => {
        this.consume(this.T.LSquare);
        const selector = this.forgivingSelectorList({ ...ctx, inner: true });
        this.consume(this.T.RSquare);
        return selector;
      }
    }
  ]);

  const location = this.endRule();
  return new SelectorCapture(
    this.wrap(selector, true),
    undefined,
    location,
    this.context
  );
}

export function valueSequence(this: P, ctx: RuleContext = {}) {
  this.startRule();
  let nodes: Node[] = [];

  this.or([
    {
      GATE: () => this.looseMode,
      ALT: () => {
        this.many(() => {
          const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
          let value = this.expressionSum(exprCtx);
          value = wrapOuterExpressionIfNeeded.call(this, value, exprCtx);
          nodes.push(value);
        });
      }
    },
    {
      GATE: () => !this.looseMode,
      /** @todo - create warning if there isn't a value */
      ALT: () => {
        this.atLeastOne(() => {
          const exprCtx: RuleContext = { ...ctx, wrapInExpression: true };
          let value = this.expressionSum(exprCtx);
          value = wrapOuterExpressionIfNeeded.call(this, value, exprCtx);
          nodes.push(value);
        });
      }
    }
  ]);

  let location = this.endRule();
  if (nodes.length === 1) {
    const single = nodes[0]!;
    return single;
  }
  const seq = new Sequence(nodes, undefined, location, this.context);
  return seq;
}

export function squareValue(this: P, ctx: RuleContext = {}) {
  this.startRule();
  this.consume(this.T.LSquare);
  let node: Node = this.or([
    {
      GATE: () => !this.looseMode,
      ALT: () => {
        let ident = this.consume(this.T.Ident);
        return new Any(ident.image, { role: 'ident' }, this.getLocationInfo(ident), this.context);
      }
    },
    {
      GATE: () => !!this.looseMode,
      ALT: () => {
        let nodes: Node[] = [];
        this.many(() => {
          let node = this.anyInnerValue(ctx);
          const wrapped = this.wrap(node);
          nodes.push(wrapped);
        });
        const seq = new Sequence(nodes, undefined, this.getLocationFromNodes(nodes), this.context);
        return seq;
      }
    }
  ]);
  this.consume(this.T.RSquare);
  let location = this.endRule();
  const blk = new Block(node, { type: 'square' }, location, this.context);
  return blk;
}
